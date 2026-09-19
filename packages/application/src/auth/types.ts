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
  readonly status: string;
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
  findUserById(userId: string): Promise<AuthUser | undefined>;
  findUserByIdentifier(organizationId: string, identifier: string): Promise<AuthUser | undefined>;
  recordLoginSuccess(userId: string, at: Date): Promise<void>;
  recordLoginFailure(userId: string, input: { lockedUntil: Date | null; at: Date }): Promise<void>;
  updatePasswordHash(userId: string, passwordHash: string, at: Date): Promise<void>;
  getTotp(userId: string): Promise<AuthTotpRecord | undefined>;
  setLastUsedCounter(userId: string, counter: number): Promise<void>;
  setRecoveryCodes(userId: string, hashes: readonly string[]): Promise<void>;
  createSession(input: CreateSessionInput): Promise<{ id: string }>;
  findActiveSessionByTokenHash(
    tokenHash: string,
    now: Date,
  ): Promise<AuthSessionRecord | undefined>;
  revokeSession(sessionId: string, at: Date): Promise<void>;
  revokeAllSessionsForUser(userId: string, at: Date): Promise<number>;
  writeAudit(input: AuditInput): Promise<void>;
}

export interface AuthDeps {
  /** Fixed clock for deterministic tests; defaults to the wall clock. */
  readonly now?: Date;
  readonly sessionTtlMinutes: number;
  /** Required by MFA operations; absent everywhere else. */
  readonly totpEncryptionKey?: Uint8Array;
}

export interface IssuedSession {
  readonly token: string;
  readonly sessionId: string;
  readonly expiresAt: Date;
}
