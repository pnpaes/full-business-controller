export { AUTH_AUDIT_ACTIONS } from "./actions";
export type { AuthAuditAction } from "./actions";

export {
  assignRole,
  disableUser,
  isAuthorizedFor,
  loadUserAccess,
  replaceLocationScopes,
} from "./access";
export type {
  AccessRequirement,
  AssignRoleInput,
  DisableUserInput,
  ReplaceLocationScopesInput,
  UserAccess,
} from "./access";

export { authenticate } from "./authenticate";
export type { AuthenticateInput, AuthenticateResult } from "./authenticate";

export {
  MIN_BOOTSTRAP_PASSWORD_LENGTH,
  bootstrapFirstOwner,
  createPostgresBootstrapStore,
  planBootstrapFirstOwner,
} from "./bootstrap";
export type {
  BootstrapDeps,
  BootstrapFailure,
  BootstrapFirstOwnerInput,
  BootstrapFirstOwnerPlanResult,
  BootstrapFirstOwnerResult,
  BootstrapGrant,
  BootstrapNewOwner,
  BootstrapOrganization,
  BootstrapPlan,
  BootstrapRole,
  BootstrapStore,
} from "./bootstrap";

export { verifyMfa } from "./mfa";
export type { VerifyMfaInput, VerifyMfaResult } from "./mfa";

export {
  beginTotpEnrolment,
  confirmTotpEnrolment,
  disableTotp,
  regenerateRecoveryCodes,
  totpEnrolmentUri,
} from "./totp-enrolment";
export type {
  BeginTotpEnrolmentInput,
  BeginTotpEnrolmentResult,
  ConfirmTotpEnrolmentInput,
  ConfirmTotpEnrolmentResult,
  DisableTotpInput,
  DisableTotpResult,
  RegenerateRecoveryCodesInput,
  RegenerateRecoveryCodesResult,
  TotpEnrolmentSecret,
  TotpRecoveryCodes,
} from "./totp-enrolment";

export { beginPasswordReset, completePasswordReset } from "./password-reset";
export type {
  BeginPasswordResetInput,
  BeginPasswordResetResult,
  CompletePasswordResetInput,
  CompletePasswordResetResult,
} from "./password-reset";

export { createPostgresAuthStore } from "./postgres-store";

export {
  DEFAULT_AUDIT_EVENT_LIMIT,
  MAX_AUDIT_EVENT_LIMIT,
  listAuditEvents,
} from "./list-audit-events";
export type { ListAuditEventsQuery } from "./list-audit-events";

export { issueSession, logout, logoutAll, verifySession } from "./session";
export type { LogoutAllInput, LogoutInput } from "./session";

export type {
  AuditEventListQuery,
  AuditEventRecord,
  AuditInput,
  AuthDeps,
  AuthResetTokenRecord,
  AuthRoleAssignment,
  AuthSessionRecord,
  AuthStore,
  AuthTotpRecord,
  AuthUser,
  CreateResetTokenInput,
  CreateSessionInput,
  IssuedSession,
  RequestContext,
  RoleAssignmentInput,
  RoleRemovalInput,
} from "./types";
