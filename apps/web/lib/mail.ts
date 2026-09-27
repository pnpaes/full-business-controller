import type { MailPort, PasswordResetEmailMessage } from "@aquarela/application";
import { createLogger } from "@aquarela/logger";

/**
 * SendGrid HTTP adapter for the `MailPort` (`DEC-147`). It is the only
 * password-reset transport; there is no SMTP fallback. Every field is read at
 * the edge (validated `AppConfig` in `deps.ts`), so the adapter is a pure
 * transport and is unit-testable with a stubbed `fetch`.
 *
 * Fail-closed: unless `SENDGRID_API_KEY`, `MAIL_FROM` and `APP_BASE_URL` are all
 * set, `configured` is false and every send is a no-op that logs one warning —
 * the reset token is still minted and stored, so the reset stays admin-issued.
 *
 * The plaintext token appears only inside the message body. No log call here
 * ever receives it, and the shared logger redacts `token`/`*.token` paths anyway.
 */
const SENDGRID_ENDPOINT = "https://api.sendgrid.com/v3/mail/send";
const DEFAULT_TIMEOUT_MS = 10_000;

/** The subset of a logger the adapter uses; keeps it decoupled from pino. */
export interface MailLogger {
  warn(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}

export interface SendGridMailAdapterOptions {
  readonly apiKey?: string | undefined;
  readonly from?: string | undefined;
  /** App origin used to build the token-free reset-page link. */
  readonly baseUrl?: string | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
  readonly logger?: MailLogger | undefined;
  readonly timeoutMs?: number | undefined;
}

export interface SendGridMailAdapter extends MailPort {
  /** True only when the key, sender and base URL are all present. */
  readonly configured: boolean;
}

/** Trims a value and treats blank as absent, so `""` cannot enable the channel. */
function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
}

/** `Name <addr@example.no>` or a bare address → SendGrid's `{ email, name? }`. */
export function parseMailFrom(value: string): { email: string; name?: string } {
  const match = /^\s*(.*?)\s*<\s*([^>]+?)\s*>\s*$/u.exec(value);
  const email = present(match?.[2] ?? value) ?? value;
  const name = present(match?.[1]);
  return name === undefined ? { email } : { email, name };
}

/** Absolute reset-page URL; carries no token (ADR-0003). */
export function buildPasswordResetUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/u, "")}/reset/complete`;
}

export function createSendGridMailAdapter(
  options: SendGridMailAdapterOptions = {},
): SendGridMailAdapter {
  const apiKey = present(options.apiKey);
  const from = present(options.from);
  const baseUrl = present(options.baseUrl);
  const logger = options.logger ?? createLogger({ name: "web-mail" });
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const configured = apiKey !== undefined && from !== undefined && baseUrl !== undefined;

  return {
    configured,
    async sendPasswordResetEmail(message: PasswordResetEmailMessage): Promise<void> {
      if (!configured) {
        logger.warn(
          {},
          "password reset email not sent: SENDGRID_API_KEY, MAIL_FROM and APP_BASE_URL must all be set; the reset stays admin-issued",
        );
        return;
      }

      const resetUrl = buildPasswordResetUrl(baseUrl);
      const subject = "Reset your Aquarela password";
      const text = [
        "A password reset was requested for this address.",
        "",
        `Open ${resetUrl} and enter this reset code:`,
        "",
        message.token,
        "",
        `The code expires in ${message.expiresInMinutes} minutes. If you did not request it, ignore this email.`,
      ].join("\n");
      const html = [
        "<p>A password reset was requested for this address.</p>",
        `<p><a href="${resetUrl}">Open the reset page</a> and enter this reset code:</p>`,
        `<p><code>${message.token}</code></p>`,
        `<p>The code expires in ${message.expiresInMinutes} minutes. If you did not request it, ignore this email.</p>`,
      ].join("");

      const response = await fetchImpl(SENDGRID_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: message.to }] }],
          from: parseMailFrom(from),
          subject,
          content: [
            { type: "text/plain", value: text },
            { type: "text/html", value: html },
          ],
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      // SendGrid accepts with 202 and an empty body; anything else is a failure.
      if (response.status !== 202) {
        throw new Error(`sendgrid email delivery failed with status ${response.status}`);
      }
    },
  };
}
