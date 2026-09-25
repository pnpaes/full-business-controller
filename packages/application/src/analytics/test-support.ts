import type { AuditInput } from "../auth";
import { FakeReportingStore } from "../reporting";

import type {
  ForecastOverrideLookup,
  ForecastOverrideRecord,
  ForecastReadStore,
  ForecastSnapshotLookup,
  ForecastSnapshotRecord,
} from "./read-types";
import type {
  ForecastWriteStore,
  NewForecastOverrideRecord,
  NewForecastSnapshotRecord,
} from "./write-types";

/**
 * In-memory store for the forecast-tracking unit suite. It extends
 * `FakeReportingStore`, so a test can seed the sales groups `computeForecast`
 * and the tracking read consume, and mirrors the forecast port's observable
 * contract (exact-scope lookup, newest-first snapshot ordering, oldest-first
 * override ordering, append-only writes). The Postgres adapter is covered by
 * `forecast.postgres.test.ts`.
 */
export class FakeForecastStore
  extends FakeReportingStore
  implements ForecastWriteStore, ForecastReadStore
{
  readonly snapshots: ForecastSnapshotRecord[] = [];
  readonly overrides: ForecastOverrideRecord[] = [];
  readonly audits: AuditInput[] = [];

  private sequence = 0;

  async withTransaction<T>(fn: (store: ForecastWriteStore) => Promise<T>): Promise<T> {
    return fn(this);
  }

  findLatestForecastSnapshot(
    query: ForecastSnapshotLookup,
  ): Promise<ForecastSnapshotRecord | undefined> {
    const matches = this.snapshots
      .filter((row) => row.organizationId === query.organizationId)
      .filter((row) => row.metric === query.metric && row.grain === query.grain)
      .filter(
        (row) =>
          row.locationId === query.locationId &&
          row.channelId === query.channelId &&
          row.category === query.category &&
          row.productVariantId === query.productVariantId,
      )
      .sort(
        (left, right) =>
          right.asOf.localeCompare(left.asOf) ||
          right.generatedAt.localeCompare(left.generatedAt) ||
          right.id.localeCompare(left.id),
      );
    return Promise.resolve(matches[0]);
  }

  listForecastOverrides(query: ForecastOverrideLookup): Promise<readonly ForecastOverrideRecord[]> {
    const rows = this.overrides
      .filter((row) => row.organizationId === query.organizationId)
      .filter((row) => row.metric === query.metric && row.grain === query.grain)
      .filter((row) => query.period === undefined || row.period === query.period)
      .filter((row) => query.locationId === undefined || row.locationId === query.locationId)
      .filter((row) => query.channelId === undefined || row.channelId === query.channelId)
      .filter((row) => query.category === undefined || row.category === query.category)
      .filter(
        (row) =>
          query.productVariantId === undefined || row.productVariantId === query.productVariantId,
      )
      .sort(
        (left, right) =>
          left.period.localeCompare(right.period) ||
          left.createdAt.localeCompare(right.createdAt) ||
          left.id.localeCompare(right.id),
      );
    return Promise.resolve(rows);
  }

  createForecastSnapshot(input: NewForecastSnapshotRecord): Promise<ForecastSnapshotRecord> {
    this.sequence += 1;
    const record: ForecastSnapshotRecord = {
      id: `forecast-snapshot-${this.sequence}`,
      organizationId: input.organizationId,
      metric: input.metric,
      grain: input.grain,
      locationId: input.locationId,
      channelId: input.channelId,
      category: input.category,
      productVariantId: input.productVariantId,
      asOf: input.asOf,
      generatedAt: new Date().toISOString(),
      model: input.model,
      projection: [...input.projection],
      accuracyMethod: input.accuracyMethod,
      accuracyMape: input.accuracyMape,
      accuracyPoints: input.accuracyPoints,
    };
    this.snapshots.push(record);
    return Promise.resolve(record);
  }

  createForecastOverride(input: NewForecastOverrideRecord): Promise<ForecastOverrideRecord> {
    this.sequence += 1;
    const record: ForecastOverrideRecord = {
      id: `forecast-override-${this.sequence}`,
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
      createdAt: new Date().toISOString(),
    };
    this.overrides.push(record);
    return Promise.resolve(record);
  }

  writeAudit(input: AuditInput): Promise<void> {
    this.audits.push(input);
    return Promise.resolve();
  }
}
