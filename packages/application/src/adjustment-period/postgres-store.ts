import * as repo from "@aquarela/persistence";
import type { Database, NodeDatabase } from "@aquarela/persistence";

import type {
  AdjustmentPeriodListQuery,
  AdjustmentPeriodRecord,
  AdjustmentPeriodStore,
  NewAdjustmentPeriodRecord,
  UpdateAdjustmentPeriodRecord,
} from "./types";

/**
 * `Database` is either the top-level handle or a transaction handle. Drizzle's
 * `PgTransaction` **also** exposes `transaction` (a nested call opens a
 * savepoint), so this presence check cannot actually tell the two apart — it only
 * catches a stub with no `transaction` method at all, which `withTransaction`
 * then runs inline.
 */
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

function toAdjustmentPeriod(row: repo.AdjustmentPeriod): AdjustmentPeriodRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    openedFrom: row.openedFrom,
    openedTo: row.openedTo,
    reason: row.reason,
    approvedBy: row.approvedBy,
    approvedAt: toIso(row.approvedAt),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: toIso(row.updatedAt),
  };
}

/**
 * Adapts the persistence adjustment-period repository to the
 * `AdjustmentPeriodStore` port: the `timestamptz` columns become ISO strings on
 * read and `Date`s on write, and every read/write passes the organization
 * through so the adapter cannot escape the `DEC-061` row scope. The `date`
 * columns are already `YYYY-MM-DD` strings.
 */
export function createPostgresAdjustmentPeriodStore(db: Database): AdjustmentPeriodStore {
  return {
    withTransaction: async (fn) => {
      if (!isNodeDatabase(db)) {
        return fn(createPostgresAdjustmentPeriodStore(db));
      }
      return db.transaction((tx) => fn(createPostgresAdjustmentPeriodStore(tx)));
    },
    writeAudit: async (input) => {
      await repo.writeAuditEvent(db, input);
    },
    createAdjustmentPeriod: async (input: NewAdjustmentPeriodRecord) =>
      toAdjustmentPeriod(
        await repo.createAdjustmentPeriod(db, {
          organizationId: input.organizationId,
          openedFrom: input.openedFrom,
          openedTo: input.openedTo,
          reason: input.reason,
          status: input.status,
          approvedBy: input.approvedBy,
          approvedAt: toDate(input.approvedAt),
          createdBy: input.createdBy,
        }),
      ),
    findAdjustmentPeriod: async (query) => {
      const row = await repo.findAdjustmentPeriod(db, {
        organizationId: query.organizationId,
        adjustmentPeriodId: query.id,
      });
      return row === undefined ? undefined : toAdjustmentPeriod(row);
    },
    lockAdjustmentPeriodById: async (query) => {
      const row = await repo.lockAdjustmentPeriodById(db, {
        organizationId: query.organizationId,
        adjustmentPeriodId: query.id,
      });
      return row === undefined ? undefined : toAdjustmentPeriod(row);
    },
    findOpenAdjustmentPeriod: async (query) => {
      const row = await repo.findOpenAdjustmentPeriod(db, {
        organizationId: query.organizationId,
      });
      return row === undefined ? undefined : toAdjustmentPeriod(row);
    },
    listAdjustmentPeriods: async (query: AdjustmentPeriodListQuery) => {
      const rows = await repo.listAdjustmentPeriods(db, {
        organizationId: query.organizationId,
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.from === undefined ? {} : { from: query.from }),
        ...(query.to === undefined ? {} : { to: query.to }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.offset === undefined ? {} : { offset: query.offset }),
      });
      return rows.map(toAdjustmentPeriod);
    },
    updateAdjustmentPeriod: async (input: UpdateAdjustmentPeriodRecord) => {
      const row = await repo.updateAdjustmentPeriod(db, {
        organizationId: input.organizationId,
        adjustmentPeriodId: input.adjustmentPeriodId,
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.approvedBy === undefined ? {} : { approvedBy: input.approvedBy }),
        ...(input.approvedAt === undefined ? {} : { approvedAt: toDate(input.approvedAt) }),
        ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
      });
      return row === undefined ? undefined : toAdjustmentPeriod(row);
    },
  };
}
