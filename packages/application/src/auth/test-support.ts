import { randomBytes, randomUUID } from "node:crypto";

import { generateTotpSecret, hashPassword, hashRecoveryCodes, sealSecret } from "@aquarela/domain";
import type { UserStatus } from "@aquarela/persistence";

import type {
  AuditEventListQuery,
  AuditEventRecord,
  AuditInput,
  AuthDeps,
  AuthInviteRecord,
  AuthResetTokenRecord,
  AuthRoleAssignment,
  AuthRoleRecord,
  AuthSessionRecord,
  AuthStore,
  AuthTotpRecord,
  AuthUser,
  AuthUserListQuery,
  AuthUserSummary,
  CreateAuthUserInput,
  CreateInviteInput,
  CreateResetTokenInput,
  CreateSessionInput,
  LinkEmployeeInput,
  RoleAssignmentInput,
  RoleRemovalInput,
} from "./types";

/** Cheap Argon2 params keep the unit suite fast; the hash carries its own params. */
export const CHEAP = { memoryCost: 8, timeCost: 1, parallelism: 1 };
export const KEY = randomBytes(32);
export const ORG = "org-1";
export const NOW = new Date("2026-09-19T12:00:00.000Z");
export const counterAt = (at: Date): number => Math.floor(at.getTime() / 1000 / 30);

export function authDeps(overrides: Partial<AuthDeps> = {}): AuthDeps {
  return {
    now: NOW,
    sessionTtlMinutes: 60,
    passwordResetTtlMinutes: 30,
    inviteTtlMinutes: 7 * 24 * 60,
    passwordHashOptions: CHEAP,
    ...overrides,
  };
}

/**
 * In-memory `AuthStore` for the unit suite. It mirrors the persistence adapter's
 * observable contract (single-use reset tokens, idempotent role grants, exact
 * scope replacement) closely enough to test the command flows without a
 * database; `auth.postgres.test.ts` covers the real adapter.
 */
export class FakeAuthStore implements AuthStore {
  readonly users = new Map<string, AuthUser>();
  readonly totps = new Map<string, AuthTotpRecord>();
  readonly sessions = new Map<
    string,
    { id: string; userId: string; tokenHash: string; expiresAt: Date; revokedAt: Date | null }
  >();
  readonly audits: AuditInput[] = [];
  readonly auditEvents: AuditEventRecord[] = [];
  readonly failures: Array<{ userId: string; lockedUntil: Date | null }> = [];
  readonly successes: string[] = [];
  readonly passwordUpdates: string[] = [];
  readonly resetTokens = new Map<
    string,
    { id: string; userId: string; tokenHash: string; expiresAt: Date; usedAt: Date | null }
  >();
  /** Live/settled `user_invite` rows (`DEC-146`). */
  readonly invites = new Map<
    string,
    {
      id: string;
      organizationId: string;
      userId: string;
      tokenHash: string;
      issuedBy: string | null;
      expiresAt: Date;
      acceptedAt: Date | null;
      revokedAt: Date | null;
    }
  >();
  /** The narrow `employee` link the invite command reads/writes. */
  readonly employees = new Map<string, { organizationId: string; userId: string | null }>();
  readonly roleAssignments = new Map<string, AuthRoleAssignment[]>();
  readonly roleCodes = new Map<string, string>();
  readonly roleRecords = new Map<string, AuthRoleRecord & { organizationId: string }>();
  readonly locationScopes = new Map<string, Set<string>>();

  addUser(overrides: Partial<AuthUser> = {}): AuthUser {
    const id = overrides.id ?? randomUUID();
    const user: AuthUser = {
      id,
      organizationId: ORG,
      username: `user_${id.slice(0, 8)}`,
      email: `user_${id.slice(0, 8)}@example.test`,
      displayName: `User ${id.slice(0, 8)}`,
      status: "active",
      passwordHash: "unset",
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: null,
      totpEnabled: false,
      ...overrides,
    };
    this.users.set(id, user);
    return user;
  }

  addEmployee(overrides: { id: string; organizationId?: string; userId?: string | null }): void {
    this.employees.set(overrides.id, {
      organizationId: overrides.organizationId ?? ORG,
      userId: overrides.userId ?? null,
    });
  }

  addRole(roleId: string, code: string, name = code, organizationId = ORG): void {
    this.roleCodes.set(roleId, code);
    this.roleRecords.set(roleId, { id: roleId, organizationId, code, name, description: null });
  }

  /** Seeds one audit fact for the read-service tests, bypassing `writeAudit`. */
  addAuditEvent(record: AuditEventRecord): void {
    this.auditEvents.push(record);
  }

  actions(): string[] {
    return this.audits.map((entry) => entry.action);
  }

  async findUserById(userId: string): Promise<AuthUser | undefined> {
    return this.users.get(userId);
  }

  async findUserByIdentifier(
    organizationId: string,
    identifier: string,
  ): Promise<AuthUser | undefined> {
    const normalized = identifier.trim().toLowerCase();
    return [...this.users.values()].find(
      (user) =>
        user.organizationId === organizationId &&
        [user.username, user.email].some(
          (value) => value !== null && value.toLowerCase() === normalized,
        ),
    );
  }

  async createUser(input: CreateAuthUserInput): Promise<AuthUser> {
    return this.addUser({
      organizationId: input.organizationId,
      username: input.username,
      email: input.email,
      displayName: input.displayName,
      status: input.status,
      passwordHash: input.passwordHash,
    });
  }

  async findEmployeeLink(query: {
    readonly organizationId: string;
    readonly employeeId: string;
  }): Promise<{ userId: string | null } | undefined> {
    const employee = this.employees.get(query.employeeId);
    if (employee === undefined || employee.organizationId !== query.organizationId) {
      return undefined;
    }
    return { userId: employee.userId };
  }

  async linkEmployeeToUser(input: LinkEmployeeInput): Promise<boolean> {
    const employee = this.employees.get(input.employeeId);
    if (
      employee === undefined ||
      employee.organizationId !== input.organizationId ||
      (employee.userId !== null && employee.userId !== input.userId)
    ) {
      return false;
    }
    employee.userId = input.userId;
    return true;
  }

  async recordLoginSuccess(userId: string): Promise<void> {
    this.successes.push(userId);
    const user = this.users.get(userId);
    if (user !== undefined) {
      this.users.set(userId, { ...user, failedLoginCount: 0, lockedUntil: null });
    }
  }

  async recordLoginFailure(
    userId: string,
    input: { lockedUntil: Date | null; at: Date },
  ): Promise<void> {
    this.failures.push({ userId, lockedUntil: input.lockedUntil });
    const user = this.users.get(userId);
    if (user !== undefined) {
      this.users.set(userId, {
        ...user,
        failedLoginCount: user.failedLoginCount + 1,
        lockedUntil: input.lockedUntil,
      });
    }
  }

  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    this.passwordUpdates.push(userId);
    const user = this.users.get(userId);
    if (user !== undefined) {
      this.users.set(userId, { ...user, passwordHash });
    }
  }

  async getTotp(userId: string): Promise<AuthTotpRecord | undefined> {
    return this.totps.get(userId);
  }

  async setTotpSecret(userId: string, secretEncrypted: string): Promise<void> {
    this.totps.set(userId, {
      secretEncrypted,
      confirmedAt: null,
      recoveryCodesHash: [],
      lastUsedCounter: null,
    });
  }

  async confirmTotp(userId: string, at: Date): Promise<void> {
    const totp = this.totps.get(userId);
    if (totp !== undefined) {
      this.totps.set(userId, { ...totp, confirmedAt: at });
    }
  }

  async clearTotp(userId: string): Promise<void> {
    this.totps.delete(userId);
  }

  async setTotpEnabled(userId: string, enabled: boolean): Promise<void> {
    const user = this.users.get(userId);
    if (user !== undefined) {
      this.users.set(userId, { ...user, totpEnabled: enabled });
    }
  }

  async withTransaction<T>(fn: (store: AuthStore) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async advanceLastUsedCounter(userId: string, counter: number): Promise<boolean> {
    const totp = this.totps.get(userId);
    if (totp === undefined || counter <= (totp.lastUsedCounter ?? -1)) {
      return false;
    }
    this.totps.set(userId, { ...totp, lastUsedCounter: counter });
    return true;
  }

  async consumeRecoveryCodeHash(userId: string, codeHash: string): Promise<boolean> {
    const totp = this.totps.get(userId);
    if (totp === undefined || !totp.recoveryCodesHash.includes(codeHash)) {
      return false;
    }
    this.totps.set(userId, {
      ...totp,
      recoveryCodesHash: totp.recoveryCodesHash.filter((hash) => hash !== codeHash),
    });
    return true;
  }

  async setRecoveryCodes(userId: string, hashes: readonly string[]): Promise<void> {
    const totp = this.totps.get(userId);
    if (totp === undefined) {
      throw new Error("user has no TOTP enrolment");
    }
    this.totps.set(userId, { ...totp, recoveryCodesHash: [...hashes] });
  }

  async createSession(input: CreateSessionInput): Promise<{ id: string }> {
    const id = randomUUID();
    this.sessions.set(id, {
      id,
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      revokedAt: null,
    });
    return { id };
  }

  async findActiveSessionByTokenHash(
    tokenHash: string,
    now: Date,
  ): Promise<AuthSessionRecord | undefined> {
    const found = [...this.sessions.values()].find(
      (session) =>
        session.tokenHash === tokenHash &&
        session.revokedAt === null &&
        session.expiresAt.getTime() > now.getTime(),
    );
    if (found === undefined) {
      return undefined;
    }
    const user = this.users.get(found.userId);
    if (user === undefined || user.status !== "active") {
      return undefined;
    }
    return { id: found.id, userId: found.userId, expiresAt: found.expiresAt };
  }

  async revokeSession(sessionId: string, at: Date): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session !== undefined) {
      session.revokedAt = at;
    }
  }

  async revokeAllSessionsForUser(userId: string, at: Date): Promise<number> {
    let revoked = 0;
    for (const session of this.sessions.values()) {
      if (session.userId === userId && session.revokedAt === null) {
        session.revokedAt = at;
        revoked += 1;
      }
    }
    return revoked;
  }

  async createResetToken(input: CreateResetTokenInput): Promise<{ id: string }> {
    const id = randomUUID();
    this.resetTokens.set(id, {
      id,
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      usedAt: null,
    });
    return { id };
  }

  async findActiveResetTokenByHash(
    tokenHash: string,
    now: Date,
  ): Promise<AuthResetTokenRecord | undefined> {
    const found = [...this.resetTokens.values()].find(
      (token) =>
        token.tokenHash === tokenHash &&
        token.usedAt === null &&
        token.expiresAt.getTime() > now.getTime(),
    );
    if (found === undefined) {
      return undefined;
    }
    return { id: found.id, userId: found.userId, expiresAt: found.expiresAt };
  }

  async consumeResetToken(tokenId: string, at: Date): Promise<boolean> {
    const token = this.resetTokens.get(tokenId);
    if (token === undefined || token.usedAt !== null || token.expiresAt.getTime() <= at.getTime()) {
      return false;
    }
    token.usedAt = at;
    return true;
  }

  async createInvite(input: CreateInviteInput): Promise<{ id: string }> {
    const id = randomUUID();
    this.invites.set(id, {
      id,
      organizationId: input.organizationId,
      userId: input.userId,
      tokenHash: input.tokenHash,
      issuedBy: input.issuedBy,
      expiresAt: input.expiresAt,
      acceptedAt: null,
      revokedAt: null,
    });
    return { id };
  }

  async findActiveInviteByHash(
    tokenHash: string,
    now: Date,
  ): Promise<AuthInviteRecord | undefined> {
    const found = [...this.invites.values()].find(
      (invite) =>
        invite.tokenHash === tokenHash &&
        invite.acceptedAt === null &&
        invite.revokedAt === null &&
        invite.expiresAt.getTime() > now.getTime(),
    );
    if (found === undefined) {
      return undefined;
    }
    return {
      id: found.id,
      userId: found.userId,
      organizationId: found.organizationId,
      expiresAt: found.expiresAt,
    };
  }

  async consumeInvite(inviteId: string, at: Date): Promise<boolean> {
    const invite = this.invites.get(inviteId);
    if (
      invite === undefined ||
      invite.acceptedAt !== null ||
      invite.revokedAt !== null ||
      invite.expiresAt.getTime() <= at.getTime()
    ) {
      return false;
    }
    invite.acceptedAt = at;
    return true;
  }

  async revokeLiveInvitesForUser(userId: string, at: Date): Promise<number> {
    let revoked = 0;
    for (const invite of this.invites.values()) {
      if (invite.userId === userId && invite.acceptedAt === null && invite.revokedAt === null) {
        invite.revokedAt = at;
        revoked += 1;
      }
    }
    return revoked;
  }

  async listUserRoles(userId: string): Promise<readonly AuthRoleAssignment[]> {
    return this.roleAssignments.get(userId) ?? [];
  }

  async listUserLocationScopes(userId: string): Promise<readonly string[]> {
    return [...(this.locationScopes.get(userId) ?? [])];
  }

  async listUsers(query: AuthUserListQuery): Promise<readonly AuthUserSummary[]> {
    return [...this.users.values()]
      .filter((user) => user.organizationId === query.organizationId)
      .sort((a, b) => a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id))
      .slice(query.offset, query.offset + query.limit)
      .map((user) => ({
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.displayName,
        status: user.status,
        totpEnabled: user.totpEnabled,
        lastLoginAt: user.lastLoginAt,
        roles: this.roleAssignments.get(user.id) ?? [],
        locationIds: [...(this.locationScopes.get(user.id) ?? [])],
      }));
  }

  async listRoles(organizationId: string): Promise<readonly AuthRoleRecord[]> {
    return [...this.roleRecords.values()]
      .filter((record) => record.organizationId === organizationId)
      .sort((a, b) => a.code.localeCompare(b.code) || a.id.localeCompare(b.id))
      .map(({ id, code, name, description }) => ({ id, code, name, description }));
  }

  async assignRole(input: RoleAssignmentInput): Promise<void> {
    const list = this.roleAssignments.get(input.userId) ?? [];
    if (list.some((row) => row.roleId === input.roleId && row.locationId === input.locationId)) {
      return;
    }
    this.roleAssignments.set(input.userId, [
      ...list,
      {
        roleId: input.roleId,
        code: this.roleCodes.get(input.roleId) ?? input.roleId,
        locationId: input.locationId,
      },
    ]);
  }

  async removeRole(input: RoleRemovalInput): Promise<void> {
    const list = this.roleAssignments.get(input.userId) ?? [];
    this.roleAssignments.set(
      input.userId,
      list.filter((row) => !(row.roleId === input.roleId && row.locationId === input.locationId)),
    );
  }

  async replaceLocationScopes(userId: string, locationIds: readonly string[]): Promise<void> {
    this.locationScopes.set(userId, new Set(locationIds));
  }

  async setUserStatus(userId: string, status: UserStatus): Promise<void> {
    const user = this.users.get(userId);
    if (user !== undefined) {
      this.users.set(userId, { ...user, status });
    }
  }

  async writeAudit(input: AuditInput): Promise<void> {
    this.audits.push(input);
    this.auditEvents.push({
      id: randomUUID(),
      organizationId: input.organizationId,
      actorId: input.actorId,
      impersonationContext: null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      entityVersion: null,
      before: input.before ?? null,
      after: input.after ?? null,
      reason: input.reason ?? null,
      requestId: input.requestId ?? null,
      correlationId: null,
      occurredAt: new Date().toISOString(),
    });
  }

  async listAuditEvents(query: AuditEventListQuery): Promise<readonly AuditEventRecord[]> {
    const matching = this.auditEvents
      .filter((row) => row.organizationId === query.organizationId)
      .filter((row) => query.entityType === undefined || row.entityType === query.entityType)
      .filter((row) => query.entityId === undefined || row.entityId === query.entityId)
      .filter((row) => query.action === undefined || row.action === query.action)
      .filter((row) => query.actorId === undefined || row.actorId === query.actorId)
      .filter((row) => query.from === undefined || row.occurredAt >= query.from)
      .filter((row) => query.to === undefined || row.occurredAt <= query.to)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id));
    const offset = query.offset ?? 0;
    return query.limit === undefined
      ? matching.slice(offset)
      : matching.slice(offset, offset + query.limit);
  }
}

export async function userWithPassword(
  store: FakeAuthStore,
  password: string,
  overrides: Partial<AuthUser> = {},
): Promise<AuthUser> {
  return store.addUser({ passwordHash: await hashPassword(password, CHEAP), ...overrides });
}

export async function enrolTotp(
  store: FakeAuthStore,
  user: AuthUser,
  recoveryCodes: readonly string[] = [],
): Promise<string> {
  const secret = generateTotpSecret();
  store.totps.set(user.id, {
    secretEncrypted: sealSecret(secret, KEY),
    confirmedAt: NOW,
    recoveryCodesHash: await hashRecoveryCodes(recoveryCodes, CHEAP),
    lastUsedCounter: null,
  });
  store.users.set(user.id, { ...user, totpEnabled: true });
  return secret;
}
