import type { AuthDeps } from "@aquarela/application";
import { parseSecretKey } from "@aquarela/domain";
import { createLogger } from "@aquarela/logger";

import { getConfig } from "./config";
import { createSendGridMailAdapter, type SendGridMailAdapter } from "./mail";

const logger = createLogger({ name: "web-auth" });

/**
 * The SendGrid adapter, built from the validated configuration. The adapter
 * fails closed: without `SENDGRID_API_KEY`/`MAIL_FROM`/`APP_BASE_URL` it sends
 * nothing, so reset and invite delivery stay admin-issued.
 */
function getMailAdapter(): SendGridMailAdapter {
  const config = getConfig();
  return createSendGridMailAdapter({
    apiKey: config.SENDGRID_API_KEY,
    from: config.MAIL_FROM,
    baseUrl: config.APP_BASE_URL,
    logger,
  });
}

/**
 * Assembles `AuthDeps` from validated environment configuration. The reset
 * token's only exit is `deliverResetToken`, which hands the plaintext to the
 * SendGrid `MailPort` (`DEC-147`) and never logs it; a transport failure is
 * logged (without the token) rather than thrown, keeping the request
 * enumeration-safe. Invite delivery is driven by the provisioning route through
 * `deliverInviteEmail` (`DEC-146`), so the plaintext invite token never leaves
 * the request either.
 */
export function getAuthDeps(): AuthDeps {
  const config = getConfig();
  const encodedKey = config.TOTP_SECRET_ENCRYPTION_KEY;
  const adapter = getMailAdapter();

  const deliverResetToken: NonNullable<AuthDeps["deliverResetToken"]> = async (delivery) => {
    if (delivery.email === null || delivery.email.length === 0) {
      logger.warn(
        { userId: delivery.userId },
        "password reset not delivered: the account has no email address",
      );
      return;
    }
    try {
      await adapter.sendPasswordResetEmail({
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
    inviteTtlMinutes: config.INVITE_TTL_MINUTES,
    ...(encodedKey === undefined ? {} : { totpEncryptionKey: parseSecretKey(encodedKey) }),
    deliverResetToken,
  };
}

export interface InviteDelivery {
  readonly organizationId: string;
  readonly userId: string;
  readonly email: string | null;
  readonly token: string;
}

/**
 * Delivers one employee invite (`DEC-146`). Called by the provisioning route
 * with the plaintext token the command returned; the token is handed straight to
 * the mail port and is never logged, persisted or returned. A transport failure
 * is logged without the token rather than thrown: the invite row is already
 * stored, so the operator can re-issue, and the response must stay generic.
 */
export async function deliverInviteEmail(delivery: InviteDelivery): Promise<void> {
  if (delivery.email === null || delivery.email.length === 0) {
    logger.warn(
      { userId: delivery.userId },
      "invite not delivered: the account has no email address",
    );
    return;
  }
  try {
    await getMailAdapter().sendInviteEmail({
      to: delivery.email,
      token: delivery.token,
      expiresInMinutes: getConfig().INVITE_TTL_MINUTES,
    });
  } catch (error) {
    logger.error(
      { err: error, userId: delivery.userId },
      "invite email delivery failed; the account stays pending",
    );
  }
}
