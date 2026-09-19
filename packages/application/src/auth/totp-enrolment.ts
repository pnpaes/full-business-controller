import {
  AUTH_ERROR_GENERIC,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCodes,
  openSecret,
  sealSecret,
  verifyPasswordOrDummy,
  verifyTotp,
} from "@aquarela/domain";
import type { VerifyTotpOptions } from "@aquarela/domain";

import { AUTH_AUDIT_ACTIONS } from "./actions";
import { audit } from "./audit";
import type { AuthDeps, AuthStore, AuthTotpRecord, AuthUser, RequestContext } from "./types";

/**
 * Enrolment half of TOTP MFA: begin, confirm, recovery-code regeneration and
 * disable. The verify half lives in `mfa.ts`.
 *
 * Secrets never leak: `beginTotpEnrolment` returns the base32 secret and the
 * `otpauth://` URI to the caller exactly once, `confirmTotpEnrolment` and
 * `regenerateRecoveryCodes` return plaintext recovery codes exactly once, and
 * none of those values is ever logged, stored or written to an audit row — only
 * `hashRecoveryCodes(...)` hashes are persisted.
 */

/**
 * Issuer shown in the authenticator app. Fixed until an organization-level
 * display name reaches this layer through configuration; the account label is
 * the user's username, falling back to email then id.
 */
const TOTP_ISSUER = "Aquarela Business Control";

/** Builds the standard `otpauth://totp/...` URI an authenticator app scans. */
export function totpEnrolmentUri(secret: string, issuer: string, account: string): string {
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  // `URLSearchParams` renders spaces as `+`; `%20` is the safer form for the
  // wide range of authenticator parsers (Google Authenticator, 1Password, …).
  const query = params.toString().replace(/\+/g, "%20");
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?${query}`;
}

export interface BeginTotpEnrolmentInput {
  readonly organizationId: string;
  readonly userId: string;
  /** Set when an admin initiates enrolment; absent for the user themself. */
  readonly actorId?: string;
  readonly request?: RequestContext;
}

/** Returned exactly once. Must not be logged, audited or persisted. */
export interface TotpEnrolmentSecret {
  readonly secret: string;
  readonly uri: string;
  readonly issuer: string;
  readonly account: string;
}

export type BeginTotpEnrolmentResult =
  ({ readonly ok: true } & TotpEnrolmentSecret) | { readonly ok: false; readonly error: string };

export interface ConfirmTotpEnrolmentInput {
  readonly organizationId: string;
  readonly userId: string;
  readonly token: string;
  readonly actorId?: string;
  readonly request?: RequestContext;
}

export interface RegenerateRecoveryCodesInput {
  readonly organizationId: string;
  readonly userId: string;
  readonly token: string;
  readonly actorId?: string;
  readonly request?: RequestContext;
}

export interface DisableTotpInput {
  readonly organizationId: string;
  readonly userId: string;
  readonly password: string;
  readonly actorId?: string;
  readonly request?: RequestContext;
}

/** Plaintext recovery codes, returned exactly once. Never logged or audited. */
export interface TotpRecoveryCodes {
  readonly recoveryCodes: readonly string[];
}

export type ConfirmTotpEnrolmentResult =
  ({ readonly ok: true } & TotpRecoveryCodes) | { readonly ok: false; readonly error: string };

export type RegenerateRecoveryCodesResult = ConfirmTotpEnrolmentResult;

export type DisableTotpResult =
  { readonly ok: true } | { readonly ok: false; readonly error: string };

interface AuditContext {
  readonly organizationId: string;
  readonly actorId: string;
  readonly entityId: string;
  readonly request?: RequestContext;
}

function isEligible(user: AuthUser | undefined, organizationId: string): user is AuthUser {
  return user !== undefined && user.status === "active" && user.organizationId === organizationId;
}

/** Audits the failure (never the presented code) and returns the generic error. */
async function failEnrolment(
  tx: AuthStore,
  context: AuditContext,
  reason: string,
): Promise<{ readonly ok: false; readonly error: string }> {
  await audit(tx, {
    organizationId: context.organizationId,
    actorId: context.actorId,
    action: AUTH_AUDIT_ACTIONS.mfaEnrolmentFailed,
    entityId: context.entityId,
    reason,
    ...(context.request !== undefined ? { request: context.request } : {}),
  });
  return { ok: false, error: AUTH_ERROR_GENERIC };
}

type VerificationOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * Opens the sealed secret and verifies a fresh TOTP code with the same window
 * and replay rules as `verifyMfa`: a match must be strictly newer than the
 * persisted counter, and the counter advances with an atomic compare-and-set so
 * a concurrent request cannot consume the same code twice.
 */
async function verifyFreshTotp(
  tx: AuthStore,
  userId: string,
  totp: AuthTotpRecord,
  key: Uint8Array,
  token: string,
  now: Date,
): Promise<VerificationOutcome> {
  let secret: string;
  try {
    secret = openSecret(totp.secretEncrypted, key);
  } catch {
    // Tampered or wrongly-keyed secret: fail closed, never throw into the
    // request path and never leak the cause.
    return { ok: false, reason: "secret_unseal_failed" };
  }

  const options: VerifyTotpOptions =
    totp.lastUsedCounter === null ? { now } : { now, lastUsedCounter: totp.lastUsedCounter };
  const result = verifyTotp(secret, token, options);
  if (!result.valid) {
    return { ok: false, reason: result.reason === "mismatch" ? "invalid_code" : result.reason };
  }

  const advanced = await tx.advanceLastUsedCounter(userId, result.counter);
  return advanced ? { ok: true } : { ok: false, reason: "replayed" };
}

/**
 * Starts TOTP enrolment. Mints a secret, stores it sealed and unconfirmed
 * (clearing any stale confirmation state), audits `auth.mfa.enrolment_started`
 * and returns the secret, the `otpauth://` URI and the issuer/account label
 * **once**. A missing encryption key fails closed with the generic error and an
 * audit row, exactly as `verifyMfa`; the secret and URI never reach the audit.
 *
 * Re-enrolment of a live factor is refused (`already_enabled`): disable first,
 * so an abandoned begin can never leave MFA half-configured.
 */
export async function beginTotpEnrolment(
  store: AuthStore,
  deps: AuthDeps,
  input: BeginTotpEnrolmentInput,
): Promise<BeginTotpEnrolmentResult> {
  return store.withTransaction(async (tx) => {
    const context: AuditContext = {
      organizationId: input.organizationId,
      actorId: input.actorId ?? input.userId,
      entityId: input.userId,
      ...(input.request !== undefined ? { request: input.request } : {}),
    };

    const user = await tx.findUserById(input.userId);
    if (!isEligible(user, input.organizationId)) {
      return failEnrolment(tx, context, "user_not_active");
    }
    if (user.totpEnabled) {
      return failEnrolment(tx, context, "already_enabled");
    }

    const key = deps.totpEncryptionKey;
    if (key === undefined) {
      // Boot-time config validation in `packages/config` is what catches the
      // misconfiguration; here it must not become a 500 that reveals MFA state.
      return failEnrolment(tx, context, "config_missing");
    }

    const secret = generateTotpSecret();
    await tx.setTotpSecret(user.id, sealSecret(secret, key));
    await audit(tx, {
      organizationId: context.organizationId,
      actorId: context.actorId,
      action: AUTH_AUDIT_ACTIONS.mfaEnrolmentStarted,
      entityId: user.id,
      ...(context.request !== undefined ? { request: context.request } : {}),
    });

    const account = user.username ?? user.email ?? user.id;
    return {
      ok: true,
      secret,
      issuer: TOTP_ISSUER,
      account,
      uri: totpEnrolmentUri(secret, TOTP_ISSUER, account),
    };
  });
}

/**
 * Confirms enrolment with a valid RFC-6238 code, replaces the recovery-code set
 * with freshly hashed codes, flips `totpEnabled`, audits
 * `auth.mfa.enrolment_confirmed` and returns the plaintext codes **once**. A
 * wrong, replayed, expired or unsealed code yields the generic error with an
 * audited reason and leaves the enrolment unconfirmed. State and audit commit
 * together (`withTransaction`).
 */
export async function confirmTotpEnrolment(
  store: AuthStore,
  deps: AuthDeps,
  input: ConfirmTotpEnrolmentInput,
): Promise<ConfirmTotpEnrolmentResult> {
  return store.withTransaction(async (tx) => {
    const now = deps.now ?? new Date();
    const context: AuditContext = {
      organizationId: input.organizationId,
      actorId: input.actorId ?? input.userId,
      entityId: input.userId,
      ...(input.request !== undefined ? { request: input.request } : {}),
    };

    const user = await tx.findUserById(input.userId);
    if (!isEligible(user, input.organizationId)) {
      return failEnrolment(tx, context, "user_not_active");
    }

    const totp = await tx.getTotp(user.id);
    if (totp === undefined) {
      return failEnrolment(tx, context, "no_enrolment");
    }
    if (totp.confirmedAt !== null) {
      return failEnrolment(tx, context, "already_confirmed");
    }

    const key = deps.totpEncryptionKey;
    if (key === undefined) {
      return failEnrolment(tx, context, "config_missing");
    }

    const verification = await verifyFreshTotp(tx, user.id, totp, key, input.token, now);
    if (!verification.ok) {
      return failEnrolment(tx, context, verification.reason);
    }

    const recoveryCodes = generateRecoveryCodes();
    await tx.confirmTotp(user.id, now);
    await tx.setRecoveryCodes(
      user.id,
      await hashRecoveryCodes(recoveryCodes, deps.passwordHashOptions),
    );
    await tx.setTotpEnabled(user.id, true);
    await audit(tx, {
      organizationId: context.organizationId,
      actorId: context.actorId,
      action: AUTH_AUDIT_ACTIONS.mfaEnrolmentConfirmed,
      entityId: user.id,
      ...(context.request !== undefined ? { request: context.request } : {}),
    });
    return { ok: true, recoveryCodes };
  });
}

/**
 * Replaces the recovery-code set for an already-confirmed enrolment. Requires a
 * fresh valid TOTP code verified against the persisted counter (advanced by the
 * atomic compare-and-set), so an old code cannot authorise a reset. Returns the
 * new plaintext codes once; the previous set is invalidated by replacement.
 */
export async function regenerateRecoveryCodes(
  store: AuthStore,
  deps: AuthDeps,
  input: RegenerateRecoveryCodesInput,
): Promise<RegenerateRecoveryCodesResult> {
  return store.withTransaction(async (tx) => {
    const now = deps.now ?? new Date();
    const context: AuditContext = {
      organizationId: input.organizationId,
      actorId: input.actorId ?? input.userId,
      entityId: input.userId,
      ...(input.request !== undefined ? { request: input.request } : {}),
    };

    const user = await tx.findUserById(input.userId);
    if (!isEligible(user, input.organizationId)) {
      return failEnrolment(tx, context, "user_not_active");
    }

    const totp = await tx.getTotp(user.id);
    if (totp === undefined || totp.confirmedAt === null) {
      return failEnrolment(tx, context, "no_confirmed_enrolment");
    }

    const key = deps.totpEncryptionKey;
    if (key === undefined) {
      return failEnrolment(tx, context, "config_missing");
    }

    const verification = await verifyFreshTotp(tx, user.id, totp, key, input.token, now);
    if (!verification.ok) {
      return failEnrolment(tx, context, `regenerate_${verification.reason}`);
    }

    const recoveryCodes = generateRecoveryCodes();
    await tx.setRecoveryCodes(
      user.id,
      await hashRecoveryCodes(recoveryCodes, deps.passwordHashOptions),
    );
    await audit(tx, {
      organizationId: context.organizationId,
      actorId: context.actorId,
      action: AUTH_AUDIT_ACTIONS.mfaRecoveryRegenerated,
      entityId: user.id,
      ...(context.request !== undefined ? { request: context.request } : {}),
    });
    return { ok: true, recoveryCodes };
  });
}

/**
 * Disables TOTP: requires the user's password (verified through
 * `verifyPasswordOrDummy`, so an unknown account still pays one hash), revokes
 * every session for the user, clears the enrolment and recovery codes and flips
 * `totpEnabled` off — all in one transaction — auditing `auth.mfa.disabled` with
 * the number of revoked sessions in its diff. A wrong password yields the generic
 * error and changes nothing: MFA stays enabled and no session is revoked.
 *
 * Revoking in the same transaction is the security point: disabling a mandated
 * second factor (ADR-0003) without revoking would leave sessions issued under MFA
 * live while MFA is off, so a crash between the two would open an escalation
 * window. They can no longer be separated.
 */
export async function disableTotp(
  store: AuthStore,
  deps: AuthDeps,
  input: DisableTotpInput,
): Promise<DisableTotpResult> {
  return store.withTransaction(async (tx) => {
    const now = deps.now ?? new Date();
    const context: AuditContext = {
      organizationId: input.organizationId,
      actorId: input.actorId ?? input.userId,
      entityId: input.userId,
      ...(input.request !== undefined ? { request: input.request } : {}),
    };

    const user = await tx.findUserById(input.userId);
    // Always pay one verification, even for an unknown user, so timing does not
    // reveal whether the account exists (ADR-0003).
    const passwordOk = await verifyPasswordOrDummy(user?.passwordHash ?? null, input.password);

    if (!isEligible(user, input.organizationId)) {
      await audit(tx, {
        organizationId: context.organizationId,
        actorId: context.actorId,
        action: AUTH_AUDIT_ACTIONS.mfaDisableFailed,
        entityId: context.entityId,
        reason: "user_not_active",
        ...(context.request !== undefined ? { request: context.request } : {}),
      });
      return { ok: false, error: AUTH_ERROR_GENERIC };
    }

    if (!passwordOk) {
      await audit(tx, {
        organizationId: context.organizationId,
        actorId: context.actorId,
        action: AUTH_AUDIT_ACTIONS.mfaDisableFailed,
        entityId: context.entityId,
        reason: "bad_password",
        ...(context.request !== undefined ? { request: context.request } : {}),
      });
      return { ok: false, error: AUTH_ERROR_GENERIC };
    }

    const sessionsRevoked = await tx.revokeAllSessionsForUser(user.id, now);
    await tx.clearTotp(user.id);
    await tx.setTotpEnabled(user.id, false);
    await audit(tx, {
      organizationId: context.organizationId,
      actorId: context.actorId,
      action: AUTH_AUDIT_ACTIONS.mfaDisabled,
      entityId: user.id,
      after: { sessionsRevoked },
      ...(context.request !== undefined ? { request: context.request } : {}),
    });
    return { ok: true };
  });
}
