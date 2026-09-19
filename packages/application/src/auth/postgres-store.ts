import * as repo from "@aquarela/persistence";
import type { Database } from "@aquarela/persistence";

import type { AuthStore, CreateSessionInput } from "./types";

/**
 * Adapts the persistence repositories to the `AuthStore` port. Pass a
 * transaction handle (`db.transaction((tx) => ...)`) to compose a command
 * atomically; the repositories accept either the pooled database or a `tx`.
 */
export function createPostgresAuthStore(db: Database): AuthStore {
  return {
    findUserById: (userId) => repo.findUserById(db, userId),
    findUserByIdentifier: (organizationId, identifier) =>
      repo.findUserByIdentifier(db, organizationId, identifier),
    recordLoginSuccess: async (userId, at) => {
      await repo.recordLoginSuccess(db, userId, at);
    },
    recordLoginFailure: async (userId, input) => {
      await repo.recordLoginFailure(db, userId, input);
    },
    updatePasswordHash: async (userId, passwordHash, at) => {
      await repo.updatePasswordHash(db, userId, passwordHash, at);
    },
    getTotp: (userId) => repo.getTotp(db, userId),
    setLastUsedCounter: async (userId, counter) => {
      await repo.setLastUsedCounter(db, userId, counter);
    },
    setRecoveryCodes: async (userId, hashes) => {
      await repo.setRecoveryCodes(db, userId, hashes);
    },
    createSession: async (input: CreateSessionInput) => {
      const created = await repo.createSession(db, {
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        ...(input.userAgent !== undefined ? { userAgent: input.userAgent } : {}),
        ...(input.ip !== undefined ? { ip: input.ip } : {}),
      });
      return { id: created.id };
    },
    findActiveSessionByTokenHash: (tokenHash, now) =>
      repo.findActiveSessionByTokenHash(db, tokenHash, now),
    revokeSession: async (sessionId, at) => {
      await repo.revokeSession(db, sessionId, at);
    },
    revokeAllSessionsForUser: (userId, at) => repo.revokeAllSessionsForUser(db, userId, at),
    writeAudit: async (input) => {
      await repo.writeAuditEvent(db, input);
    },
  };
}
