import { and, desc, eq } from "drizzle-orm";

import type { Database } from "../client";
import { stockMovement, stockTransfer } from "../schema";
import type { StockMovement } from "./inventory";

export type StockTransfer = typeof stockTransfer.$inferSelect;
export type NewStockTransfer = typeof stockTransfer.$inferInsert;

export async function createStockTransfer(
  db: Database,
  input: NewStockTransfer,
): Promise<StockTransfer> {
  const rows = await db.insert(stockTransfer).values(input).returning();
  return rows[0]!;
}

export interface FindStockTransferQuery {
  readonly organizationId: string;
  readonly transferId: string;
}

/** One transfer by id, organization-scoped (`DEC-061`), or `undefined`. */
export async function findStockTransfer(
  db: Database,
  query: FindStockTransferQuery,
): Promise<StockTransfer | undefined> {
  const rows = await db
    .select()
    .from(stockTransfer)
    .where(
      and(
        eq(stockTransfer.id, query.transferId),
        eq(stockTransfer.organizationId, query.organizationId),
      ),
    )
    .limit(1);
  return rows[0];
}

export interface ListStockTransfersQuery {
  readonly organizationId: string;
  readonly status?: string;
  readonly fromLocationId?: string;
  readonly toLocationId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Transfers for one organization, newest first (`created_at`, then `id`), with
 * optional status/from/to-location filters. Every filter is optional except the
 * organization, so the caller never sees another tenant's rows.
 */
export async function listStockTransfers(
  db: Database,
  query: ListStockTransfersQuery,
): Promise<StockTransfer[]> {
  const statement = db
    .select()
    .from(stockTransfer)
    .where(
      and(
        eq(stockTransfer.organizationId, query.organizationId),
        query.status === undefined ? undefined : eq(stockTransfer.status, query.status),
        query.fromLocationId === undefined
          ? undefined
          : eq(stockTransfer.fromLocationId, query.fromLocationId),
        query.toLocationId === undefined
          ? undefined
          : eq(stockTransfer.toLocationId, query.toLocationId),
      ),
    )
    .orderBy(desc(stockTransfer.createdAt), desc(stockTransfer.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}

export interface ListTransferMovementsQuery {
  readonly organizationId: string;
  readonly transferId: string;
}

/**
 * The two ledger legs of a transfer, paired by `stock_movement.transfer_id`
 * (`DEC-029`), organization-scoped. `transfer_id` (not `source_id`) is the
 * pairing column, so a consolidation can eliminate the in-transit leg; the row
 * order is ledger order (`occurred_at`, then `posted_at`, then `id`).
 */
export async function listStockMovementsByTransferId(
  db: Database,
  query: ListTransferMovementsQuery,
): Promise<StockMovement[]> {
  return db
    .select()
    .from(stockMovement)
    .where(
      and(
        eq(stockMovement.transferId, query.transferId),
        eq(stockMovement.organizationId, query.organizationId),
      ),
    )
    .orderBy(stockMovement.occurredAt, stockMovement.postedAt, stockMovement.id);
}
