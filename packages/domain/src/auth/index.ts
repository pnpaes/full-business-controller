export {
  DEFAULT_ARGON2_OPTIONS,
  hashPassword,
  needsRehash,
  verifyPassword,
  verifyPasswordOrDummy,
} from "./argon2";
export type { Argon2CostOptions } from "./argon2";

export { AUTH_ERROR_GENERIC } from "./errors";

export {
  AUTH_ERROR_PASSWORD_POLICY,
  MIN_PASSWORD_LENGTH,
  assertPasswordPolicy,
} from "./password-policy";

export { DEFAULT_LOCKOUT_POLICY, computeLockout, isLocked } from "./lockout";
export type { LockoutPolicy, LockoutThreshold } from "./lockout";

export { generateRecoveryCodes, hashRecoveryCodes, verifyRecoveryCode } from "./recovery-codes";

export { openSecret, parseSecretKey, sealSecret } from "./secret-box";

export {
  OPAQUE_TOKEN_BYTES,
  SESSION_TOKEN_BYTES,
  generateInviteToken,
  generateOpaqueToken,
  generatePasswordResetToken,
  generateSessionToken,
  hashInviteToken,
  hashOpaqueToken,
  hashPasswordResetToken,
  hashSessionToken,
  inviteTokenMatches,
  opaqueTokenMatches,
  passwordResetTokenMatches,
  sessionTokenMatches,
} from "./tokens";

export {
  TOTP_PERIOD_SECONDS,
  TOTP_SECRET_BYTES,
  base32Decode,
  base32Encode,
  generateTotpSecret,
  totpCode,
  verifyTotp,
} from "./totp";
export type { TotpVerificationResult, VerifyTotpOptions } from "./totp";
