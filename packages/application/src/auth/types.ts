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
  readonly status: UserStatus;
  readonly passwordHash: string;
  readonly failedLoginCount: number;
  readonly lockedUntil: Date | null;
  readonly totpEnabled: boolean;
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

export interface AuthResetTokenRecord {
  readonly id: string;
  readonly userId: string;
  readonly expiresAt: Date;
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
  listUserRoles(userId: string): Promise<readonly AuthRoleAssignment[]>;
  listUserLocationScopes(userId: string): Promise<readonly string[]>;
  assignRole(input: RoleAssignmentInput): Promise<void>;
  removeRole(input: RoleRemovalInput): Promise<void>;
  replaceLocationScopes(userId: string, locationIds: readonly string[]): Promise<void>;
  setUserStatus(userId: string, status: UserStatus): Promise<void>;
  writeAudit(input: AuditInput): Promise<void>;
}

export interface AuthDeps {
  /** Fixed clock for deterministic tests; defaults to the wall clock. */
  readonly now?: Date;
  readonly sessionTtlMinutes: number;
  readonly passwordResetTtlMinutes: number;
  /**
   * Argon2id cost override for password writes, so tests (and a future policy
   * tuning pass per ADR-0003's open item) can run cheaply. Absent = policy cost.
   */
  readonly passwordHashOptions?: Argon2CostOptions;
  /**
   * Out-of-band delivery of a password-reset token. `beginPasswordReset` never
   * returns the plaintext token; it hands it to this port only for an active
   * account. Absent = the token is dropped (no delivery channel configured yet).
   */
  readonly deliverResetToken?: (delivery: {
    readonly organizationId: string;
    readonly userId: string;
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
