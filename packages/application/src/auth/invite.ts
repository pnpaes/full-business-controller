import {
  AUTH_ERROR_GENERIC,
  DomainError,
  assertPasswordPolicy,
  generateInviteToken,
  hashInviteToken,
  hashPassword,
} from "@aquarela/domain";

import { AUTH_AUDIT_ACTIONS } from "./actions";
import { audit } from "./audit";
import { issueSession } from "./session";
import type { AuthDeps, AuthStore, IssuedSession, RequestContext } from "./types";

/**
 * The placeholder stored in `app_user.password_hash` for an invited account
 * (`DEC-146`): a manager-provisioned user has **no usable password** until
 * `acceptInvite` sets one. It is deliberately not a valid Argon2id encoding, so
 * `verifyPassword` fails closed for every plaintext (it catches an unparseable
 * hash and returns `false`) and `authenticate` can never admit the account. A
 * real hash replaces it on acceptance. The column stays `NOT NULL`, so no
 * schema-wide nullability change is needed.
 */
export const INVITE_PENDING_PASSWORD_HASH = "!invite-pending";

/** Minimal, deliberately permissive email shape check (the DB index is the authority). */
function assertEmail(value: unknown): string {
  if (typeof value !== "string") {
    throw new DomainError("email must be a string");
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 320 || !trimmed.includes("@")) {
    throw new DomainError("email must be a valid address");
  }
  return trimmed;
}

export interface InviteEmployeeUserInput {
  readonly organizationId: string;
  /** The owner/admin actor issuing the invite (recorded on the audit fact). */
  readonly actorId: string;
  readonly employeeId: string;
  /** The address the invite is delivered to; becomes the username and email. */
  readonly email: string;
  readonly request?: RequestContext;
}

export interface InviteEmployeeUserResult {
  readonly userId: string;
  readonly employeeId: string;
  /** The plaintext single-use invite token, for out-of-band delivery only. */
  readonly token: string;
  readonly expiresAt: Date;
}

/**
 * Manager-provisioned employee account (`DEC-146`, `WF-003` slice A). In one
 * transaction: resolves the (organization-scoped) employee, reuses an existing
 * invited login or creates a new `app_user` in the `invited` status with no
 * usable password, links `employee.user_id` if it is not already linked, revokes
 * any prior live invite for the user, mints a single-use hashed invite token
 * with the configured TTL, and audits `auth.user.invited`.
 *
 * The plaintext token is returned to the caller for delivery and is **never**
 * stored, logged or placed in a URL (`ADR-0003`). The command does not import a
 * mail provider; the route hands the token to `MailPort.sendInviteEmail`.
 */
export async function inviteEmployeeUser(
  store: AuthStore,
  deps: AuthDeps,
  input: InviteEmployeeUserInput,
): Promise<InviteEmployeeUserResult> {
  const email = assertEmail(input.email);
  const now = deps.now ?? new Date();
  const request = input.request !== undefined ? { request: input.request } : {};

  return store.withTransaction(async (tx) => {
    const employee = await tx.findEmployeeLink({
      organizationId: input.organizationId,
      employeeId: input.employeeId,
    });
    if (employee === undefined) {
      throw new DomainError("employee not found");
    }

    let userId: string;
    if (employee.userId !== null) {
      const existing = await tx.findUserById(employee.userId);
      if (existing === undefined || existing.organizationId !== input.organizationId) {
        throw new DomainError("employee login not found");
      }
      if (existing.status === "active") {
        throw new DomainError("employee already has an active account");
      }
      if (existing.status !== "invited") {
        throw new DomainError("employee account is not inviteable");
      }
      userId = existing.id;
    } else {
      // Re-link only an account that is itself still awaiting acceptance; an
      // active/disabled user with this address must not be silently taken over.
      const byEmail = await tx.findUserByIdentifier(input.organizationId, email);
      if (byEmail !== undefined) {
        if (byEmail.status !== "invited") {
          throw new DomainError("an account with this email already exists");
        }
        userId = byEmail.id;
        if (
          !(await tx.linkEmployeeToUser({
            organizationId: input.organizationId,
            employeeId: input.employeeId,
            userId,
            actorId: input.actorId,
          }))
        ) {
          throw new DomainError("employee is already linked to another account");
        }
      } else {
        const created = await tx.createUser({
          organizationId: input.organizationId,
          username: email,
          email,
          displayName: email,
          passwordHash: INVITE_PENDING_PASSWORD_HASH,
          status: "invited",
          invitedAt: now,
          invitedBy: input.actorId,
        });
        userId = created.id;
        if (
          !(await tx.linkEmployeeToUser({
            organizationId: input.organizationId,
            employeeId: input.employeeId,
            userId,
            actorId: input.actorId,
          }))
        ) {
          throw new DomainError("employee is already linked to another account");
        }
      }
    }

    // A re-invite supersedes any prior live invite, keeping the one-live-invite
    // invariant (and the partial unique index) satisfiable.
    await tx.revokeLiveInvitesForUser(userId, now);

    const token = generateInviteToken();
    const expiresAt = new Date(now.getTime() + deps.inviteTtlMinutes * 60_000);
    await tx.createInvite({
      organizationId: input.organizationId,
      userId,
      tokenHash: hashInviteToken(token),
      expiresAt,
      issuedBy: input.actorId,
    });
    await audit(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: AUTH_AUDIT_ACTIONS.userInvited,
      entityId: userId,
      reason: "manager_invite",
      after: {
        userId,
        employeeId: input.employeeId,
        email,
        status: "invited",
        expires_at: expiresAt.toISOString(),
      },
      ...request,
    });

    return { userId, employeeId: input.employeeId, token, expiresAt };
  });
}

export interface AcceptInviteInput {
  readonly organizationId: string;
  readonly token: string;
  readonly newPassword: string;
  readonly request?: RequestContext;
}

export type AcceptInviteResult =
  | { readonly ok: true; readonly session: IssuedSession }
  | { readonly ok: false; readonly error: string };

/**
 * Redeems an employee invite (`DEC-146`). An unknown, expired, revoked or
 * already-used token yields the single generic error (enumeration-neutral). On
 * success the token is claimed atomically, the password hash is set, the status
 * flips `invited` → `active`, every other outstanding invite for the user is
 * revoked, a session is issued (like login), and the change plus its audit fact
 * commit in one transaction. The plaintext token is never echoed or logged.
 */
export async function acceptInvite(
  store: AuthStore,
  deps: AuthDeps,
  input: AcceptInviteInput,
): Promise<AcceptInviteResult> {
  const now = deps.now ?? new Date();
  const generic: AcceptInviteResult = { ok: false, error: AUTH_ERROR_GENERIC };
  const request = input.request !== undefined ? { request: input.request } : {};

  // Reject a weak password before the token is looked up or claimed, with the
  // same generic result a bad token gets: the response leaks nothing and a
  // policy failure does not burn a still-valid invite.
  try {
    assertPasswordPolicy(input.newPassword);
  } catch (error) {
    if (error instanceof DomainError) {
      return generic;
    }
    throw error;
  }

  return store.withTransaction(async (tx) => {
    const record =
      input.token.length === 0
        ? undefined
        : await tx.findActiveInviteByHash(hashInviteToken(input.token), now);

    // Claim before any write: a lost race leaves nothing to roll back.
    const claimed = record !== undefined ? await tx.consumeInvite(record.id, now) : false;
    if (record === undefined || !claimed) {
      await audit(tx, {
        organizationId: input.organizationId,
        actorId: null,
        action: AUTH_AUDIT_ACTIONS.inviteFailed,
        entityId: null,
        reason: "invalid_token",
        ...request,
      });
      return generic;
    }

    const user = await tx.findUserById(record.userId);
    if (
      user === undefined ||
      user.status !== "invited" ||
      user.organizationId !== input.organizationId ||
      record.organizationId !== input.organizationId
    ) {
      await audit(tx, {
        organizationId: input.organizationId,
        actorId: user?.id ?? null,
        action: AUTH_AUDIT_ACTIONS.inviteFailed,
        entityId: user?.id ?? null,
        reason: user === undefined ? "user_missing" : "user_not_eligible",
        ...request,
      });
      return generic;
    }

    await tx.updatePasswordHash(
      user.id,
      await hashPassword(input.newPassword, deps.passwordHashOptions),
      now,
    );
    await tx.setUserStatus(user.id, "active");
    // Match the reset flow: the new credential invalidates every prior session
    // before the fresh one is minted.
    await tx.revokeAllSessionsForUser(user.id, now);
    await tx.revokeLiveInvitesForUser(user.id, now);
    await tx.recordLoginSuccess(user.id, now);
    const session = await issueSession(tx, deps, { ...user, status: "active" }, now, input.request);
    await audit(tx, {
      organizationId: input.organizationId,
      actorId: user.id,
      action: AUTH_AUDIT_ACTIONS.inviteAccepted,
      entityId: user.id,
      reason: "invite_token",
      after: { status: "active" },
      ...request,
    });
    return { ok: true, session };
  });
}
