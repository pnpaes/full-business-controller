import {
  AUTH_ERROR_GENERIC,
  computeLockout,
  isLocked,
  openSecret,
  verifyRecoveryCode,
  verifyTotp,
} from "@aquarela/domain";
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
 * Second factor: a fresh TOTP code, or a single-use recovery code.
 *
 * Failures count against the shared progressive-lockout counter (ADR-0003
 * requires lockout on 2FA attempts too), and a success resets it. Both the TOTP
 * counter advance and the recovery-code removal are atomic compare-and-sets, so
 * two concurrent requests cannot both consume the same code. Every outcome is
 * audited inside the same transaction and every failure is generic.
 */
export async function verifyMfa(
  store: AuthStore,
  deps: AuthDeps,
  input: VerifyMfaInput,
): Promise<VerifyMfaResult> {
  return store.withTransaction(async (tx) => {
    const now = deps.now ?? new Date();
    const generic: VerifyMfaResult = { ok: false, error: AUTH_ERROR_GENERIC };
    const context = {
      organizationId: input.organizationId,
      actorId: input.userId,
      entityId: input.userId,
    };

    const user = await tx.findUserById(input.userId);
    if (user === undefined || user.status !== "active") {
      await audit(tx, {
        ...context,
        action: AUTH_AUDIT_ACTIONS.mfaFailed,
        reason: "user_not_active",
      });
      return generic;
    }

    if (isLocked(user.lockedUntil, now)) {
      await audit(tx, { ...context, action: AUTH_AUDIT_ACTIONS.mfaFailed, reason: "locked" });
      return generic;
    }

    const totp = await tx.getTotp(user.id);
    if (totp === undefined || totp.confirmedAt === null) {
      await audit(tx, {
        ...context,
        action: AUTH_AUDIT_ACTIONS.mfaFailed,
        reason: "no_confirmed_totp",
      });
      return generic;
    }

    const key = deps.totpEncryptionKey;
    if (key === undefined) {
      // A missing key is a server misconfiguration, but throwing here would turn
      // it into a 500 (DoS) and reveal that MFA is enrolled. Fail closed with the
      // generic error and an audit row instead; boot-time config validation in
      // `packages/config` is what catches the misconfiguration.
      await audit(tx, {
        ...context,
        action: AUTH_AUDIT_ACTIONS.mfaFailed,
        reason: "config_missing",
      });
      return generic;
    }

    let secret: string;
    try {
      secret = openSecret(totp.secretEncrypted, key);
    } catch {
      // A tampered or wrongly-keyed secret is a data fault: fail closed, audit
      // it, and never throw into the request path or leak the cause.
      await audit(tx, {
        ...context,
        action: AUTH_AUDIT_ACTIONS.mfaFailed,
        reason: "secret_unseal_failed",
      });
      return generic;
    }

    const options: VerifyTotpOptions =
      totp.lastUsedCounter === null ? { now } : { now, lastUsedCounter: totp.lastUsedCounter };
    const result = verifyTotp(secret, input.token, options);

    if (result.valid) {
      const advanced = await tx.advanceLastUsedCounter(user.id, result.counter);
      if (!advanced) {
        await audit(tx, { ...context, action: AUTH_AUDIT_ACTIONS.mfaFailed, reason: "replayed" });
        return generic;
      }
      await tx.recordLoginSuccess(user.id, now);
      const session = await issueSession(tx, deps, user, now, input.request);
      await audit(tx, { ...context, action: AUTH_AUDIT_ACTIONS.mfaSucceeded });
      return { ok: true, session };
    }

    if (totp.recoveryCodesHash.length > 0 && looksLikeRecoveryCode(input.token)) {
      const index = await verifyRecoveryCode(totp.recoveryCodesHash, input.token);
      const matchedHash = index === null ? undefined : totp.recoveryCodesHash[index];
      if (matchedHash !== undefined) {
        const consumed = await tx.consumeRecoveryCodeHash(user.id, matchedHash);
        if (!consumed) {
          await audit(tx, { ...context, action: AUTH_AUDIT_ACTIONS.mfaFailed, reason: "replayed" });
          return generic;
        }
        await tx.recordLoginSuccess(user.id, now);
        const session = await issueSession(tx, deps, user, now, input.request);
        await audit(tx, {
          ...context,
          action: AUTH_AUDIT_ACTIONS.mfaRecoveryUsed,
          reason: "recovery_code",
        });
        return { ok: true, session };
      }
    }

    const nextCount = user.failedLoginCount + 1;
    const lockedUntil = computeLockout(nextCount, now).lockedUntil;
    await tx.recordLoginFailure(user.id, { lockedUntil, at: now });
    await audit(tx, {
      ...context,
      action: AUTH_AUDIT_ACTIONS.mfaFailed,
      reason: lockedUntil === null ? result.reason : "lockout_applied",
    });
    return generic;
  });
}

/**
 * A 6-digit token is never a recovery code (they are longer and contain
 * separators), so this keeps a mistyped TOTP code from paying for ten Argon2
 * comparisons.
 */
function looksLikeRecoveryCode(token: string): boolean {
  return /[^0-9]/.test(token) || token.length > 6;
}
