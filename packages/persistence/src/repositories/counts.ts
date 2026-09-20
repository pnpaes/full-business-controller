import { and, asc, desc, eq, isNull, type SQL } from "drizzle-orm";

import type { Database } from "../client";
import { stockCount, stockCountLine } from "../schema";

export type StockCount = typeof stockCount.$inferSelect;
export type NewStockCount = typeof stockCount.$inferInsert;
export type StockCountLine = typeof stockCountLine.$inferSelect;
export type NewStockCountLine = typeof stockCountLine.$inferInsert;

export async function createStockCount(db: Database, input: NewStockCount): Promise<StockCount> {
  const rows = await db.insert(stockCount).values(input).returning();
  return rows[0]!;
}

export interface FindStockCountQuery {
  readonly organizationId: string;
  readonly stockCountId: string;
}

/** One count by id, organization-scoped (`DEC-061`), or `undefined`. */
export async function findStockCount(
  db: Database,
  query: FindStockCountQuery,
): Promise<StockCount | undefined> {
  const rows = await db
    .select()
    .from(stockCount)
    .where(
      and(
        eq(stockCount.id, query.stockCountId),
        eq(stockCount.organizationId, query.organizationId),
      ),
    )
    .limit(1);
  return rows[0];
}

export interface ListStockCountsQuery {
  readonly organizationId: string;
  readonly locationId?: string;
  readonly status?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Counts for one organization, newest cutoff first (`cutoff`, then `id`), with
 * optional location/status filters. Every filter is optional except the
 * organization, so the caller never sees another tenant's rows. Paging is
 * applied after the ordering.
 */
export async function listStockCounts(
  db: Database,
  query: ListStockCountsQuery,
): Promise<StockCount[]> {
  const statement = db
    .select()
    .from(stockCount)
    .where(
      and(
        eq(stockCount.organizationId, query.organizationId),
        query.locationId === undefined ? undefined : eq(stockCount.locationId, query.locationId),
        query.status === undefined ? undefined : eq(stockCount.status, query.status),
      ),
    )
    .orderBy(desc(stockCount.cutoff), desc(stockCount.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}

export async function createStockCountLine(
  db: Database,
  input: NewStockCountLine,
): Promise<StockCountLine> {
  const rows = await db.insert(stockCountLine).values(input).returning();
  return rows[0]!;
}

/** The natural key of a count line; `lotId` null = the lot-less bucket. */
export interface StockCountLineKey {
  readonly stockCountId: string;
  readonly itemId: string;
  readonly storageAreaId: string;
  readonly lotId: string | null;
}

/** `lot_id IS NULL` for the no-lot key, never `= null` (which matches nothing). */
function lineKeyFilter(key: StockCountLineKey): SQL {
  return and(
    eq(stockCountLine.stockCountId, key.stockCountId),
    eq(stockCountLine.itemId, key.itemId),
    eq(stockCountLine.storageAreaId, key.storageAreaId),
    key.lotId === null ? isNull(stockCountLine.lotId) : eq(stockCountLine.lotId, key.lotId),
  )!;
}

/**
 * One count line by its natural key, organization-scoped through the parent
 * count (`stock_count_line` carries no `organization_id` of its own).
 */
export async function findStockCountLine(
  db: Database,
  query: StockCountLineKey & { readonly organizationId: string },
): Promise<StockCountLine | undefined> {
  const rows = await db
    .select({ line: stockCountLine })
    .from(stockCountLine)
    .innerJoin(stockCount, eq(stockCount.id, stockCountLine.stockCountId))
    .where(and(lineKeyFilter(query), eq(stockCount.organizationId, query.organizationId)))
    .limit(1);
  return rows[0]?.line;
}

export interface ListStockCountLinesQuery {
  readonly organizationId: string;
  readonly stockCountId: string;
}

/** Lines of one count (unordered — the dictionary has no sequence column). */
export async function listStockCountLines(
  db: Database,
  query: ListStockCountLinesQuery,
): Promise<StockCountLine[]> {
  const rows = await db
    .select({ line: stockCountLine })
    .from(stockCountLine)
    .innerJoin(stockCount, eq(stockCount.id, stockCountLine.stockCountId))
    .where(
      and(
        eq(stockCountLine.stockCountId, query.stockCountId),
        eq(stockCount.organizationId, query.organizationId),
      ),
    )
    .orderBy(asc(stockCountLine.itemId));
  return rows.map((row) => row.line);
}

/**
 * Create-or-find a count line by its natural key `(stock_count_id, item_id,
 * storage_area_id, lot_id)`, safe against the create/find race:
 * `INSERT … ON CONFLICT DO NOTHING` then `SELECT` the surviving row. The unique
 * index is `NULLS NOT DISTINCT`, so the lot-less bucket conflicts like any other
 * key. This is the slice-9 idempotency path (a blind count may re-submit the
 * same line); transfers and waste events have no natural key, so there is no
 * equivalent there.
 */
export async function findOrCreateStockCountLine(
  db: Database,
  input: NewStockCountLine,
): Promise<StockCountLine> {
  const inserted = await db.insert(stockCountLine).values(input).onConflictDoNothing().returning();
  const created = inserted[0];
  if (created !== undefined) {
    return created;
  }

  const rows = await db
    .select()
    .from(stockCountLine)
    .where(
      lineKeyFilter({
        stockCountId: input.stockCountId,
        itemId: input.itemId,
        storageAreaId: input.storageAreaId,
        lotId: input.lotId ?? null,
      }),
    )
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    throw new Error(
      "stock_count_line row missing after findOrCreateStockCountLine: the conflicting unique " +
        "index and the lookup key disagree",
    );
  }
  return row;
}

export interface StockCountPatch {
  status?: string;
  approvedBy?: string | null;
  approvedAt?: Date | null;
  updatedAt?: Date;
}

/**
 * Narrow update for the count lifecycle (`INV-004`, `DEC-017`): status plus the
 * approval stamp. The schema's `stock_count_approved_check` still governs which
 * combinations are legal.
 */
export async function updateStockCount(
  db: Database,
  id: string,
  patch: StockCountPatch,
): Promise<StockCount | undefined> {
  const rows = await db.update(stockCount).set(patch).where(eq(stockCount.id, id)).returning();
  return rows[0];
}

export interface StockCountLinePatch {
  countedQty?: string | null;
  varianceQty?: string | null;
  reasonCode?: string | null;
  recount?: boolean;
}

/** Records an observation (`counted_qty`) or the derived variance on one line. */
export async function updateStockCountLine(
  db: Database,
  id: string,
  patch: StockCountLinePatch,
): Promise<StockCountLine | undefined> {
  const rows = await db
    .update(stockCountLine)
    .set(patch)
    .where(eq(stockCountLine.id, id))
    .returning();
  return rows[0];
}
