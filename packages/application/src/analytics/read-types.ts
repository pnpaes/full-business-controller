import type { ForecastGrain, ForecastProjectionPoint } from "./types";

/**
 * Read-side port for the `DEC-011` forecast-tracking slice.
 *
 * `findLatestForecastSnapshot` backs `computeForecastTracking` (the newest
 * snapshot for one exact organization/scope, or `undefined` → `no_snapshot`);
 * `listForecastOverrides` surfaces the advisory human annotations recorded for
 * the scope. Both reads carry the organization (`DEC-061`) and match the scope
 * exactly — a `null` scope dimension is matched as `is null`, never skipped, so
 * an organization-wide snapshot is distinct from a location-scoped one.
 */

/** The exact scope a snapshot lookup matches (all four dimensions). */
export interface ForecastSnapshotLookup {
  readonly organizationId: string;
  readonly metric: string;
  readonly grain: ForecastGrain;
  readonly locationId: string | null;
  readonly channelId: string | null;
  readonly category: string | null;
  readonly productVariantId: string | null;
}

/** The optional narrowing of an override list; an omitted dimension is not filtered. */
export interface ForecastOverrideLookup {
  readonly organizationId: string;
  readonly metric: string;
  readonly grain: ForecastGrain;
  readonly period?: string | undefined;
  readonly locationId?: string | null | undefined;
  readonly channelId?: string | null | undefined;
  readonly category?: string | null | undefined;
  readonly productVariantId?: string | null | undefined;
}

/** One recorded `forecast_snapshot` row, as the read port returns it. */
export interface ForecastSnapshotRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly metric: string;
  readonly grain: ForecastGrain;
  readonly locationId: string | null;
  readonly channelId: string | null;
  readonly category: string | null;
  readonly productVariantId: string | null;
  /** The model-fit instant; ISO. */
  readonly asOf: string;
  /** When the row was written; ISO. */
  readonly generatedAt: string;
  readonly model: string;
  /** The projected points, stored verbatim as a JSONB array. */
  readonly projection: readonly ForecastProjectionPoint[];
  readonly accuracyMethod: string | null;
  /** MAPE as a fraction at 6 dp. */
  readonly accuracyMape: string | null;
  readonly accuracyPoints: number | null;
}

/** One append-only `forecast_override` row, as the read port returns it. */
export interface ForecastOverrideRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly snapshotId: string | null;
  readonly metric: string;
  readonly grain: ForecastGrain;
  readonly period: string;
  readonly locationId: string | null;
  readonly channelId: string | null;
  readonly category: string | null;
  readonly productVariantId: string | null;
  readonly actorId: string;
  readonly reason: string;
  /** `timestamptz`, ISO. */
  readonly createdAt: string;
}

export interface ForecastReadStore {
  /** The newest snapshot for one exact organization/scope, or `undefined`. */
  findLatestForecastSnapshot(
    query: ForecastSnapshotLookup,
  ): Promise<ForecastSnapshotRecord | undefined>;
  /** The organization/scope's overrides, oldest first. */
  listForecastOverrides(query: ForecastOverrideLookup): Promise<readonly ForecastOverrideRecord[]>;
}
