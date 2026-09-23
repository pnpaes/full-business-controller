import { and, asc, desc, eq, gte, lt, ne, sql, type SQL } from "drizzle-orm";

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

/**
 * The line that reverses `salesLineId` (i.e. its `reversal_of_id`), organization
 * scoped (`DEC-061`), or `undefined`. Supports the `DEC-028`/`DEC-073` reversal
 * flow: an application command checks this before reversing so a line already
 * reversed is rejected rather than double-reversed. That pre-check is the
 * friendly guard; the `sales_line_reversal_of_id_key` partial unique index
 * (migration `0026`, `WHERE "reversal_of_id" IS NOT NULL`) is the DB-level
 * backstop enforcing at most one reversal per line, so at most one row is
 * returned.
 */
export async function findSalesLineReversal(
  db: Database,
  query: FindSalesLineQuery,
): Promise<SalesLine | undefined> {
  const rows = await db
    .select()
    .from(salesLine)
    .where(
      and(
        eq(salesLine.reversalOfId, query.salesLineId),
        eq(salesLine.organizationId, query.organizationId),
      ),
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

export interface SumSalesLineGrossForChannelPeriodQuery {
  readonly organizationId: string;
  /** The **transaction's** channel; `null` sums every channel. */
  readonly channelId: string | null;
  /** `date` (`yyyy-mm-dd`), inclusive (UTC day). */
  readonly periodStart: string;
  /** `date` (`yyyy-mm-dd`), inclusive (UTC day). */
  readonly periodEnd: string;
  readonly currency: string;
}

/**
 * The gross line total for a **(channel, inclusive UTC-day window)** (`DEC-118`):
 * `sum(sales_line.gross_amount)` over the lines of the organization's
 * transactions, org-scoped on both sides (`DEC-061`), excluding
 * `option_kind = 'included'` (the same `SALE-011` predicate as `summarizeSales`
 * and `sumSalesVolume`), with the transaction's currency equal and, when
 * `channelId` is not `null`, the **transaction's** channel equal to it.
 *
 * **Reversals net here.** `DEC-073` posts a reversal as a negated line in the
 * same transaction, so a plain gross sum nets it without a special case; the
 * reversal is attributed by its parent transaction's channel and `occurred_at`
 * (there is no reporting `coalesce(line.channel_id, transaction.channel_id)`
 * fallback). This is the reconciliation `actual` (`sumSalesForChannelPeriod`),
 * deliberately on the **gross** basis, not `netSalesExpression`.
 *
 * **Inclusive UTC-day window on a `timestamptz`.** The stored `period_start`/
 * `period_end` are `date`s and the adapter compared the transaction's UTC day
 * (`toISOString().slice(0, 10)`) lexically `>= periodStart` and `<= periodEnd`.
 * On the `timestamptz` column that is the half-open instant range
 * `[periodStart 00:00 UTC, periodEnd + 1 day 00:00 UTC)` — so both boundary days
 * are included and no instant shifts across a non-UTC offset or DST.
 *
 * Returns a money string at `numeric(19,4)` scale, `"0.0000"` when nothing
 * matches. One un-grouped query (no per-transaction loop).
 */
export async function sumSalesLineGrossForChannelPeriod(
  db: Database,
  query: SumSalesLineGrossForChannelPeriodQuery,
): Promise<string> {
  const conditions: SQL[] = [
    eq(salesLine.organizationId, query.organizationId),
    eq(salesTransaction.organizationId, query.organizationId),
    ne(salesLine.optionKind, "included"),
    eq(salesTransaction.currency, query.currency),
    gte(
      salesTransaction.occurredAt,
      sql`(${query.periodStart}::date)::timestamp at time zone 'UTC'`,
    ),
    lt(
      salesTransaction.occurredAt,
      sql`((${query.periodEnd}::date) + 1)::timestamp at time zone 'UTC'`,
    ),
  ];
  if (query.channelId !== null) {
    conditions.push(eq(salesTransaction.channelId, query.channelId));
  }

  const rows = await db
    .select({
      total: sql<string>`cast(coalesce(sum(coalesce(${salesLine.grossAmount}, 0)), 0) as numeric(19, 4))::text`,
    })
    .from(salesLine)
    .innerJoin(salesTransaction, eq(salesLine.salesTransactionId, salesTransaction.id))
    .where(and(...conditions));

  return rows[0]?.total ?? "0.0000";
}
