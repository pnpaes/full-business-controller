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

/**
 * Always `{ ok: true }`. The result carries no token and no status, so it can be
 * returned to an unauthenticated caller without revealing whether the identifier
 * exists or is active.
 */
export interface BeginPasswordResetResult {
  readonly ok: true;
}

/** Fixed plaintext whose only purpose is to make the non-active path pay a hash. */
const TIMING_EQUALISER_PASSWORD = "password-reset-timing-equaliser";

/**
 * Starts a password reset. An unknown, disabled or inactive identifier yields the
 * same `{ ok: true }` and no stored token, and every path pays one Argon2id hash,
 * so neither the body nor the timing can enumerate accounts (ADR-0003). A token
 * is minted only for an active user; only `hashPasswordResetToken(token)` is
 * persisted (with `deps.passwordResetTtlMinutes` expiry) and the plaintext is
 * handed to `deps.deliverResetToken` for out-of-band delivery — it is never
 * returned, logged or audited. Without a delivery port the token is dropped.
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

    // One hash on every path, active or not: the unknown/disabled branch must cost
    // the same as the active one.
    await hashPassword(TIMING_EQUALISER_PASSWORD, deps.passwordHashOptions);

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
    if (deps.deliverResetToken !== undefined) {
      await deps.deliverResetToken({
        organizationId: input.organizationId,
        userId: user.id,
        email: user.email,
        token,
      });
    }
    return { ok: true };
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
    // The token must redeem in the organization it was minted for, and the user
    // must still be active.
    if (
      user === undefined ||
      user.status !== "active" ||
      user.organizationId !== input.organizationId
    ) {
      await audit(tx, {
        organizationId: input.organizationId,
        actorId: user?.id ?? null,
        action: AUTH_AUDIT_ACTIONS.passwordResetFailed,
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
