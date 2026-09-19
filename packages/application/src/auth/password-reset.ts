import {
  AUTH_ERROR_GENERIC,
  generatePasswordResetToken,
  hashPassword,
  hashPasswordResetToken,
} from "@aquarela/domain";

import { AUTH_AUDIT_ACTIONS } from "./actions";
import { audit } from "./audit";
import type { AuthDeps, AuthStore, RequestContext } from "./types";

export interface BeginPasswordResetInput {
  readonly organizationId: string;
  readonly identifier: string;
  /** Set for an admin-assisted reset; absent for the self-service flow. */
  readonly createdBy?: string;
  readonly request?: RequestContext;
}

export interface BeginPasswordResetResult {
  readonly ok: true;
  /**
   * Plaintext reset token, returned ONLY for out-of-band delivery to the account
   * owner. Only `hashPasswordResetToken(token)` is persisted; the plaintext MUST
   * NOT be logged, audited, or returned to an unauthenticated caller.
   */
  readonly token?: string;
}

/**
 * Starts a password reset. The response is always neutral (`ok: true`) — an
 * unknown or disabled identifier yields no token and no error, so the endpoint
 * cannot be used to enumerate accounts. A token is minted only for an active
 * user, and only its hash is stored, with `deps.passwordResetTtlMinutes` expiry.
 */
export async function beginPasswordReset(
  store: AuthStore,
  deps: AuthDeps,
  input: BeginPasswordResetInput,
): Promise<BeginPasswordResetResult> {
  return store.withTransaction(async (tx) => {
    const now = deps.now ?? new Date();
    const user = await tx.findUserByIdentifier(input.organizationId, input.identifier);
    const request = input.request !== undefined ? { request: input.request } : {};

    if (user === undefined || user.status !== "active") {
      await audit(tx, {
        organizationId: input.organizationId,
        actorId: input.createdBy ?? null,
        action: AUTH_AUDIT_ACTIONS.passwordResetRequested,
        entityId: user?.id ?? null,
        reason: user === undefined ? "unknown_identifier" : `status_${user.status}`,
        ...request,
      });
      return { ok: true };
    }

    const token = generatePasswordResetToken();
    await tx.createResetToken({
      userId: user.id,
      tokenHash: hashPasswordResetToken(token),
      expiresAt: new Date(now.getTime() + deps.passwordResetTtlMinutes * 60_000),
      createdBy: input.createdBy ?? null,
    });
    await audit(tx, {
      organizationId: input.organizationId,
      actorId: input.createdBy ?? null,
      action: AUTH_AUDIT_ACTIONS.passwordResetRequested,
      entityId: user.id,
      reason: input.createdBy !== undefined ? "admin_initiated" : "self_service",
      ...request,
    });
    return { ok: true, token };
  });
}

export interface CompletePasswordResetInput {
  readonly organizationId: string;
  readonly token: string;
  readonly newPassword: string;
  readonly request?: RequestContext;
}

export type CompletePasswordResetResult =
  { readonly ok: true } | { readonly ok: false; readonly error: string };

/**
 * Redeems a reset token. An invalid, expired or already-used token yields the
 * single generic error. On success the token is claimed atomically, the new hash
 * is stored, every session for the user is revoked, and the change plus its
 * audit row commit in one transaction.
 */
export async function completePasswordReset(
  store: AuthStore,
  deps: AuthDeps,
  input: CompletePasswordResetInput,
): Promise<CompletePasswordResetResult> {
  return store.withTransaction(async (tx) => {
    const now = deps.now ?? new Date();
    const generic: CompletePasswordResetResult = { ok: false, error: AUTH_ERROR_GENERIC };
    const request = input.request !== undefined ? { request: input.request } : {};

    const record =
      input.token.length === 0
        ? undefined
        : await tx.findActiveResetTokenByHash(hashPasswordResetToken(input.token), now);

    // Claim the token before any write. A lost race leaves nothing to roll back,
    // so returning the generic error here commits no partial change.
    const claimed = record !== undefined ? await tx.consumeResetToken(record.id, now) : false;
    if (record === undefined || !claimed) {
      await audit(tx, {
        organizationId: input.organizationId,
        actorId: null,
        action: AUTH_AUDIT_ACTIONS.passwordResetFailed,
        entityId: null,
        reason: "invalid_token",
        ...request,
      });
      return generic;
    }

    const user = await tx.findUserById(record.userId);
    if (user === undefined || user.status !== "active") {
      await audit(tx, {
        organizationId: input.organizationId,
        actorId: user?.id ?? null,
        action: AUTH_AUDIT_ACTIONS.passwordResetFailed,
        entityId: user?.id ?? null,
        reason: "user_not_active",
        ...request,
      });
      return generic;
    }

    await tx.updatePasswordHash(
      user.id,
      await hashPassword(input.newPassword, deps.passwordHashOptions),
      now,
    );
    await tx.revokeAllSessionsForUser(user.id, now);
    await audit(tx, {
      organizationId: input.organizationId,
      actorId: user.id,
      action: AUTH_AUDIT_ACTIONS.passwordResetCompleted,
      entityId: user.id,
      reason: "reset_token",
      ...request,
    });
    return { ok: true };
  });
}
