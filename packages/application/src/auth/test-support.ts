import { randomBytes, randomUUID } from "node:crypto";

import { generateTotpSecret, hashPassword, hashRecoveryCodes, sealSecret } from "@aquarela/domain";
import type { UserStatus } from "@aquarela/persistence";

import type {
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
  readonly failures: Array<{ userId: string; lockedUntil: Date | null }> = [];
  readonly successes: string[] = [];
  readonly passwordUpdates: string[] = [];
  readonly resetTokens = new Map<
    string,
    { id: string; userId: string; tokenHash: string; expiresAt: Date; usedAt: Date | null }
  >();
  readonly roleAssignments = new Map<string, AuthRoleAssignment[]>();
  readonly roleCodes = new Map<string, string>();
  readonly locationScopes = new Map<string, Set<string>>();

  addUser(overrides: Partial<AuthUser> = {}): AuthUser {
    const id = overrides.id ?? randomUUID();
    const user: AuthUser = {
      id,
      organizationId: ORG,
      username: `user_${id.slice(0, 8)}`,
      email: `user_${id.slice(0, 8)}@example.test`,
      status: "active",
      passwordHash: "unset",
      failedLoginCount: 0,
      lockedUntil: null,
      totpEnabled: false,
      ...overrides,
    };
    this.users.set(id, user);
    return user;
  }

  addRole(roleId: string, code: string): void {
    this.roleCodes.set(roleId, code);
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

  async listUserRoles(userId: string): Promise<readonly AuthRoleAssignment[]> {
    return this.roleAssignments.get(userId) ?? [];
  }

  async listUserLocationScopes(userId: string): Promise<readonly string[]> {
    return [...(this.locationScopes.get(userId) ?? [])];
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
