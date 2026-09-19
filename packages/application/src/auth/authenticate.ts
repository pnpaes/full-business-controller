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
 * Username/password authentication. Every outcome is audited, and every failure
 * returns the same `AUTH_ERROR_GENERIC` so the response never reveals whether the
 * account exists, is disabled, or is locked (ADR-0003).
 */
export async function authenticate(
  store: AuthStore,
  deps: AuthDeps,
  input: AuthenticateInput,
): Promise<AuthenticateResult> {
  const now = deps.now ?? new Date();
  const generic: AuthenticateResult = { ok: false, error: AUTH_ERROR_GENERIC };

  const user = await store.findUserByIdentifier(input.organizationId, input.identifier);
  // Always run one verification, even when the account is unknown: the dummy
  // path has the same cost, so response timing does not reveal account existence.
  const passwordOk = await verifyPasswordOrDummy(user?.passwordHash ?? null, input.password);

  if (user === undefined) {
    await audit(store, {
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
    await audit(store, {
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
    await audit(store, {
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
    await store.recordLoginFailure(user.id, { lockedUntil, at: now });
    await audit(store, {
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

  if (needsRehash(user.passwordHash, DEFAULT_ARGON2_OPTIONS)) {
    await store.updatePasswordHash(user.id, await hashPassword(input.password), now);
  }
  await store.recordLoginSuccess(user.id, now);

  if (user.totpEnabled) {
    await audit(store, {
      organizationId: input.organizationId,
      actorId: user.id,
      action: AUTH_AUDIT_ACTIONS.loginMfaRequired,
      entityId: user.id,
      ...(input.request !== undefined ? { request: input.request } : {}),
    });
    return { ok: true, mfaRequired: true, user };
  }

  const session = await issueSession(store, deps, user, now, input.request);
  await audit(store, {
    organizationId: input.organizationId,
    actorId: user.id,
    action: AUTH_AUDIT_ACTIONS.loginSucceeded,
    entityId: user.id,
    ...(input.request !== undefined ? { request: input.request } : {}),
  });
  return { ok: true, mfaRequired: false, session, user };
}
