import { and, asc, desc, eq, gte, lte } from "drizzle-orm";

import type { Database } from "../client";
import { monitoringPoint, monitoringReading } from "../schema";

export type MonitoringPoint = typeof monitoringPoint.$inferSelect;
export type NewMonitoringPoint = typeof monitoringPoint.$inferInsert;
export type MonitoringReading = typeof monitoringReading.$inferSelect;
export type NewMonitoringReading = typeof monitoringReading.$inferInsert;

/*
 * `DEC-089` (`HMS-002`): the HMS monitoring points and readings slice.
 *
 * `monitoring_point` carries `organization_id` directly, so every read and write
 * that takes the organization is scoped by it (`DEC-061`) — as is the create
 * (`input.organizationId`). A point's `location_id` and optional
 * `storage_area_id` are ordinary FKs; `kind`/`check_frequency` are checked
 * against the `MONITORING_POINT_KIND`/`CHECK_FREQUENCY` vocabularies and
 * `target_min <= target_max` is a database check, so this layer does not
 * re-validate them.
 *
 * `recordMonitoringReading` appends a fact: `in_range` is supplied by the
 * caller (derived through the domain `isReadingInRange`), and the `0038`
 * append-only trigger is the database backstop — `value`, `unit`,
 * `measured_at`, `monitoring_point_id` and `organization_id` are immutable, a
 * DELETE is rejected, and only `notes` may be amended (with the audit columns
 * recording it). This repository therefore exposes no update/delete for a
 * reading beyond that `notes` amendment.
 */

export async function createMonitoringPoint(
  db: Database,
  input: NewMonitoringPoint,
): Promise<MonitoringPoint> {
  const rows = await db.insert(monitoringPoint).values(input).returning();
  return rows[0]!;
}

export interface FindMonitoringPointQuery {
  readonly organizationId: string;
  readonly monitoringPointId: string;
}

/** One monitoring point by id, organization-scoped (`DEC-061`), or `undefined`. */
export async function findMonitoringPoint(
  db: Database,
  query: FindMonitoringPointQuery,
): Promise<MonitoringPoint | undefined> {
  const rows = await db
    .select()
    .from(monitoringPoint)
    .where(
      and(
        eq(monitoringPoint.id, query.monitoringPointId),
        eq(monitoringPoint.organizationId, query.organizationId),
      ),
    )
    .limit(1);
  return rows[0];
}

export interface UpdateMonitoringPointPatch {
  readonly name?: string;
  readonly kind?: string;
  readonly unit?: string;
  /** numeric(19,6); inclusive lower bound. */
  readonly targetMin?: string;
  /** numeric(19,6); inclusive upper bound. */
  readonly targetMax?: string;
  readonly checkFrequency?: string;
  readonly locationId?: string;
  readonly storageAreaId?: string | null;
  readonly active?: boolean;
}

export interface UpdateMonitoringPointInput extends UpdateMonitoringPointPatch {
  readonly organizationId: string;
  readonly monitoringPointId: string;
}

/**
 * Updates one monitoring point's mutable fields, organization-scoped
 * (`DEC-061`). `code` and the audit columns are deliberately absent: a code is
 * immutable once assigned (the `(organization_id, code)` key it anchors must not
 * move under a caller), so a correction changes `name`, the vocabulary fields,
 * the target bounds, the location/storage area or `active` only. The id alone
 * cannot address another tenant's row — a missing or cross-organization id
 * returns `undefined`, exactly like `findMonitoringPoint`. The schema checks
 * (`monitoring_point_kind_check`, `monitoring_point_check_frequency_check`,
 * `monitoring_point_target_range_check`) remain the database backstop; the
 * application validates first so callers see `DomainError`.
 */
export async function updateMonitoringPoint(
  db: Database,
  input: UpdateMonitoringPointInput,
): Promise<MonitoringPoint | undefined> {
  const { organizationId, monitoringPointId, ...patch } = input;
  const rows = await db
    .update(monitoringPoint)
    .set(patch)
    .where(
      and(
        eq(monitoringPoint.id, monitoringPointId),
        eq(monitoringPoint.organizationId, organizationId),
      ),
    )
    .returning();
  return rows[0];
}

export interface ListMonitoringPointsQuery {
  readonly organizationId: string;
  readonly locationId?: string;
  /** When true, only `active` points are returned; when omitted, all are. */
  readonly activeOnly?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Monitoring points for one organization, ordered by `code` (then `id`), with
 * optional location and active-only filters. The organization filter is never
 * optional, so the caller never sees another tenant's rows. Paging is applied
 * after the ordering.
 */
export async function listMonitoringPoints(
  db: Database,
  query: ListMonitoringPointsQuery,
): Promise<MonitoringPoint[]> {
  const statement = db
    .select()
    .from(monitoringPoint)
    .where(
      and(
        eq(monitoringPoint.organizationId, query.organizationId),
        query.locationId === undefined
          ? undefined
          : eq(monitoringPoint.locationId, query.locationId),
        query.activeOnly === true ? eq(monitoringPoint.active, true) : undefined,
      ),
    )
    .orderBy(asc(monitoringPoint.code), asc(monitoringPoint.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}

/**
 * Appends a monitoring reading. `in_range` is the caller-derived verdict and
 * the row is immutable apart from `notes` once written (the `0038` trigger).
 */
export async function recordMonitoringReading(
  db: Database,
  input: NewMonitoringReading,
): Promise<MonitoringReading> {
  const rows = await db.insert(monitoringReading).values(input).returning();
  return rows[0]!;
}

export interface ListMonitoringReadingsQuery {
  readonly organizationId: string;
  readonly monitoringPointId?: string;
  /** Inclusive lower bound on `measured_at`. */
  readonly from?: Date;
  /** Inclusive upper bound on `measured_at`. */
  readonly to?: Date;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Monitoring readings for one organization, newest `measured_at` first (then
 * `id`), with an optional point filter and an inclusive `measured_at` window
 * (`from`/`to`; either bound may be omitted). The organization filter is never
 * optional (`DEC-061`). Paging is applied after the ordering.
 */
export async function listMonitoringReadings(
  db: Database,
  query: ListMonitoringReadingsQuery,
): Promise<MonitoringReading[]> {
  const statement = db
    .select()
    .from(monitoringReading)
    .where(
      and(
        eq(monitoringReading.organizationId, query.organizationId),
        query.monitoringPointId === undefined
          ? undefined
          : eq(monitoringReading.monitoringPointId, query.monitoringPointId),
        query.from === undefined ? undefined : gte(monitoringReading.measuredAt, query.from),
        query.to === undefined ? undefined : lte(monitoringReading.measuredAt, query.to),
      ),
    )
    .orderBy(desc(monitoringReading.measuredAt), desc(monitoringReading.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}
