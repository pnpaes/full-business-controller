import { DomainError } from "@aquarela/domain";

import type { ReconciliationRecord, ReconciliationStore } from "./types";

/** Page size when the caller does not ask for one. */
export const DEFAULT_RECONCILIATION_LIMIT = 50;
/** Hard ceiling so a caller cannot ask the log for an unbounded page. */
export const MAX_RECONCILIATION_LIMIT = 200;

export interface ListReconciliationsInput {
  readonly organizationId: string;
  readonly status?: string;
  readonly scopeType?: string;
  readonly scopeId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface ReconciliationPage {
  readonly reconciliations: readonly ReconciliationRecord[];
  readonly limit: number;
  readonly offset: number;
  readonly hasMore: boolean;
}

/**
 * Reconciliation rows for one organization (`REC-005`), newest period first,
 * with optional status/scope filters. The read is bounded and `hasMore` is
 * derived by fetching one row past the page.
 */
export async function listReconciliations(
  store: ReconciliationStore,
  input: ListReconciliationsInput,
): Promise<ReconciliationPage> {
  const limit = input.limit ?? DEFAULT_RECONCILIATION_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RECONCILIATION_LIMIT) {
    throw new DomainError(`limit must be an integer between 1 and ${MAX_RECONCILIATION_LIMIT}`);
  }
  const offset = input.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0) {
    throw new DomainError("offset must be a non-negative integer");
  }

  const rows = await store.listReconciliations({
    organizationId: input.organizationId,
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.scopeType === undefined ? {} : { scopeType: input.scopeType }),
    ...(input.scopeId === undefined ? {} : { scopeId: input.scopeId }),
    limit: limit + 1,
    offset,
  });
  const hasMore = rows.length > limit;
  return {
    reconciliations: hasMore ? rows.slice(0, limit) : rows,
    limit,
    offset,
    hasMore,
  };
}
