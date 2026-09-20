import { DomainError } from "@aquarela/domain";

import type { SalesStore, SalesTransactionRecord } from "./types";

/** Page size when the caller does not ask for one. */
export const DEFAULT_SALES_LIMIT = 50;
/** Hard ceiling so a caller cannot ask the transaction log for an unbounded page. */
export const MAX_SALES_LIMIT = 200;

export interface ListSalesTransactionsInput {
  readonly organizationId: string;
  readonly sourceSystem?: string;
  readonly locationId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface SalesTransactionPage {
  readonly transactions: readonly SalesTransactionRecord[];
  readonly limit: number;
  readonly offset: number;
  readonly hasMore: boolean;
}

/**
 * Sales transactions for one organization (`SALE-003`), newest occurred first,
 * with optional source/location filters. The read is bounded: `limit` defaults
 * to `DEFAULT_SALES_LIMIT` and is capped, and `hasMore` is derived by fetching
 * one row past the page.
 */
export async function listSalesTransactions(
  store: SalesStore,
  input: ListSalesTransactionsInput,
): Promise<SalesTransactionPage> {
  const limit = input.limit ?? DEFAULT_SALES_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SALES_LIMIT) {
    throw new DomainError(`limit must be an integer between 1 and ${MAX_SALES_LIMIT}`);
  }
  const offset = input.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0) {
    throw new DomainError("offset must be a non-negative integer");
  }

  const rows = await store.listSalesTransactions({
    organizationId: input.organizationId,
    ...(input.sourceSystem === undefined ? {} : { sourceSystem: input.sourceSystem }),
    ...(input.locationId === undefined ? {} : { locationId: input.locationId }),
    limit: limit + 1,
    offset,
  });
  const hasMore = rows.length > limit;
  return {
    transactions: hasMore ? rows.slice(0, limit) : rows,
    limit,
    offset,
    hasMore,
  };
}
