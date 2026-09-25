import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import type { Database } from "../client";
import { forecastOverride, forecastSnapshot } from "../schema";

export type ForecastSnapshot = typeof forecastSnapshot.$inferSelect;
export type NewForecastSnapshot = typeof forecastSnapshot.$inferInsert;
export type ForecastOverride = typeof forecastOverride.$inferSelect;
export type NewForecastOverride = typeof forecastOverride.$inferInsert;

/*
 * `DEC-011` (row 15): the forecast-tracking repository. Both tables carry
 * `organization_id` directly, so every read and write that takes the
 * organization is scoped by it (`DEC-061`): a row in another organization is
 * invisible. `forecast_override` is **append-only** — the `0070` trigger rejects
 * UPDATE/DELETE/TRUNCATE — so this module exposes no update or delete for it,
 * only an insert and reads. The application validates the metric/grain/scope and
 * the mandatory reason first so a caller sees a `DomainError`; the database
 * checks are the backstop.
 *
 * The audit columns are plain uuid (`auditColumns()`), so `createdBy` takes the
 * acting user id; the application writes the `audit_event` facts, not this layer
 * (the `competitor.ts`/`integrations.ts` convention).
 */

/** `eq` for a set scope value, `is null` for a null/undefined one. */
function scopeMatch(column: AnyPgColumn, value: string | null | undefined) {
  return value === undefined || value === null ? isNull(column) : eq(column, value);
}

export interface CreateForecastSnapshotInput {
  readonly organizationId: string;
  readonly metric: string;
  readonly grain: string;
  readonly locationId: string | null;
  readonly channelId: string | null;
  readonly category: string | null;
  readonly productVariantId: string | null;
  /** The model-fit instant (`computeForecast.asOf`). */
  readonly asOf: Date;
  readonly model: string;
  /** The projected points, stored verbatim as a JSONB array. */
  readonly projection: readonly unknown[];
  readonly accuracyMethod?: string | null;
  readonly accuracyMape?: string | null;
  readonly accuracyPoints?: number | null;
  readonly actorId: string;
}

/** Inserts one `forecast_snapshot` row and returns it. */
export async function createForecastSnapshot(
  db: Database,
  input: CreateForecastSnapshotInput,
): Promise<ForecastSnapshot> {
  const rows = await db
    .insert(forecastSnapshot)
    .values({
      organizationId: input.organizationId,
      metric: input.metric,
      grain: input.grain,
      locationId: input.locationId,
      channelId: input.channelId,
      category: input.category,
      productVariantId: input.productVariantId,
      asOf: input.asOf,
      model: input.model,
      projection: [...input.projection],
      accuracyMethod: input.accuracyMethod ?? null,
      accuracyMape: input.accuracyMape ?? null,
      accuracyPoints: input.accuracyPoints ?? null,
      createdBy: input.actorId,
    })
    .returning();
  return rows[0]!;
}

export interface ForecastScopeQuery {
  readonly organizationId: string;
  readonly metric: string;
  readonly grain: string;
  readonly locationId: string | null;
  readonly channelId: string | null;
  readonly category: string | null;
  readonly productVariantId: string | null;
}

/** The `WHERE` matching one exact scope (null scope is `is null`, not skipped). */
function exactScope(scope: ForecastScopeQuery) {
  return and(
    eq(forecastSnapshot.organizationId, scope.organizationId),
    eq(forecastSnapshot.metric, scope.metric),
    eq(forecastSnapshot.grain, scope.grain),
    scopeMatch(forecastSnapshot.locationId, scope.locationId),
    scopeMatch(forecastSnapshot.channelId, scope.channelId),
    scopeMatch(forecastSnapshot.category, scope.category),
    scopeMatch(forecastSnapshot.productVariantId, scope.productVariantId),
  );
}

/**
 * The most recent `forecast_snapshot` for one exact organization/scope, ordered
 * `as_of` (then `generated_at`, then `id`) descending, or `undefined` when the
 * scope has no snapshot. Backs `computeForecastTracking`'s `no_snapshot` state.
 */
export async function findLatestForecastSnapshot(
  db: Database,
  scope: ForecastScopeQuery,
): Promise<ForecastSnapshot | undefined> {
  const rows = await db
    .select()
    .from(forecastSnapshot)
    .where(exactScope(scope))
    .orderBy(
      desc(forecastSnapshot.asOf),
      desc(forecastSnapshot.generatedAt),
      desc(forecastSnapshot.id),
    )
    .limit(1);
  return rows[0];
}

export interface ListForecastSnapshotsQuery extends ForecastScopeQuery {
  readonly limit?: number;
  readonly offset?: number;
}

/** The organization/scope's snapshots, newest first, with bounded paging. */
export async function listForecastSnapshots(
  db: Database,
  query: ListForecastSnapshotsQuery,
): Promise<readonly ForecastSnapshot[]> {
  const statement = db
    .select()
    .from(forecastSnapshot)
    .where(exactScope(query))
    .orderBy(
      desc(forecastSnapshot.asOf),
      desc(forecastSnapshot.generatedAt),
      desc(forecastSnapshot.id),
    )
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}

export interface CreateForecastOverrideInput {
  readonly organizationId: string;
  readonly snapshotId: string | null;
  readonly metric: string;
  readonly grain: string;
  readonly period: string;
  readonly locationId: string | null;
  readonly channelId: string | null;
  readonly category: string | null;
  readonly productVariantId: string | null;
  readonly actorId: string;
  readonly reason: string;
}

/**
 * Appends one `forecast_override` row. Append-only: there is deliberately no
 * update or delete counterpart (the `0070` trigger is the database backstop).
 */
export async function createForecastOverride(
  db: Database,
  input: CreateForecastOverrideInput,
): Promise<ForecastOverride> {
  const rows = await db
    .insert(forecastOverride)
    .values({
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
      createdBy: input.actorId,
    })
    .returning();
  return rows[0]!;
}

export interface ListForecastOverridesQuery {
  readonly organizationId: string;
  readonly metric?: string | undefined;
  readonly grain?: string | undefined;
  readonly period?: string | undefined;
  readonly locationId?: string | null | undefined;
  readonly channelId?: string | null | undefined;
  readonly category?: string | null | undefined;
  readonly productVariantId?: string | null | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
}

/**
 * The organization's overrides, oldest first, optionally narrowed to a
 * metric/grain/period and a scope. A scope value left out is not filtered on;
 * an explicit `null` matches the organization-wide rows.
 */
export async function listForecastOverrides(
  db: Database,
  query: ListForecastOverridesQuery,
): Promise<readonly ForecastOverride[]> {
  const filters = [eq(forecastOverride.organizationId, query.organizationId)];
  if (query.metric !== undefined) {
    filters.push(eq(forecastOverride.metric, query.metric));
  }
  if (query.grain !== undefined) {
    filters.push(eq(forecastOverride.grain, query.grain));
  }
  if (query.period !== undefined) {
    filters.push(eq(forecastOverride.period, query.period));
  }
  if (query.locationId !== undefined) {
    filters.push(scopeMatch(forecastOverride.locationId, query.locationId));
  }
  if (query.channelId !== undefined) {
    filters.push(scopeMatch(forecastOverride.channelId, query.channelId));
  }
  if (query.category !== undefined) {
    filters.push(scopeMatch(forecastOverride.category, query.category));
  }
  if (query.productVariantId !== undefined) {
    filters.push(scopeMatch(forecastOverride.productVariantId, query.productVariantId));
  }

  const statement = db
    .select()
    .from(forecastOverride)
    .where(and(...filters))
    .orderBy(
      asc(forecastOverride.period),
      asc(forecastOverride.createdAt),
      asc(forecastOverride.id),
    )
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}
