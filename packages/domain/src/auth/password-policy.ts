import { DomainError } from "../errors";

/**
 * Minimum credential length for every path that sets a password (invite
 * acceptance and self-service/admin reset). It lives in the auth domain so both
 * flows share one number instead of drifting.
 */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * The one generic message a password-policy failure carries. It names no
 * specific rule and no credential, so the response cannot reveal which check
 * failed or help enumerate accounts (ADR-0003).
 */
export const AUTH_ERROR_PASSWORD_POLICY = "Password does not meet the required policy." as const;

/**
 * Enforces the single password policy for every credential-setting path. Rejects
 * a password shorter than {@link MIN_PASSWORD_LENGTH} and a whitespace-only
 * password (even when it reaches the length floor). Throws a `DomainError`
 * carrying the generic policy message; callers map that to their single generic
 * auth failure so the response does not leak the reason.
 */
export function assertPasswordPolicy(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH || password.trim().length === 0) {
    throw new DomainError(AUTH_ERROR_PASSWORD_POLICY);
  }
}
