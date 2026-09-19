import type { AuthDeps } from "@aquarela/application";
import { parseSecretKey } from "@aquarela/domain";

import { getConfig } from "./config";

/**
 * Out-of-band reset-token delivery stub. The application mints and stores only
 * the token hash and hands the plaintext here once, for the not-yet-built email
 * channel. Until that channel exists the token is dropped: this function must
 * never log, return or persist it. The admin-assisted reset (an ADR-0003 open
 * item) is the interim recovery path for staff without email.
 */
const deliverResetToken: NonNullable<AuthDeps["deliverResetToken"]> = async () => {};

/** Assembles `AuthDeps` from validated environment configuration. */
export function getAuthDeps(): AuthDeps {
  const config = getConfig();
  const encodedKey = config.TOTP_SECRET_ENCRYPTION_KEY;
  return {
    sessionTtlMinutes: config.SESSION_TTL_MINUTES,
    passwordResetTtlMinutes: config.PASSWORD_RESET_TTL_MINUTES,
    ...(encodedKey === undefined ? {} : { totpEncryptionKey: parseSecretKey(encodedKey) }),
    deliverResetToken,
  };
}
