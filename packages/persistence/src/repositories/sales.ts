import { and, asc, desc, eq } from "drizzle-orm";

import type { Database } from "../client";
import { salesLine, salesTransaction } from "../schema";

export type SalesTransaction = typeof salesTransaction.$inferSelect;
export type NewSalesTransaction = typeof salesTransaction.$inferInsert;
export type SalesLine = typeof salesLine.$inferSelect;
export type NewSalesLine = typeof salesLine.$inferInsert;

/*
 * Slice-12 sales reads/writes (`SALE-003`, `SALE-005`, `SALE-009`; `DEC-042`,
 * `DEC-043`).
 *
 * `sales_transaction` and `sales_line` both carry `organization_id` directly, so
 * every read is organization-scoped (`DEC-061`). This module stores facts only:
 * it does not post a stock movement, does not resolve an external mapping and
 * does not implement the `DEC-028` sales-line reversal semantics (open point
 * (g) in `schema/sales.ts`). The posting pipeline that maps staging rows to
 * these tables is a later application slice.
 */

export async function createSalesTransaction(
  db: Database,
  input: NewSalesTransaction,
): Promise<SalesTransaction> {
  const rows = await db.insert(salesTransaction).values(input).returning();
  return rows[0]!;
}

export interface FindSalesTransactionQuery {
  readonly organizationId: string;
  readonly salesTransactionId: string;
}

/** One transaction by id, organization-scoped (`DEC-061`), or `undefined`. */
export async function findSalesTransaction(
  db: Database,
  query: FindSalesTransactionQuery,
): Promise<SalesTransaction | undefined> {
  const rows = await db
    .select()
    .from(salesTransaction)
    .where(
      and(
        eq(salesTransaction.id, query.salesTransactionId),
        eq(salesTransaction.organizationId, query.organizationId),
      ),
    )
    .limit(1);
  return rows[0];
}

export interface ListSalesTransactionsQuery {
  readonly organizationId: string;
  readonly sourceSystem?: string;
  readonly locationId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Transactions for one organization, newest occurred first (`occurred_at`, then
 * `id`), with optional source/location filters. Every filter is optional except
 * the organization, so the caller never sees another tenant's rows. Paging is
 * applied after the ordering.
 */
export async function listSalesTransactions(
  db: Database,
  query: ListSalesTransactionsQuery,
): Promise<SalesTransaction[]> {
  const statement = db
    .select()
    .from(salesTransaction)
    .where(
      and(
        eq(salesTransaction.organizationId, query.organizationId),
        query.sourceSystem === undefined
          ? undefined
          : eq(salesTransaction.sourceSystem, query.sourceSystem),
        query.locationId === undefined
          ? undefined
          : eq(salesTransaction.locationId, query.locationId),
      ),
    )
    .orderBy(desc(salesTransaction.occurredAt), desc(salesTransaction.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}

export async function createSalesLine(db: Database, input: NewSalesLine): Promise<SalesLine> {
  const rows = await db.insert(salesLine).values(input).returning();
  return rows[0]!;
}

export interface FindSalesLineQuery {
  readonly organizationId: string;
  readonly salesLineId: string;
}

/** One sales line by id, organization-scoped (`DEC-061`), or `undefined`. */
export async function findSalesLine(
  db: Database,
  query: FindSalesLineQuery,
): Promise<SalesLine | undefined> {
  const rows = await db
    .select()
    .from(salesLine)
    .where(
      and(eq(salesLine.id, query.salesLineId), eq(salesLine.organizationId, query.organizationId)),
    )
    .limit(1);
  return rows[0];
}

export interface ListSalesLinesQuery {
  readonly organizationId: string;
  readonly salesTransactionId: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Lines of one transaction, in external line order (`external_line_id`, nulls
 * last, then `id`), organization-scoped. There is no sequence column in any
 * authority, so `external_line_id` is the only stable source order. Paging is
 * applied after the ordering.
 */
export async function listSalesLines(
  db: Database,
  query: ListSalesLinesQuery,
): Promise<SalesLine[]> {
  const statement = db
    .select()
    .from(salesLine)
    .where(
      and(
        eq(salesLine.salesTransactionId, query.salesTransactionId),
        eq(salesLine.organizationId, query.organizationId),
      ),
    )
    .orderBy(asc(salesLine.externalLineId), asc(salesLine.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}
