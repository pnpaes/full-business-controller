import * as repo from "@aquarela/persistence";
import type { Database, NodeDatabase } from "@aquarela/persistence";

import type {
  HmsStore,
  MonitoringPointListQuery,
  MonitoringPointRecord,
  MonitoringReadingListQuery,
  MonitoringReadingRecord,
  NewMonitoringPointRecord,
  NewMonitoringReadingRecord,
} from "./types";

/** A transaction handle has no `transaction` method of its own. */
function isNodeDatabase(db: Database): db is NodeDatabase {
  return typeof (db as NodeDatabase).transaction === "function";
}

function toMonitoringPoint(row: repo.MonitoringPoint): MonitoringPointRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    locationId: row.locationId,
    storageAreaId: row.storageAreaId,
    code: row.code,
    name: row.name,
    kind: row.kind,
    unit: row.unit,
    targetMin: row.targetMin,
    targetMax: row.targetMax,
    checkFrequency: row.checkFrequency,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
  };
}

function toMonitoringReading(row: repo.MonitoringReading): MonitoringReadingRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    monitoringPointId: row.monitoringPointId,
    value: row.value,
    unit: row.unit,
    measuredAt: row.measuredAt.toISOString(),
    recordedBy: row.recordedBy,
    inRange: row.inRange,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}

function newPointValues(input: NewMonitoringPointRecord): repo.NewMonitoringPoint {
  return {
    organizationId: input.organizationId,
    locationId: input.locationId,
    storageAreaId: input.storageAreaId,
    code: input.code,
    name: input.name,
    kind: input.kind,
    unit: input.unit,
    targetMin: input.targetMin,
    targetMax: input.targetMax,
    checkFrequency: input.checkFrequency,
    createdBy: input.createdBy,
  };
}

function newReadingValues(input: NewMonitoringReadingRecord): repo.NewMonitoringReading {
  return {
    organizationId: input.organizationId,
    monitoringPointId: input.monitoringPointId,
    value: input.value,
    unit: input.unit,
    measuredAt: new Date(input.measuredAt),
    recordedBy: input.recordedBy,
    inRange: input.inRange,
    notes: input.notes,
  };
}

/**
 * Adapts the persistence monitoring repository to the `HmsStore` port: the
 * `timestamptz` columns become ISO strings on read and `Date`s on write, and
 * every read/write passes the organization through so the adapter cannot escape
 * the `DEC-061` row scope.
 */
export function createPostgresHmsStore(db: Database): HmsStore {
  return {
    withTransaction: async (fn) => {
      if (!isNodeDatabase(db)) {
        return fn(createPostgresHmsStore(db));
      }
      return db.transaction((tx) => fn(createPostgresHmsStore(tx)));
    },
    writeAudit: async (input) => {
      await repo.writeAuditEvent(db, input);
    },
    createMonitoringPoint: async (input) =>
      toMonitoringPoint(await repo.createMonitoringPoint(db, newPointValues(input))),
    findMonitoringPoint: async (query) => {
      const row = await repo.findMonitoringPoint(db, {
        organizationId: query.organizationId,
        monitoringPointId: query.monitoringPointId,
      });
      return row === undefined ? undefined : toMonitoringPoint(row);
    },
    updateMonitoringPoint: async (input) => {
      const row = await repo.updateMonitoringPoint(db, {
        organizationId: input.organizationId,
        monitoringPointId: input.monitoringPointId,
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.kind === undefined ? {} : { kind: input.kind }),
        ...(input.unit === undefined ? {} : { unit: input.unit }),
        ...(input.targetMin === undefined ? {} : { targetMin: input.targetMin }),
        ...(input.targetMax === undefined ? {} : { targetMax: input.targetMax }),
        ...(input.checkFrequency === undefined ? {} : { checkFrequency: input.checkFrequency }),
        ...(input.locationId === undefined ? {} : { locationId: input.locationId }),
        ...(input.storageAreaId === undefined ? {} : { storageAreaId: input.storageAreaId }),
        ...(input.active === undefined ? {} : { active: input.active }),
      });
      return row === undefined ? undefined : toMonitoringPoint(row);
    },
    listMonitoringPoints: async (query: MonitoringPointListQuery) => {
      const rows = await repo.listMonitoringPoints(db, {
        organizationId: query.organizationId,
        ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
        ...(query.activeOnly === undefined ? {} : { activeOnly: query.activeOnly }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.offset === undefined ? {} : { offset: query.offset }),
      });
      return rows.map(toMonitoringPoint);
    },
    recordMonitoringReading: async (input) =>
      toMonitoringReading(await repo.recordMonitoringReading(db, newReadingValues(input))),
    listMonitoringReadings: async (query: MonitoringReadingListQuery) => {
      const rows = await repo.listMonitoringReadings(db, {
        organizationId: query.organizationId,
        ...(query.monitoringPointId === undefined
          ? {}
          : { monitoringPointId: query.monitoringPointId }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.offset === undefined ? {} : { offset: query.offset }),
      });
      return rows.map(toMonitoringReading);
    },
  };
}
