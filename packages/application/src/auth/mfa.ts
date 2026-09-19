import { ConfigError } from "@aquarela/config";
import { AUTH_ERROR_GENERIC, openSecret, verifyRecoveryCode, verifyTotp } from "@aquarela/domain";
import type { VerifyTotpOptions } from "@aquarela/domain";

import { AUTH_AUDIT_ACTIONS } from "./actions";
import { audit } from "./audit";
import { issueSession } from "./session";
import type { AuthDeps, AuthStore, IssuedSession, RequestContext } from "./types";

export interface VerifyMfaInput {
  readonly organizationId: string;
  readonly userId: string;
  readonly token: string;
  readonly request?: RequestContext;
}

export type VerifyMfaResult =
  | { readonly ok: true; readonly session: IssuedSession }
  | { readonly ok: false; readonly error: string };

/**
 * Second factor: a fresh TOTP code, or a single-use recovery code. A valid TOTP
 * advances the persisted replay counter; a used recovery code is removed from
 * the stored set. Every outcome is audited and every failure is generic.
 */
export async function verifyMfa(
  store: AuthStore,
  deps: AuthDeps,
  input: VerifyMfaInput,
): Promise<VerifyMfaResult> {
  const now = deps.now ?? new Date();
  const generic: VerifyMfaResult = { ok: false, error: AUTH_ERROR_GENERIC };
  const context = {
    organizationId: input.organizationId,
    actorId: input.userId,
    entityId: input.userId,
  };

  const user = await store.findUserById(input.userId);
  if (user === undefined || user.status !== "active") {
    await audit(store, {
      ...context,
      action: AUTH_AUDIT_ACTIONS.mfaFailed,
      reason: "user_not_active",
    });
    return generic;
  }

  const totp = await store.getTotp(user.id);
  if (totp === undefined || totp.confirmedAt === null) {
    await audit(store, {
      ...context,
      action: AUTH_AUDIT_ACTIONS.mfaFailed,
      reason: "no_confirmed_totp",
    });
    return generic;
  }

  const key = deps.totpEncryptionKey;
  if (key === undefined) {
    throw new ConfigError("TOTP_SECRET_ENCRYPTION_KEY is required to verify MFA");
  }

  const secret = openSecret(totp.secretEncrypted, key);
  const options: VerifyTotpOptions =
    totp.lastUsedCounter === null ? { now } : { now, lastUsedCounter: totp.lastUsedCounter };
  const result = verifyTotp(secret, input.token, options);

  if (result.valid) {
    await store.setLastUsedCounter(user.id, result.counter);
    const session = await issueSession(store, deps, user, now, input.request);
    await audit(store, { ...context, action: AUTH_AUDIT_ACTIONS.mfaSucceeded });
    return { ok: true, session };
  }

  if (totp.recoveryCodesHash.length > 0 && looksLikeRecoveryCode(input.token)) {
    const index = await verifyRecoveryCode(totp.recoveryCodesHash, input.token);
    if (index !== null) {
      const remaining = totp.recoveryCodesHash.filter((_, position) => position !== index);
      await store.setRecoveryCodes(user.id, remaining);
      const session = await issueSession(store, deps, user, now, input.request);
      await audit(store, {
        ...context,
        action: AUTH_AUDIT_ACTIONS.mfaRecoveryUsed,
        reason: `remaining_${remaining.length}`,
      });
      return { ok: true, session };
    }
  }

  await audit(store, { ...context, action: AUTH_AUDIT_ACTIONS.mfaFailed, reason: result.reason });
  return generic;
}

/**
 * A 6-digit token is never a recovery code (they are longer and contain
 * separators), so this keeps a mistyped TOTP code from paying for ten Argon2
 * comparisons.
 */
function looksLikeRecoveryCode(token: string): boolean {
  return /[^0-9]/.test(token) || token.length > 6;
}
