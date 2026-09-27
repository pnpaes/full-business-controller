/**
 * Outbound password-reset mail port (`DEC-147`). The application layer owns this
 * contract only; the concrete transport (SendGrid's HTTP API) lives in the runtime
 * layer (`apps/web/lib/mail.ts`), so `beginPasswordReset` never imports a
 * provider.
 *
 * `ADR-0003` keeps opaque tokens out of URLs, so the recipient address and the
 * single-use code travel separately from the token-free reset-page link the
 * adapter builds from `APP_BASE_URL`; the recipient pastes the code into the
 * reset form. The code is the plaintext reset token and must never be logged,
 * persisted or returned by any adapter.
 */
export interface PasswordResetEmailMessage {
  /** The recipient address (a user's `email`). */
  readonly to: string;
  /** The single-use plaintext reset token. Never log, persist or return it. */
  readonly token: string;
  /** Remaining validity, for the message body (from `PASSWORD_RESET_TTL_MINUTES`). */
  readonly expiresInMinutes: number;
}

/**
 * One manager-issued employee account invite (`DEC-146`). Same token discipline
 * as the reset message: the plaintext invite token appears only in the body, the
 * link is token-free and the recipient pastes the code into the accept form.
 */
export interface InviteEmailMessage {
  /** The recipient address (the employee's email). */
  readonly to: string;
  /** The single-use plaintext invite token. Never log, persist or return it. */
  readonly token: string;
  /** Remaining validity, for the message body (from `INVITE_TTL_MINUTES`). */
  readonly expiresInMinutes: number;
}

export interface MailPort {
  /**
   * Delivers one password-reset message. A "not configured" adapter resolves
   * without sending (fail closed); a transport failure throws so the runtime
   * caller can log it without exposing the token.
   */
  sendPasswordResetEmail(message: PasswordResetEmailMessage): Promise<void>;
  /**
   * Delivers one employee account invite. Same contract: fail closed without
   * configuration, throw on transport failure, never log the token.
   */
  sendInviteEmail(message: InviteEmailMessage): Promise<void>;
}
