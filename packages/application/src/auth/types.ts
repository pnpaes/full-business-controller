import type { Argon2CostOptions } from "@aquarela/domain";
import type { UserStatus } from "@aquarela/persistence";

/**
 * Application-level ports and DTOs for authentication. The store is a narrow
 * port over persistence so the flow logic can be unit-tested against an
 * in-memory fake while the real adapter (`createPostgresAuthStore`) delegates to
 * `@aquarela/persistence`. Types are structural subsets of the persistence rows,
 * so the adapter can pass rows straight through.
 */

export interface AuthUser {
  readonly id: string;
  readonly organizationId: string;
  readonly username: string | null;
  readonly email: string | null;
  readonly displayName: string;
  readonly status: UserStatus;
  readonly passwordHash: string;
  readonly failedLoginCount: number;
  readonly lockedUntil: Date | null;
  readonly lastLoginAt: Date | null;
  readonly totpEnabled: boolean;
}

/** One role as the catalogue read exposes it (no secrets, no grants). */
export interface AuthRoleRecord {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
}

/**
 * One user's management row (`07_SECURITY_AND_NFR.md` §7.1 "Users/configuration"):
 * identity, status and the access that matters to a reviewer — roles (with their
 * optional location) and location scopes. It deliberately omits `password_hash`,
 * every `totp_*` secret and recovery codes.
 */
export interface AuthUserSummary {
  readonly id: string;
  readonly username: string | null;
  readonly email: string | null;
  readonly displayName: string;
  readonly status: UserStatus;
  readonly totpEnabled: boolean;
  readonly lastLoginAt: Date | null;
  readonly roles: readonly AuthRoleAssignment[];
  readonly locationIds: readonly string[];
}

/** The bounded, organization-scoped page the management screen reads. */
export interface AuthUserListQuery {
  readonly organizationId: string;
  readonly limit: number;
  readonly offset: number;
}

export interface AuthTotpRecord {
  readonly secretEncrypted: string;
  readonly confirmedAt: Date | null;
  readonly recoveryCodesHash: readonly string[];
  readonly lastUsedCounter: number | null;
}

export interface AuthSessionRecord {
  readonly id: string;
  readonly userId: string;
  readonly expiresAt: Date;
}

export interface AuditInput {
  readonly organizationId: string;
  readonly actorId: string | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly reason?: string;
  readonly requestId?: string;
  /** Security-change diff (ADR-0003). Never contains secrets, tokens or hashes. */
  readonly before?: unknown;
  readonly after?: unknown;
}

/**
 * One `audit_event` row as the review read sees it (`07_SECURITY_AND_NFR.md`
 * §7.3). `occurred_at` crosses the port as an ISO string like every other
 * `timestamptz`; the diffs and impersonation context stay `unknown` (jsonb).
 */
export interface AuditEventRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly actorId: string | null;
  readonly impersonationContext: unknown;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly entityVersion: number | null;
  readonly before: unknown;
  readonly after: unknown;
  readonly reason: string | null;
  readonly requestId: string | null;
  readonly correlationId: string | null;
  /** `timestamptz`, ISO. */
  readonly occurredAt: string;
}

/** Audit-review filters; organization is required and never optional (`DEC-061`). */
export interface AuditEventListQuery {
  readonly organizationId: string;
  readonly entityType?: string;
  readonly entityId?: string;
  readonly action?: string;
  readonly actorId?: string;
  /** Inclusive lower bound on `occurred_at`; an ISO instant (the port convention). */
  readonly from?: string;
  /** Inclusive upper bound on `occurred_at`; an ISO instant. */
  readonly to?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface AuthResetTokenRecord {
  readonly id: string;
  readonly userId: string;
  readonly expiresAt: Date;
}

/** One live `user_invite` row as the accept flow needs it (`DEC-146`). */
export interface AuthInviteRecord {
  readonly id: string;
  readonly userId: string;
  readonly organizationId: string;
  readonly expiresAt: Date;
}

export interface CreateInviteInput {
  readonly organizationId: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly issuedBy: string | null;
}

/** The narrow employee link the invite command reads and writes (`WF-003`). */
export interface EmployeeLink {
  readonly userId: string | null;
}

export interface LinkEmployeeInput {
  readonly organizationId: string;
  readonly employeeId: string;
  readonly userId: string;
  readonly actorId: string | null;
}

/**
 * A user row the invite command creates for a manager-provisioned account
 * (`DEC-146`). `status` is `invited` and the stored password hash is a
 * non-verifying placeholder until `acceptInvite` sets a real one.
 */
export interface CreateAuthUserInput {
  readonly organizationId: string;
  readonly username: string | null;
  readonly email: string | null;
  readonly displayName: string;
  readonly passwordHash: string;
  readonly status: UserStatus;
  readonly invitedAt?: Date | null;
  readonly invitedBy?: string | null;
}

export interface CreateResetTokenInput {
  readonly userId: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly createdBy: string | null;
}

export interface AuthRoleAssignment {
  readonly roleId: string;
  readonly code: string;
  readonly locationId: string | null;
}

export interface RoleAssignmentInput {
  readonly userId: string;
  readonly roleId: string;
  readonly locationId: string | null;
  readonly grantedBy: string | null;
}

export interface RoleRemovalInput {
  readonly userId: string;
  readonly roleId: string;
  readonly locationId: string | null;
}

export interface CreateSessionInput {
  readonly userId: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly userAgent?: string;
  readonly ip?: string;
}

export interface RequestContext {
  readonly userAgent?: string;
  readonly ip?: string;
  readonly requestId?: string;
}

/** Persistence port the auth commands orchestrate. */
export interface AuthStore {
  /**
   * Runs `fn` against a store bound to a single transaction, so the state change
   * and its audit row commit together. The PostgreSQL adapter wraps
   * `db.transaction`; a store without transactions (the test fake) runs `fn`
   * inline. Commands use this so a partially applied security change can never be
   * audited as if it succeeded.
   */
  withTransaction<T>(fn: (store: AuthStore) => Promise<T>): Promise<T>;
  findUserById(userId: string): Promise<AuthUser | undefined>;
  findUserByIdentifier(organizationId: string, identifier: string): Promise<AuthUser | undefined>;
  /** Creates one `app_user` row and returns it (`DEC-146` invite provisioning). */
  createUser(input: CreateAuthUserInput): Promise<AuthUser>;
  recordLoginSuccess(userId: string, at: Date): Promise<void>;
  recordLoginFailure(userId: string, input: { lockedUntil: Date | null; at: Date }): Promise<void>;
  updatePasswordHash(userId: string, passwordHash: string, at: Date): Promise<void>;
  getTotp(userId: string): Promise<AuthTotpRecord | undefined>;
  /**
   * Stores a freshly sealed secret as an unconfirmed enrolment, clearing any
   * stale confirmation, replay counter and recovery-code set from a prior
   * attempt.
   */
  setTotpSecret(userId: string, secretEncrypted: string): Promise<void>;
  /** Marks an existing unconfirmed enrolment as confirmed. */
  confirmTotp(userId: string, at: Date): Promise<void>;
  /** Deletes the enrolment: secret, confirmation, replay counter and recovery codes. */
  clearTotp(userId: string): Promise<void>;
  /** Toggles `app_user.totp_enabled`; the caller commits it with the state change. */
  setTotpEnabled(userId: string, enabled: boolean): Promise<void>;
  /**
   * Atomically advances the TOTP replay counter. Returns `false` when it did not
   * advance (the code was already consumed by a concurrent request), which the
   * caller treats as a replay.
   */
  advanceLastUsedCounter(userId: string, counter: number): Promise<boolean>;
  /** Atomically consumes a recovery-code hash; `false` when already used. */
  consumeRecoveryCodeHash(userId: string, codeHash: string): Promise<boolean>;
  /** Replaces the whole recovery-code set (enrolment / regeneration). */
  setRecoveryCodes(userId: string, hashes: readonly string[]): Promise<void>;
  createSession(input: CreateSessionInput): Promise<{ id: string }>;
  findActiveSessionByTokenHash(
    tokenHash: string,
    now: Date,
  ): Promise<AuthSessionRecord | undefined>;
  revokeSession(sessionId: string, at: Date): Promise<void>;
  revokeAllSessionsForUser(userId: string, at: Date): Promise<number>;
  createResetToken(input: CreateResetTokenInput): Promise<{ id: string }>;
  findActiveResetTokenByHash(
    tokenHash: string,
    now: Date,
  ): Promise<AuthResetTokenRecord | undefined>;
  /** Atomic single-use claim; `false` when the token was already used or expired. */
  consumeResetToken(tokenId: string, at: Date): Promise<boolean>;
  /** One live invite by token hash (`DEC-146`), or `undefined`. */
  findActiveInviteByHash(tokenHash: string, now: Date): Promise<AuthInviteRecord | undefined>;
  /** Atomic single-use claim; `false` when the invite was accepted, revoked or expired. */
  consumeInvite(inviteId: string, at: Date): Promise<boolean>;
  /** Revokes every live invite for a user; returns how many were revoked. */
  revokeLiveInvitesForUser(userId: string, at: Date): Promise<number>;
  /** Mints one invite token (hash only) and returns its id. */
  createInvite(input: CreateInviteInput): Promise<{ id: string }>;
  /** The narrow `employee.user_id` link, organization-scoped (`DEC-061`). */
  findEmployeeLink(query: {
    readonly organizationId: string;
    readonly employeeId: string;
  }): Promise<EmployeeLink | undefined>;
  /**
   * Links an employee to a login after creation. `false` when the employee is
   * missing, in another organization, or already linked to a different user.
   */
  linkEmployeeToUser(input: LinkEmployeeInput): Promise<boolean>;
  listUserRoles(userId: string): Promise<readonly AuthRoleAssignment[]>;
  listUserLocationScopes(userId: string): Promise<readonly string[]>;
  /**
   * One page of the organization's users with their roles and location scopes,
   * ordered by display name (then id). Organization is always supplied
   * (`DEC-061`); the record never carries `password_hash`, TOTP secrets or
   * recovery codes.
   */
  listUsers(query: AuthUserListQuery): Promise<readonly AuthUserSummary[]>;
  /** Every role defined for the organization (the assignable catalogue), ordered by code. */
  listRoles(organizationId: string): Promise<readonly AuthRoleRecord[]>;
  assignRole(input: RoleAssignmentInput): Promise<void>;
  removeRole(input: RoleRemovalInput): Promise<void>;
  replaceLocationScopes(userId: string, locationIds: readonly string[]): Promise<void>;
  setUserStatus(userId: string, status: UserStatus): Promise<void>;
  writeAudit(input: AuditInput): Promise<void>;
  /**
   * Audit facts for one organization, newest first (§7.3). The read is
   * organization-scoped (`DEC-061`) and paginated by the caller.
   */
  listAuditEvents(query: AuditEventListQuery): Promise<readonly AuditEventRecord[]>;
}

export interface AuthDeps {
  /** Fixed clock for deterministic tests; defaults to the wall clock. */
  readonly now?: Date;
  readonly sessionTtlMinutes: number;
  readonly passwordResetTtlMinutes: number;
  /** Employee-invite token lifetime (`INVITE_TTL_MINUTES`, default 7 days). */
  readonly inviteTtlMinutes: number;
  /**
   * Argon2id cost override for password writes, so tests (and a future policy
   * tuning pass per ADR-0003's open item) can run cheaply. Absent = policy cost.
   */
  readonly passwordHashOptions?: Argon2CostOptions;
  /**
   * Out-of-band delivery of a password-reset token. `beginPasswordReset` never
   * returns the plaintext token; it hands it to this port only for an active
   * account. The recipient `email` is nullable (some accounts log in by username
   * only). Absent = the token is dropped (no delivery channel configured).
   */
  readonly deliverResetToken?: (delivery: {
    readonly organizationId: string;
    readonly userId: string;
    readonly email: string | null;
    readonly token: string;
  }) => Promise<void>;
  /** Required by MFA operations; absent everywhere else. */
  readonly totpEncryptionKey?: Uint8Array;
}

export interface IssuedSession {
  readonly token: string;
  readonly sessionId: string;
  readonly expiresAt: Date;
}
