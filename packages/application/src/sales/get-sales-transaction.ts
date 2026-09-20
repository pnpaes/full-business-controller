import { DomainError } from "@aquarela/domain";

import { isBlank } from "../imports/validation";

import type { SalesLineRecord, SalesStore, SalesTransactionRecord } from "./types";

export interface GetSalesTransactionInput {
  readonly organizationId: string;
  readonly salesTransactionId: string;
}

export interface SalesTransactionDetail {
  readonly transaction: SalesTransactionRecord;
  readonly lines: readonly SalesLineRecord[];
}

/**
 * One sales transaction with its lines, organization-scoped (`DEC-061`).
 * `undefined` when the transaction does not exist in the organization (the read
 * API maps that to 404).
 */
export async function getSalesTransaction(
  store: SalesStore,
  input: GetSalesTransactionInput,
): Promise<SalesTransactionDetail | undefined> {
  if (isBlank(input.salesTransactionId)) {
    throw new DomainError("salesTransactionId is required");
  }
  const transaction = await store.findSalesTransaction({
    organizationId: input.organizationId,
    salesTransactionId: input.salesTransactionId.trim(),
  });
  if (transaction === undefined) {
    return undefined;
  }
  const lines = await store.listSalesLines({
    organizationId: input.organizationId,
    salesTransactionId: transaction.id,
  });
  return { transaction, lines };
}
