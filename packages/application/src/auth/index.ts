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

export { verifyMfa } from "./mfa";
export type { VerifyMfaInput, VerifyMfaResult } from "./mfa";

export { beginPasswordReset, completePasswordReset } from "./password-reset";
export type {
  BeginPasswordResetInput,
  BeginPasswordResetResult,
  CompletePasswordResetInput,
  CompletePasswordResetResult,
} from "./password-reset";

export { createPostgresAuthStore } from "./postgres-store";

export { issueSession, logout, logoutAll, verifySession } from "./session";
export type { LogoutAllInput, LogoutInput } from "./session";

export type {
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
