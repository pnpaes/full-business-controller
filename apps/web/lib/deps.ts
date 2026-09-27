import type { AuthDeps } from "@aquarela/application";
import { parseSecretKey } from "@aquarela/domain";
import { createLogger } from "@aquarela/logger";

import { getConfig } from "./config";
import { createSendGridMailAdapter } from "./mail";

const logger = createLogger({ name: "web-auth" });

/**
 * Assembles `AuthDeps` from validated environment configuration. The reset
 * token's only exit is `deliverResetToken`, which hands the plaintext to the
 * SendGrid `MailPort` (`DEC-147`) and never logs it. The adapter fails closed:
 * without `SENDGRID_API_KEY`/`MAIL_FROM`/`APP_BASE_URL` it sends nothing, so the
 * reset stays admin-issued, and a transport failure is logged (without the
 * token) rather than thrown, keeping the request enumeration-safe.
 */
export function getAuthDeps(): AuthDeps {
  const config = getConfig();
  const encodedKey = config.TOTP_SECRET_ENCRYPTION_KEY;
  const mail = createSendGridMailAdapter({
    apiKey: config.SENDGRID_API_KEY,
    from: config.MAIL_FROM,
    baseUrl: config.APP_BASE_URL,
    logger,
  });

  const deliverResetToken: NonNullable<AuthDeps["deliverResetToken"]> = async (delivery) => {
    if (delivery.email === null || delivery.email.length === 0) {
      logger.warn(
        { userId: delivery.userId },
        "password reset not delivered: the account has no email address",
      );
      return;
    }
    try {
      await mail.sendPasswordResetEmail({
        to: delivery.email,
        token: delivery.token,
        expiresInMinutes: config.PASSWORD_RESET_TTL_MINUTES,
      });
    } catch (error) {
      // Never rethrow: the token is already stored, the response must stay
      // generic, and the error text carries no token.
      logger.error(
        { err: error, userId: delivery.userId },
        "password reset email delivery failed; the reset stays admin-issued",
      );
    }
  };

  return {
    sessionTtlMinutes: config.SESSION_TTL_MINUTES,
    passwordResetTtlMinutes: config.PASSWORD_RESET_TTL_MINUTES,
    ...(encodedKey === undefined ? {} : { totpEncryptionKey: parseSecretKey(encodedKey) }),
    deliverResetToken,
  };
}
