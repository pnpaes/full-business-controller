import * as repo from "@aquarela/persistence";
import type { Database, NodeDatabase } from "@aquarela/persistence";

import type { AuthStore, CreateSessionInput } from "./types";

/** A transaction handle has no `transaction` method of its own. */
function isNodeDatabase(db: Database): db is NodeDatabase {
  return typeof (db as NodeDatabase).transaction === "function";
}

/**
 * Adapts the persistence repositories to the `AuthStore` port. `withTransaction`
 * opens a real transaction on the pooled database and binds a new store to it;
 * when the store is already bound to a transaction it runs inline.
 */
export function createPostgresAuthStore(db: Database): AuthStore {
  return {
    withTransaction: async (fn) => {
      if (!isNodeDatabase(db)) {
        return fn(createPostgresAuthStore(db));
      }
      return db.transaction((tx) => fn(createPostgresAuthStore(tx)));
    },
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
    advanceLastUsedCounter: async (userId, counter) =>
      (await repo.advanceLastUsedCounter(db, userId, counter)) !== undefined,
    consumeRecoveryCodeHash: async (userId, codeHash) =>
      (await repo.consumeRecoveryCodeHash(db, userId, codeHash)) !== undefined,
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
