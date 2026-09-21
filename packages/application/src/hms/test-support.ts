import type { AuditInput } from "../auth";

import type {
  HmsStore,
  MonitoringPointListQuery,
  MonitoringPointRecord,
  MonitoringReadingListQuery,
  MonitoringReadingRecord,
  NewMonitoringPointRecord,
  NewMonitoringReadingRecord,
  UpdateMonitoringPointRecord,
} from "./types";

/**
 * A shallow copy of every mutable map/array an HMS transaction can touch, used
 * to roll back a failed `withTransaction` (the fake runs inline without one).
 */
interface HmsSnapshot {
  readonly monitoringPoints: Map<string, MonitoringPointRecord>;
  readonly monitoringReadings: Map<string, MonitoringReadingRecord>;
  readonly audits: AuditInput[];
}

/**
 * In-memory `HmsStore` for the unit suite. It mirrors the Postgres adapter's
 * organization scoping, ordering and paging so the commands and queries can be
 * exercised without a database; `hms.postgres.test.ts` covers the real adapter.
 */
export class FakeHmsStore implements HmsStore {
  readonly monitoringPoints = new Map<string, MonitoringPointRecord>();
  readonly monitoringReadings = new Map<string, MonitoringReadingRecord>();
  readonly audits: AuditInput[] = [];

  private sequence = 0;

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }

  async withTransaction<T>(fn: (store: HmsStore) => Promise<T>): Promise<T> {
    // Snapshot then run so a failure mid-transaction rolls back every write
    // (a create and its audit fact commit or roll back together, like the
    // Postgres adapter).
    const snapshot = this.snapshot();
    try {
      return await fn(this);
    } catch (error) {
      this.restore(snapshot);
      throw error;
    }
  }

  private snapshot(): HmsSnapshot {
    return {
      monitoringPoints: new Map(this.monitoringPoints),
      monitoringReadings: new Map(this.monitoringReadings),
      audits: [...this.audits],
    };
  }

  private restore(snapshot: HmsSnapshot): void {
    this.monitoringPoints.clear();
    for (const [key, value] of snapshot.monitoringPoints) this.monitoringPoints.set(key, value);
    this.monitoringReadings.clear();
    for (const [key, value] of snapshot.monitoringReadings) {
      this.monitoringReadings.set(key, value);
    }
    this.audits.length = 0;
    this.audits.push(...snapshot.audits);
  }

  async writeAudit(input: AuditInput): Promise<void> {
    this.audits.push(input);
  }

  async createMonitoringPoint(input: NewMonitoringPointRecord): Promise<MonitoringPointRecord> {
    const record: MonitoringPointRecord = {
      id: this.nextId("point"),
      ...input,
      active: true,
      createdAt: new Date().toISOString(),
    };
    this.monitoringPoints.set(record.id, record);
    return record;
  }

  async findMonitoringPoint(query: {
    readonly organizationId: string;
    readonly monitoringPointId: string;
  }): Promise<MonitoringPointRecord | undefined> {
    const point = this.monitoringPoints.get(query.monitoringPointId);
    return point !== undefined && point.organizationId === query.organizationId ? point : undefined;
  }

  async updateMonitoringPoint(
    input: UpdateMonitoringPointRecord,
  ): Promise<MonitoringPointRecord | undefined> {
    const existing = await this.findMonitoringPoint({
      organizationId: input.organizationId,
      monitoringPointId: input.monitoringPointId,
    });
    if (existing === undefined) return undefined;
    // Replace the record rather than mutate it: the transaction snapshot keeps
    // the old object reference, so an in-place edit would survive a rollback.
    const record: MonitoringPointRecord = {
      ...existing,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.kind === undefined ? {} : { kind: input.kind }),
      ...(input.unit === undefined ? {} : { unit: input.unit }),
      ...(input.targetMin === undefined ? {} : { targetMin: input.targetMin }),
      ...(input.targetMax === undefined ? {} : { targetMax: input.targetMax }),
      ...(input.checkFrequency === undefined ? {} : { checkFrequency: input.checkFrequency }),
      ...(input.locationId === undefined ? {} : { locationId: input.locationId }),
      ...(input.storageAreaId === undefined ? {} : { storageAreaId: input.storageAreaId }),
      ...(input.active === undefined ? {} : { active: input.active }),
    };
    this.monitoringPoints.set(record.id, record);
    return record;
  }

  async listMonitoringPoints(
    query: MonitoringPointListQuery,
  ): Promise<readonly MonitoringPointRecord[]> {
    const rows = [...this.monitoringPoints.values()]
      .filter((point) => point.organizationId === query.organizationId)
      .filter((point) => query.locationId === undefined || point.locationId === query.locationId)
      .filter((point) => query.activeOnly !== true || point.active)
      .sort((a, b) => {
        if (a.code !== b.code) return a.code < b.code ? -1 : 1;
        return a.id < b.id ? -1 : 1;
      });
    const offset = query.offset ?? 0;
    const limit = query.limit ?? rows.length;
    return rows.slice(offset, offset + limit);
  }

  async recordMonitoringReading(
    input: NewMonitoringReadingRecord,
  ): Promise<MonitoringReadingRecord> {
    const record: MonitoringReadingRecord = {
      id: this.nextId("reading"),
      ...input,
      // Match the adapter's `toMonitoringReading`, which reads the `timestamptz`
      // back as `Date(...).toISOString()`.
      measuredAt: new Date(input.measuredAt).toISOString(),
      createdAt: new Date().toISOString(),
    };
    this.monitoringReadings.set(record.id, record);
    return record;
  }

  async listMonitoringReadings(
    query: MonitoringReadingListQuery,
  ): Promise<readonly MonitoringReadingRecord[]> {
    const rows = [...this.monitoringReadings.values()]
      .filter((reading) => reading.organizationId === query.organizationId)
      .filter(
        (reading) =>
          query.monitoringPointId === undefined ||
          reading.monitoringPointId === query.monitoringPointId,
      )
      .sort((a, b) => {
        if (a.measuredAt !== b.measuredAt) return a.measuredAt < b.measuredAt ? 1 : -1;
        return a.id < b.id ? 1 : -1;
      });
    const offset = query.offset ?? 0;
    const limit = query.limit ?? rows.length;
    return rows.slice(offset, offset + limit);
  }
}

export interface HmsFixture {
  readonly organizationId: string;
  readonly otherOrganizationId: string;
  readonly actorId: string;
  readonly locationId: string;
  readonly otherLocationId: string;
}

/**
 * Seeds the two-organization fixture the HMS tests share: a location in each
 * organization so a point can be registered in one and read from the other.
 */
export function seedHmsFixture(): HmsFixture {
  return {
    organizationId: "org-1",
    otherOrganizationId: "org-2",
    actorId: "actor-1",
    locationId: "loc-1",
    otherLocationId: "loc-2",
  };
}
