/**
 * Audit action vocabulary for authentication (ADR-0003: "Audit every
 * login/security change and every permission change"). The values are the
 * `audit_event.action` strings; keeping them here stops handlers from drifting
 * into near-duplicate names.
 */
export const AUTH_AUDIT_ACTIONS = {
  loginSucceeded: "auth.login.succeeded",
  loginFailed: "auth.login.failed",
  loginLocked: "auth.login.locked",
  loginDisabled: "auth.login.disabled",
  loginUnknown: "auth.login.unknown",
  loginMfaRequired: "auth.login.mfa_required",
  mfaSucceeded: "auth.mfa.succeeded",
  mfaFailed: "auth.mfa.failed",
  mfaRecoveryUsed: "auth.mfa.recovery_used",
  mfaEnrolmentStarted: "auth.mfa.enrolment_started",
  mfaEnrolmentConfirmed: "auth.mfa.enrolment_confirmed",
  /**
   * Enrolment-management failure (start, confirm or recovery-code regeneration).
   * The `reason` names the operation and cause; the plaintext secret, code and
   * returned recovery codes never reach an audit row.
   */
  mfaEnrolmentFailed: "auth.mfa.enrolment_failed",
  mfaRecoveryRegenerated: "auth.mfa.recovery_regenerated",
  mfaDisabled: "auth.mfa.disabled",
  mfaDisableFailed: "auth.mfa.disable_failed",
  sessionRevoked: "auth.session.revoked",
  sessionsRevokedAll: "auth.session.revoked_all",
  passwordResetRequested: "auth.password_reset.requested",
  passwordResetCompleted: "auth.password_reset.completed",
  passwordResetFailed: "auth.password_reset.failed",
  /** A manager provisioned an employee account and issued an invite (`DEC-146`). */
  userInvited: "auth.user.invited",
  /** An invited employee set their own password and the account became active. */
  inviteAccepted: "auth.user.invite_accepted",
  /** An invite redemption failed (unknown, expired, revoked or already used). */
  inviteFailed: "auth.user.invite_failed",
  accessRoleChanged: "auth.access.role_changed",
  accessScopesChanged: "auth.access.scopes_changed",
  userDisabled: "auth.user.disabled",
  /** The inverse of `userDisabled`: the account is reactivated. */
  userEnabled: "auth.user.enabled",
  bootstrapOwnerCreated: "auth.bootstrap.owner_created",
} as const;

export type AuthAuditAction = (typeof AUTH_AUDIT_ACTIONS)[keyof typeof AUTH_AUDIT_ACTIONS];
