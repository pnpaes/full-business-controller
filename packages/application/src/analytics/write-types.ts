import type { AuditInput } from "../auth";

import type { ForecastOverrideRecord, ForecastSnapshotRecord } from "./read-types";
import type { ForecastGrain, ForecastProjectionPoint } from "./types";

/**
 * Write-side port for the `DEC-011` forecast-tracking slice.
 *
 * `recordForecastSnapshot` and `recordForecastOverride` bind their write and
 * their audit fact to one transaction (`withTransaction`), so the two commit
 * together and a failed audit cannot leave an unaudited snapshot/override.
 * `createForecastOverride` is append-only at the port and at the database — the
 * port deliberately exposes no update or delete for it.
 */

/** The fields of a new `forecast_snapshot` row. */
export interface NewForecastSnapshotRecord {
  readonly organizationId: string;
  readonly metric: string;
  readonly grain: ForecastGrain;
  readonly locationId: string | null;
  readonly channelId: string | null;
  readonly category: string | null;
  readonly productVariantId: string | null;
  /** The model-fit instant; ISO. */
  readonly asOf: string;
  readonly model: string;
  readonly projection: readonly ForecastProjectionPoint[];
  readonly accuracyMethod: string | null;
  readonly accuracyMape: string | null;
  readonly accuracyPoints: number | null;
  /** Stamped on `created_by`. */
  readonly actorId: string;
}

/** The fields of a new `forecast_override` row. */
export interface NewForecastOverrideRecord {
  readonly organizationId: string;
  readonly snapshotId: string | null;
  readonly metric: string;
  readonly grain: ForecastGrain;
  readonly period: string;
  readonly locationId: string | null;
  readonly channelId: string | null;
  readonly category: string | null;
  readonly productVariantId: string | null;
  /** The acting actor; also stamped on `created_by`. */
  readonly actorId: string;
  /** Mandatory: there is no silent override. */
  readonly reason: string;
}

export interface ForecastWriteStore {
  /** Binds `fn` to one transaction so the write and its audit row commit together. */
  withTransaction<T>(fn: (store: ForecastWriteStore) => Promise<T>): Promise<T>;
  createForecastSnapshot(input: NewForecastSnapshotRecord): Promise<ForecastSnapshotRecord>;
  /** Append-only: no update or delete counterpart exists. */
  createForecastOverride(input: NewForecastOverrideRecord): Promise<ForecastOverrideRecord>;
  /** Append-only audit fact; the caller must not pass secrets (ADR-0003 convention). */
  writeAudit(input: AuditInput): Promise<void>;
}
