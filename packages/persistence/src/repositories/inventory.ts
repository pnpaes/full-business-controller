import { and, asc, eq, gte, isNull, lte, notExists, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Database } from "../client";
import {
  item,
  location,
  organization,
  stockBalance,
  stockLot,
  stockMovement,
  storageArea,
} from "../schema";

export type StockBalance = typeof stockBalance.$inferSelect;
export type NewStockBalance = typeof stockBalance.$inferInsert;
export type StockMovement = typeof stockMovement.$inferSelect;
export type NewStockMovement = typeof stockMovement.$inferInsert;
export type StockLot = typeof stockLot.$inferSelect;
export type NewStockLot = typeof stockLot.$inferInsert;
export type StorageArea = typeof storageArea.$inferSelect;
export type NewStorageArea = typeof storageArea.$inferInsert;
export type Location = typeof location.$inferSelect;
export type Organization = typeof organization.$inferSelect;

/**
 * `Item`/`Unit` row types and their by-id lookups already live in
 * `./master-data` (the application stores reach them through the persistence
 * barrel). They are re-exported here rather than redeclared so a slice-8
 * caller can depend on the inventory module alone without adding an ambiguous
 * duplicate to the `export *` barrel.
 */
export { findItemById, findUnitById } from "./master-data";
export type { Item, Unit } from "./master-data";

/** The identity of a projected `stock_balance` row; `lotId` null = no lot. */
export interface StockBalanceKey {
  readonly organizationId: string;
  readonly itemId: string;
  readonly locationId: string;
  readonly storageAreaId: string;
  readonly lotId: string | null;
}

/** `lot_id IS NULL` for the no-lot key, never `= null` (which matches nothing). */
function balanceKeyFilter(key: StockBalanceKey): SQL | undefined {
  return and(
    eq(stockBalance.organizationId, key.organizationId),
    eq(stockBalance.itemId, key.itemId),
    eq(stockBalance.locationId, key.locationId),
    eq(stockBalance.storageAreaId, key.storageAreaId),
    key.lotId === null ? isNull(stockBalance.lotId) : eq(stockBalance.lotId, key.lotId),
  );
}

export async function findStockBalance(
  db: Database,
  key: StockBalanceKey,
): Promise<StockBalance | undefined> {
  const rows = await db.select().from(stockBalance).where(balanceKeyFilter(key)).limit(1);
  return rows[0];
}

/**
 * Serialises writers on one balance key: an `ON CONFLICT DO NOTHING` insert
 * (idempotent on the `stock_balance_key` unique index) followed by a
 * `SELECT ... FOR UPDATE`, so two concurrent postings of the same key cannot
 * interleave their read-modify-write. The row lock is the ledger's
 * serialisation point (DEC-034; ADR-0005 treats `stock_balance` as a
 * rebuildable projection of the append-only `stock_movement` ledger).
 *
 * MUST be called inside a transaction: outside one the `SELECT … FOR UPDATE`
 * lock is released as soon as the statement's implicit transaction ends, so it
 * serialises nothing.
 */
export async function lockOrCreateStockBalance(
  db: Database,
  key: StockBalanceKey,
  at: Date,
): Promise<StockBalance> {
  await db
    .insert(stockBalance)
    .values({
      organizationId: key.organizationId,
      itemId: key.itemId,
      locationId: key.locationId,
      storageAreaId: key.storageAreaId,
      lotId: key.lotId,
      quantityOnHand: "0",
      valueOnHand: "0",
      asOf: at,
    })
    .onConflictDoNothing();
  const rows = await db.select().from(stockBalance).where(balanceKeyFilter(key)).for("update");
  const row = rows[0];
  if (row === undefined) {
    throw new Error(
      "stock_balance row missing after lockOrCreateStockBalance: the conflicting unique index " +
        "and the lookup key disagree",
    );
  }
  return row;
}

export async function saveStockBalance(
  db: Database,
  key: StockBalanceKey,
  values: {
    readonly quantityOnHand: string;
    readonly valueOnHand: string;
    readonly avgUnitCost: string | null;
    readonly asOf: Date;
  },
): Promise<StockBalance> {
  const rows = await db
    .update(stockBalance)
    .set({
      quantityOnHand: values.quantityOnHand,
      valueOnHand: values.valueOnHand,
      avgUnitCost: values.avgUnitCost,
      asOf: values.asOf,
    })
    .where(balanceKeyFilter(key))
    .returning();
  const row = rows[0];
  if (row === undefined) {
    throw new Error(
      "saveStockBalance updated no row: callers must call lockStockBalance (or " +
        "lockOrCreateStockBalance) for the key before saving",
    );
  }
  return row;
}

export async function createStockMovement(
  db: Database,
  input: NewStockMovement,
): Promise<StockMovement> {
  const rows = await db.insert(stockMovement).values(input).returning();
  return rows[0]!;
}

export async function findStockMovement(
  db: Database,
  id: string,
): Promise<StockMovement | undefined> {
  const rows = await db.select().from(stockMovement).where(eq(stockMovement.id, id)).limit(1);
  return rows[0];
}

export async function findStockMovementByIdempotencyKey(
  db: Database,
  organizationId: string,
  idempotencyKey: string,
): Promise<StockMovement | undefined> {
  const rows = await db
    .select()
    .from(stockMovement)
    .where(
      and(
        eq(stockMovement.organizationId, organizationId),
        eq(stockMovement.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  return rows[0];
}

/** The reversal movement posted against `movementId`, if any. */
export async function findStockMovementReversal(
  db: Database,
  movementId: string,
): Promise<StockMovement | undefined> {
  const rows = await db
    .select()
    .from(stockMovement)
    .where(eq(stockMovement.reversalOfId, movementId))
    .limit(1);
  return rows[0];
}

export interface ListStockMovementsQuery {
  readonly organizationId: string;
  readonly itemId?: string;
  readonly locationId?: string;
  readonly storageAreaId?: string;
  /** Absent = no filter; `null` = match only the no-lot movements. */
  readonly lotId?: string | null;
  /** Filters `source_type`; pair with `sourceId` for one posted source (`DEC-116`). */
  readonly sourceType?: string;
  /** Filters `source_id`; the ledger cost nets by this key (`DEC-116`). */
  readonly sourceId?: string;
  /**
   * Keep only originals that are not already reversed (`DEC-116`): excludes a
   * movement that is itself a reversal (`reversal_of_id IS NOT NULL`) and one
   * that already has a reversal (another movement whose `reversal_of_id` is its
   * id). Absent = no filter; the generic read is unchanged.
   */
  readonly onlyReversible?: boolean;
  /** Filters `occurred_at >= occurredFrom` (the economic/booking date). */
  readonly occurredFrom?: Date;
  /** Filters `occurred_at <= asOf` (the economic/booking date, not `posted_at`). */
  readonly asOf?: Date;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Movements in ledger order (`occurred_at`, then `posted_at`, then `id`), with
 * optional item/location/storage-area/lot/source filters, an `occurred_at`
 * window and limit/offset paging. Paging is applied after the ledger ordering,
 * so page `n` is a stable, contiguous slice of the ledger.
 */
export async function listStockMovements(
  db: Database,
  query: ListStockMovementsQuery,
): Promise<StockMovement[]> {
  const lotFilter =
    query.lotId === undefined
      ? undefined
      : query.lotId === null
        ? isNull(stockMovement.lotId)
        : eq(stockMovement.lotId, query.lotId);
  // `onlyReversible` (`DEC-116`): the movement is an original (not itself a
  // reversal) and nothing reverses it, so a partially-reversed source lists only
  // the still-correctable originals.
  const reversal = alias(stockMovement, "reversal_movement");
  const reversibleFilter =
    query.onlyReversible === true
      ? and(
          isNull(stockMovement.reversalOfId),
          notExists(
            db
              .select({ one: sql`1` })
              .from(reversal)
              .where(eq(reversal.reversalOfId, stockMovement.id)),
          ),
        )
      : undefined;
  const statement = db
    .select()
    .from(stockMovement)
    .where(
      and(
        eq(stockMovement.organizationId, query.organizationId),
        query.itemId === undefined ? undefined : eq(stockMovement.itemId, query.itemId),
        query.locationId === undefined ? undefined : eq(stockMovement.locationId, query.locationId),
        query.storageAreaId === undefined
          ? undefined
          : eq(stockMovement.storageAreaId, query.storageAreaId),
        lotFilter,
        query.sourceType === undefined ? undefined : eq(stockMovement.sourceType, query.sourceType),
        query.sourceId === undefined ? undefined : eq(stockMovement.sourceId, query.sourceId),
        reversibleFilter,
        query.occurredFrom === undefined
          ? undefined
          : gte(stockMovement.occurredAt, query.occurredFrom),
        query.asOf === undefined ? undefined : lte(stockMovement.occurredAt, query.asOf),
      ),
    )
    .orderBy(asc(stockMovement.occurredAt), asc(stockMovement.postedAt), asc(stockMovement.id))
    .$dynamic();
  // `limit`/`offset` mutate the builder's config in place and return `this`
  // (drizzle `select.js`), so the dynamic builder accumulates them.
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}

/**
 * Storage areas for an organization, optionally narrowed to one location, in
 * code order. The movement form and the storage-areas section need the option
 * list; the by-id/by-code lookups above stay the write path's identity reads.
 */
export async function listStorageAreas(
  db: Database,
  query: { readonly organizationId: string; readonly locationId?: string },
): Promise<StorageArea[]> {
  return db
    .select()
    .from(storageArea)
    .where(
      and(
        eq(storageArea.organizationId, query.organizationId),
        query.locationId === undefined ? undefined : eq(storageArea.locationId, query.locationId),
      ),
    )
    .orderBy(asc(storageArea.code));
}

/**
 * Stocked items for an organization, in code order: the candidate set for a
 * manual movement. Non-stocked policies are excluded because the posting command
 * rejects them (`item does not hold stock`), so the form never offers one.
 */
export async function listStockedItems(
  db: Database,
  query: { readonly organizationId: string },
): Promise<(typeof item.$inferSelect)[]> {
  return db
    .select()
    .from(item)
    .where(and(eq(item.organizationId, query.organizationId), eq(item.inventoryPolicy, "stocked")))
    .orderBy(asc(item.code));
}

/** Locations for an organization, in code order: the movement form's option list. */
export async function listLocations(
  db: Database,
  query: { readonly organizationId: string },
): Promise<Location[]> {
  return db
    .select()
    .from(location)
    .where(eq(location.organizationId, query.organizationId))
    .orderBy(asc(location.code));
}

export interface SumStockMovementsAsOfQuery {
  readonly organizationId: string;
  readonly asOf: Date;
  readonly itemId?: string;
  readonly locationId?: string;
}

export interface StockMovementSum {
  readonly organizationId: string;
  readonly itemId: string;
  readonly locationId: string;
  readonly storageAreaId: string;
  readonly lotId: string | null;
  /** numeric(19,6) text. */
  readonly quantityOnHand: string;
  /** numeric(19,4) text. */
  readonly valueOnHand: string;
}

/**
 * Per-`(item, location, storage, lot)` movement sums at `occurred_at <= asOf`,
 * aggregated in SQL so the application never loads the whole ledger. The
 * average unit cost is deliberately **not** computed here: the application
 * derives it from the summed value/quantity via the domain helper, so the
 * valuation rule stays in one place.
 *
 * Both sums are cast back to the ledger's exact scale (`quantity_delta` is
 * numeric(19,6), `value_delta` numeric(19,4)) before `::text`, so the returned
 * strings carry the canonical scale rather than Postgres' typmod-free `sum`
 * result.
 */
export async function sumStockMovementsAsOf(
  db: Database,
  query: SumStockMovementsAsOfQuery,
): Promise<StockMovementSum[]> {
  return db
    .select({
      organizationId: stockMovement.organizationId,
      itemId: stockMovement.itemId,
      locationId: stockMovement.locationId,
      storageAreaId: stockMovement.storageAreaId,
      lotId: stockMovement.lotId,
      quantityOnHand: sql<string>`cast(sum(${stockMovement.quantityDelta}) as numeric(19, 6))::text`,
      valueOnHand: sql<string>`cast(coalesce(sum(${stockMovement.valueDelta}), 0) as numeric(19, 4))::text`,
    })
    .from(stockMovement)
    .where(
      and(
        eq(stockMovement.organizationId, query.organizationId),
        query.itemId === undefined ? undefined : eq(stockMovement.itemId, query.itemId),
        query.locationId === undefined ? undefined : eq(stockMovement.locationId, query.locationId),
        lte(stockMovement.occurredAt, query.asOf),
      ),
    )
    .groupBy(
      stockMovement.organizationId,
      stockMovement.itemId,
      stockMovement.locationId,
      stockMovement.storageAreaId,
      stockMovement.lotId,
    );
}

export async function findStockLot(db: Database, id: string): Promise<StockLot | undefined> {
  const rows = await db.select().from(stockLot).where(eq(stockLot.id, id)).limit(1);
  return rows[0];
}

/**
 * Create-or-find a lot by its natural key `(organization_id, item_id,
 * location_id, lot_number)`, safe against the create/find race: `INSERT … ON
 * CONFLICT DO NOTHING` then `SELECT` the surviving row. When `lotNumber` is null
 * the unique index does not apply (Postgres treats NULLs as distinct), so the
 * insert always succeeds and its `RETURNING` row is deterministic; the follow-up
 * select then never runs. `stock_balance` deliberately uses `NULLS NOT
 * DISTINCT`, but `stock_lot`'s key does not, so a null number is not addressable
 * by the natural key.
 */
export async function findOrCreateStockLot(db: Database, input: NewStockLot): Promise<StockLot> {
  const inserted = await db.insert(stockLot).values(input).onConflictDoNothing().returning();
  const created = inserted[0];
  if (created !== undefined) {
    return created;
  }

  const rows = await db
    .select()
    .from(stockLot)
    .where(
      and(
        eq(stockLot.organizationId, input.organizationId),
        eq(stockLot.itemId, input.itemId),
        eq(stockLot.locationId, input.locationId),
        input.lotNumber === null || input.lotNumber === undefined
          ? isNull(stockLot.lotNumber)
          : eq(stockLot.lotNumber, input.lotNumber),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    throw new Error(
      "stock_lot row missing after findOrCreateStockLot: the conflicting unique index " +
        "and the lookup key disagree",
    );
  }
  return row;
}

export async function createStorageArea(db: Database, input: NewStorageArea): Promise<StorageArea> {
  const rows = await db.insert(storageArea).values(input).returning();
  return rows[0]!;
}

export async function findStorageArea(db: Database, id: string): Promise<StorageArea | undefined> {
  const rows = await db.select().from(storageArea).where(eq(storageArea.id, id)).limit(1);
  return rows[0];
}

export interface FindStorageAreaByCodeQuery {
  readonly organizationId: string;
  readonly locationId: string;
  readonly code: string;
}

export async function findStorageAreaByCode(
  db: Database,
  query: FindStorageAreaByCodeQuery,
): Promise<StorageArea | undefined> {
  const rows = await db
    .select()
    .from(storageArea)
    .where(
      and(
        eq(storageArea.organizationId, query.organizationId),
        eq(storageArea.locationId, query.locationId),
        eq(storageArea.code, query.code),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function findLocationById(db: Database, id: string): Promise<Location | undefined> {
  const rows = await db.select().from(location).where(eq(location.id, id)).limit(1);
  return rows[0];
}

export async function findOrganizationById(
  db: Database,
  id: string,
): Promise<Organization | undefined> {
  const rows = await db.select().from(organization).where(eq(organization.id, id)).limit(1);
  return rows[0];
}
