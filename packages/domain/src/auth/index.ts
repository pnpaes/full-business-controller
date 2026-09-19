export {
  DEFAULT_ARGON2_OPTIONS,
  hashPassword,
  needsRehash,
  verifyPassword,
  verifyPasswordOrDummy,
} from "./argon2";
export type { Argon2CostOptions } from "./argon2";

export { AUTH_ERROR_GENERIC } from "./errors";

export { DEFAULT_LOCKOUT_POLICY, computeLockout, isLocked } from "./lockout";
export type { LockoutPolicy, LockoutThreshold } from "./lockout";

export { generateRecoveryCodes, hashRecoveryCodes, verifyRecoveryCode } from "./recovery-codes";

export {
  OPAQUE_TOKEN_BYTES,
  SESSION_TOKEN_BYTES,
  generateOpaqueToken,
  generatePasswordResetToken,
  generateSessionToken,
  hashOpaqueToken,
  hashPasswordResetToken,
  hashSessionToken,
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
