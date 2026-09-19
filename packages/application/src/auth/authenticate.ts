import {
  AUTH_ERROR_GENERIC,
  DEFAULT_ARGON2_OPTIONS,
  computeLockout,
  hashPassword,
  isLocked,
  needsRehash,
  verifyPasswordOrDummy,
} from "@aquarela/domain";

import { AUTH_AUDIT_ACTIONS } from "./actions";
import { audit } from "./audit";
import { issueSession } from "./session";
import type { AuthDeps, AuthStore, AuthUser, IssuedSession, RequestContext } from "./types";

export interface AuthenticateInput {
  readonly organizationId: string;
  readonly identifier: string;
  readonly password: string;
  readonly request?: RequestContext;
}

export type AuthenticateResult =
  | {
      readonly ok: true;
      readonly mfaRequired: boolean;
      readonly user: AuthUser;
      readonly session?: IssuedSession;
    }
  | { readonly ok: false; readonly error: string };

/**
 * Username/password authentication. Every outcome is audited, every failure
 * returns the same `AUTH_ERROR_GENERIC`, and the state change plus its audit row
 * commit in one transaction.
 *
 * Timing: exactly one verification always runs, including the dummy path for an
 * unknown account, so response time does not reveal whether the account exists.
 * Lockout: the failure counter is incremented on a bad password and is only
 * reset once authentication completes — when MFA is required the counter is left
 * for the MFA step to reset, so repeated second-factor failures still accumulate.
 */
export async function authenticate(
  store: AuthStore,
  deps: AuthDeps,
  input: AuthenticateInput,
): Promise<AuthenticateResult> {
  return store.withTransaction(async (tx) => {
    const now = deps.now ?? new Date();
    const generic: AuthenticateResult = { ok: false, error: AUTH_ERROR_GENERIC };

    const user = await tx.findUserByIdentifier(input.organizationId, input.identifier);
    const passwordOk = await verifyPasswordOrDummy(user?.passwordHash ?? null, input.password);

    if (user === undefined) {
      await audit(tx, {
        organizationId: input.organizationId,
        actorId: null,
        action: AUTH_AUDIT_ACTIONS.loginUnknown,
        entityId: null,
        reason: "unknown_identifier",
        ...(input.request !== undefined ? { request: input.request } : {}),
      });
      return generic;
    }

    if (user.status !== "active") {
      await audit(tx, {
        organizationId: input.organizationId,
        actorId: user.id,
        action: AUTH_AUDIT_ACTIONS.loginDisabled,
        entityId: user.id,
        reason: `status_${user.status}`,
        ...(input.request !== undefined ? { request: input.request } : {}),
      });
      return generic;
    }

    if (isLocked(user.lockedUntil, now)) {
      await audit(tx, {
        organizationId: input.organizationId,
        actorId: user.id,
        action: AUTH_AUDIT_ACTIONS.loginLocked,
        entityId: user.id,
        reason: "locked",
        ...(input.request !== undefined ? { request: input.request } : {}),
      });
      return generic;
    }

    if (!passwordOk) {
      const nextCount = user.failedLoginCount + 1;
      const lockedUntil = computeLockout(nextCount, now).lockedUntil;
      await tx.recordLoginFailure(user.id, { lockedUntil, at: now });
      await audit(tx, {
        organizationId: input.organizationId,
        actorId: user.id,
        action:
          lockedUntil === null ? AUTH_AUDIT_ACTIONS.loginFailed : AUTH_AUDIT_ACTIONS.loginLocked,
        entityId: user.id,
        reason: lockedUntil === null ? "bad_password" : "lockout_applied",
        ...(input.request !== undefined ? { request: input.request } : {}),
      });
      return generic;
    }

    // Rehash first so the stronger hash is durable before the login completes.
    if (needsRehash(user.passwordHash, DEFAULT_ARGON2_OPTIONS)) {
      await tx.updatePasswordHash(user.id, await hashPassword(input.password), now);
    }

    if (user.totpEnabled) {
      await audit(tx, {
        organizationId: input.organizationId,
        actorId: user.id,
        action: AUTH_AUDIT_ACTIONS.loginMfaRequired,
        entityId: user.id,
        ...(input.request !== undefined ? { request: input.request } : {}),
      });
      return { ok: true, mfaRequired: true, user };
    }

    await tx.recordLoginSuccess(user.id, now);
    const session = await issueSession(tx, deps, user, now, input.request);
    await audit(tx, {
      organizationId: input.organizationId,
      actorId: user.id,
      action: AUTH_AUDIT_ACTIONS.loginSucceeded,
      entityId: user.id,
      ...(input.request !== undefined ? { request: input.request } : {}),
    });
    return { ok: true, mfaRequired: false, session, user };
  });
}
