import { and, asc, desc, eq, gt, isNull, lte, or } from "drizzle-orm";

import type { Database } from "../client";
import { priceVersion } from "../schema";

export type PriceVersion = typeof priceVersion.$inferSelect;
export type NewPriceVersion = typeof priceVersion.$inferInsert;

/*
 * `price_version` reads/writes (`PRICE-002/003`; `DEC-064`, `DEC-077`): the
 * approved, effective price for one exact
 * `(organization, product variant, location, channel)` scope. The table carries
 * `organization_id` directly, so every read and write is organization-scoped
 * (`DEC-061`). A null `location_id`/`channel_id` is a single "any
 * location"/"any channel" scope, not an unfiltered match, so the scope helpers
 * use `isNull` rather than skipping the column. The non-overlapping half-open
 * `[effective_from, effective_to)` window is enforced by the
 * `price_version_no_overlap` EXCLUDE constraint in `0027_price_version.sql`.
 * This module stores and reads versions; deciding that only an approved
 * scenario may produce one (`source_scenario_id`) is the application's job.
 */

export async function createPriceVersion(
  db: Database,
  input: NewPriceVersion,
): Promise<PriceVersion> {
  const rows = await db.insert(priceVersion).values(input).returning();
  return rows[0]!;
}

export interface FindPriceVersionQuery {
  readonly organizationId: string;
  readonly priceVersionId: string;
}

/** One price version by id, organization-scoped (`DEC-061`), or `undefined`. */
export async function findPriceVersion(
  db: Database,
  query: FindPriceVersionQuery,
): Promise<PriceVersion | undefined> {
  const rows = await db
    .select()
    .from(priceVersion)
    .where(
      and(
        eq(priceVersion.id, query.priceVersionId),
        eq(priceVersion.organizationId, query.organizationId),
      ),
    )
    .limit(1);
  return rows[0];
}

export interface ListPriceVersionsQuery {
  readonly organizationId: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Price versions for one organization, newest `effective_from` first (then
 * `id`), paged after the ordering. Every row is scoped to the organization, so
 * the caller never sees another tenant's versions.
 */
export async function listPriceVersions(
  db: Database,
  query: ListPriceVersionsQuery,
): Promise<PriceVersion[]> {
  const statement = db
    .select()
    .from(priceVersion)
    .where(eq(priceVersion.organizationId, query.organizationId))
    .orderBy(desc(priceVersion.effectiveFrom), desc(priceVersion.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}

export interface PriceVersionScopeQuery {
  readonly organizationId: string;
  readonly productVariantId: string;
  /** `null` matches versions with no location (an organization-wide price). */
  readonly locationId: string | null;
  /** `null` matches versions with no channel (an organization-wide price). */
  readonly channelId: string | null;
}

/**
 * Every price version for one exact scope, oldest `effective_from` first. The
 * null columns are meaningful, not "unfiltered": `null` matches the single
 * "any location"/"any channel" scope (mirrors `listCostCardsForScope`), so an
 * exact-scope history reads its own versions only.
 */
export async function listPriceVersionsForScope(
  db: Database,
  query: PriceVersionScopeQuery,
): Promise<PriceVersion[]> {
  const locationFilter =
    query.locationId === null
      ? isNull(priceVersion.locationId)
      : eq(priceVersion.locationId, query.locationId);
  const channelFilter =
    query.channelId === null
      ? isNull(priceVersion.channelId)
      : eq(priceVersion.channelId, query.channelId);
  return db
    .select()
    .from(priceVersion)
    .where(
      and(
        eq(priceVersion.organizationId, query.organizationId),
        eq(priceVersion.productVariantId, query.productVariantId),
        locationFilter,
        channelFilter,
      ),
    )
    .orderBy(asc(priceVersion.effectiveFrom), asc(priceVersion.id));
}

export interface EffectivePriceVersionQuery extends PriceVersionScopeQuery {
  /** The instant to resolve the effective version at. */
  readonly asOf: Date;
}

/**
 * The price version effective for one exact scope at `asOf`, or `undefined`
 * when none covers that instant. The window is half-open
 * `[effective_from, effective_to)`: `effective_from <= asOf` and
 * `(effective_to IS NULL OR effective_to > asOf)`. The `effective_to` boundary
 * is **exclusive**, so a version ending exactly at `asOf` is not effective
 * there; that instant belongs to the next window. The
 * `price_version_no_overlap` EXCLUDE constraint guarantees at most one match per
 * scope; `effective_from` descending is a defensive tie-break.
 */
export async function findEffectivePriceVersion(
  db: Database,
  query: EffectivePriceVersionQuery,
): Promise<PriceVersion | undefined> {
  const locationFilter =
    query.locationId === null
      ? isNull(priceVersion.locationId)
      : eq(priceVersion.locationId, query.locationId);
  const channelFilter =
    query.channelId === null
      ? isNull(priceVersion.channelId)
      : eq(priceVersion.channelId, query.channelId);
  const rows = await db
    .select()
    .from(priceVersion)
    .where(
      and(
        eq(priceVersion.organizationId, query.organizationId),
        eq(priceVersion.productVariantId, query.productVariantId),
        locationFilter,
        channelFilter,
        lte(priceVersion.effectiveFrom, query.asOf),
        or(isNull(priceVersion.effectiveTo), gt(priceVersion.effectiveTo, query.asOf)),
      ),
    )
    .orderBy(desc(priceVersion.effectiveFrom), desc(priceVersion.id))
    .limit(1);
  return rows[0];
}
