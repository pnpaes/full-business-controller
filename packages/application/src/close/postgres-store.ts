import * as repo from "@aquarela/persistence";
import type { Database, NodeDatabase } from "@aquarela/persistence";

import type {
  NewPeriodCloseRecord,
  PeriodCloseListQuery,
  PeriodCloseRecord,
  PeriodCloseStore,
  UpdatePeriodCloseRecord,
} from "./types";

/** A transaction handle has no `transaction` method of its own. */
function isNodeDatabase(db: Database): db is NodeDatabase {
  return typeof (db as NodeDatabase).transaction === "function";
}

/** `timestamptz`, ISO, or `null` — the adapter's read-side convention. */
function toIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

/** The write-side twin of `toIso`: an ISO string or `null` becomes a `Date` or `null`. */
function toDate(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

function toPeriodClose(row: repo.PeriodClose): PeriodCloseRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    status: row.status,
    checklist: row.checklist,
    snapshot: row.snapshot,
    correctionPolicy: row.correctionPolicy,
    lockedBy: row.lockedBy,
    lockedAt: toIso(row.lockedAt),
    reopenedBy: row.reopenedBy,
    reopenedAt: toIso(row.reopenedAt),
    reopenReason: row.reopenReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: toIso(row.updatedAt),
  };
}

/**
 * Adapts the persistence close repository to the `PeriodCloseStore` port: the
 * `timestamptz` columns become ISO strings on read and `Date`s on write, and
 * every read/write passes the organization through so the adapter cannot escape
 * the `DEC-061` row scope. The `date` columns are already `YYYY-MM-DD` strings
 * and the jsonb columns pass through as `unknown`.
 */
export function createPostgresPeriodCloseStore(db: Database): PeriodCloseStore {
  return {
    withTransaction: async (fn) => {
      if (!isNodeDatabase(db)) {
        return fn(createPostgresPeriodCloseStore(db));
      }
      return db.transaction((tx) => fn(createPostgresPeriodCloseStore(tx)));
    },
    writeAudit: async (input) => {
      await repo.writeAuditEvent(db, input);
    },
    createPeriodClose: async (input: NewPeriodCloseRecord) =>
      toPeriodClose(
        await repo.createPeriodClose(db, {
          organizationId: input.organizationId,
          scopeType: input.scopeType,
          scopeId: input.scopeId,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          status: input.status,
          checklist: input.checklist,
          snapshot: input.snapshot,
          createdBy: input.createdBy,
        }),
      ),
    findPeriodClose: async (query) => {
      const row = await repo.findPeriodClose(db, {
        organizationId: query.organizationId,
        periodCloseId: query.id,
      });
      return row === undefined ? undefined : toPeriodClose(row);
    },
    lockPeriodCloseById: async (query) => {
      const row = await repo.lockPeriodCloseById(db, {
        organizationId: query.organizationId,
        periodCloseId: query.id,
      });
      return row === undefined ? undefined : toPeriodClose(row);
    },
    findPeriodCloseForScope: async (query) => {
      const row = await repo.findPeriodCloseForScope(db, {
        organizationId: query.organizationId,
        scopeType: query.scopeType,
        scopeId: query.scopeId,
        periodStart: query.periodStart,
      });
      return row === undefined ? undefined : toPeriodClose(row);
    },
    lockPeriodCloseForScope: async (query) => {
      const row = await repo.lockPeriodCloseForScope(db, {
        organizationId: query.organizationId,
        scopeType: query.scopeType,
        scopeId: query.scopeId,
        periodStart: query.periodStart,
      });
      return row === undefined ? undefined : toPeriodClose(row);
    },
    findLockedPeriodCloseCoveringDate: async (query) => {
      const row = await repo.findLockedPeriodCloseCoveringDate(db, {
        organizationId: query.organizationId,
        scopeType: query.scopeType,
        scopeId: query.scopeId,
        at: query.at,
      });
      return row === undefined ? undefined : toPeriodClose(row);
    },
    listPeriodCloses: async (query: PeriodCloseListQuery) => {
      const rows = await repo.listPeriodCloses(db, {
        organizationId: query.organizationId,
        ...(query.scopeType === undefined ? {} : { scopeType: query.scopeType }),
        ...(query.scopeId === undefined ? {} : { scopeId: query.scopeId }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.from === undefined ? {} : { from: query.from }),
        ...(query.to === undefined ? {} : { to: query.to }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.offset === undefined ? {} : { offset: query.offset }),
      });
      return rows.map(toPeriodClose);
    },
    updatePeriodClose: async (input: UpdatePeriodCloseRecord) => {
      const row = await repo.updatePeriodClose(db, {
        organizationId: input.organizationId,
        periodCloseId: input.periodCloseId,
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.checklist === undefined ? {} : { checklist: input.checklist }),
        ...(input.snapshot === undefined ? {} : { snapshot: input.snapshot }),
        ...(input.correctionPolicy === undefined
          ? {}
          : { correctionPolicy: input.correctionPolicy }),
        ...(input.lockedBy === undefined ? {} : { lockedBy: input.lockedBy }),
        ...(input.lockedAt === undefined ? {} : { lockedAt: toDate(input.lockedAt) }),
        ...(input.reopenedBy === undefined ? {} : { reopenedBy: input.reopenedBy }),
        ...(input.reopenedAt === undefined ? {} : { reopenedAt: toDate(input.reopenedAt) }),
        ...(input.reopenReason === undefined ? {} : { reopenReason: input.reopenReason }),
        ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
      });
      return row === undefined ? undefined : toPeriodClose(row);
    },
  };
}
