import * as repo from "@aquarela/persistence";
import type { Database, NodeDatabase } from "@aquarela/persistence";

import { createPostgresReportingStore, type ReportingStore } from "../reporting";

import type {
  ForecastOverrideLookup,
  ForecastOverrideRecord,
  ForecastReadStore,
  ForecastSnapshotByIdLookup,
  ForecastSnapshotLookup,
  ForecastSnapshotRecord,
} from "./read-types";
import type { ForecastGrain, ForecastProjectionPoint } from "./types";
import type { ForecastWriteStore } from "./write-types";

/** A transaction handle has no `transaction` method of its own. */
function isNodeDatabase(db: Database): db is NodeDatabase {
  return typeof (db as NodeDatabase).transaction === "function";
}

/** The relational query API is present on the pool database and a transaction alike. */
function relational(db: Database): NodeDatabase {
  return db as NodeDatabase;
}

/** True when an unknown JSONB value is a well-formed projection point. */
function isProjectionPoint(value: unknown): value is ForecastProjectionPoint {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const point = value as Record<string, unknown>;
  return (
    typeof point.period === "string" &&
    typeof point.value === "string" &&
    typeof point.lower === "string" &&
    typeof point.upper === "string"
  );
}

/**
 * The stored projection is written only by `recordForecastSnapshot`, so this
 * validates its shape loudly rather than silently dropping a malformed point
 * (the DB check only guarantees it is a JSONB array).
 */
function parseProjection(value: unknown): ForecastProjectionPoint[] {
  if (!Array.isArray(value)) {
    throw new Error("forecast_snapshot.projection is not a JSONB array");
  }
  return value.map((entry) => {
    if (!isProjectionPoint(entry)) {
      throw new Error("forecast_snapshot.projection contains a malformed point");
    }
    return entry;
  });
}

function toSnapshot(row: repo.ForecastSnapshot): ForecastSnapshotRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    metric: row.metric,
    // The `forecast_snapshot_grain_check` constraint is the authority.
    grain: row.grain as ForecastGrain,
    locationId: row.locationId,
    channelId: row.channelId,
    category: row.category,
    productVariantId: row.productVariantId,
    asOf: row.asOf.toISOString(),
    generatedAt: row.generatedAt.toISOString(),
    model: row.model,
    projection: parseProjection(row.projection),
    accuracyMethod: row.accuracyMethod,
    accuracyMape: row.accuracyMape,
    accuracyPoints: row.accuracyPoints,
  };
}

function toOverride(row: repo.ForecastOverride): ForecastOverrideRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    snapshotId: row.snapshotId,
    metric: row.metric,
    grain: row.grain as ForecastGrain,
    period: row.period,
    locationId: row.locationId,
    channelId: row.channelId,
    category: row.category,
    productVariantId: row.productVariantId,
    actorId: row.actorId,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Adapts the `forecast_snapshot`/`forecast_override` tables (through the
 * persistence repository) to the tracking read and write ports, and composes the
 * `ReportingStore` the tracking read needs for actuals and
 * `recordForecastSnapshot` needs for `computeForecast`. Every read and write
 * passes the organization through, so the adapter cannot escape the `DEC-061`
 * row scope; `forecast_override` is append-only, so the port has no update or
 * delete and a violation surfaces from the `0070` trigger.
 */
export function createPostgresForecastStore(
  db: Database,
): ForecastWriteStore & ForecastReadStore & ReportingStore {
  return {
    ...createPostgresReportingStore(db),
    withTransaction: async (fn) => {
      if (!isNodeDatabase(db)) {
        return fn(createPostgresForecastStore(db));
      }
      return db.transaction((tx) => fn(createPostgresForecastStore(tx)));
    },
    findLatestForecastSnapshot: async (query: ForecastSnapshotLookup) => {
      const row = await repo.findLatestForecastSnapshot(db, query);
      return row === undefined ? undefined : toSnapshot(row);
    },
    findForecastSnapshotById: async (query: ForecastSnapshotByIdLookup) => {
      const row = await relational(db).query.forecastSnapshot.findFirst({
        where: (table, { and, eq }) =>
          and(eq(table.id, query.snapshotId), eq(table.organizationId, query.organizationId)),
      });
      return row === undefined ? undefined : toSnapshot(row);
    },
    listForecastOverrides: async (query: ForecastOverrideLookup) => {
      const rows = await repo.listForecastOverrides(db, query);
      return rows.map(toOverride);
    },
    createForecastSnapshot: async (input) =>
      toSnapshot(
        await repo.createForecastSnapshot(db, {
          organizationId: input.organizationId,
          metric: input.metric,
          grain: input.grain,
          locationId: input.locationId,
          channelId: input.channelId,
          category: input.category,
          productVariantId: input.productVariantId,
          asOf: new Date(input.asOf),
          model: input.model,
          projection: input.projection,
          accuracyMethod: input.accuracyMethod,
          accuracyMape: input.accuracyMape,
          accuracyPoints: input.accuracyPoints,
          actorId: input.actorId,
        }),
      ),
    createForecastOverride: async (input) =>
      toOverride(
        await repo.createForecastOverride(db, {
          organizationId: input.organizationId,
          snapshotId: input.snapshotId,
          metric: input.metric,
          grain: input.grain,
          period: input.period,
          locationId: input.locationId,
          channelId: input.channelId,
          category: input.category,
          productVariantId: input.productVariantId,
          actorId: input.actorId,
          reason: input.reason,
        }),
      ),
    writeAudit: async (input) => {
      await repo.writeAuditEvent(db, input);
    },
  };
}
