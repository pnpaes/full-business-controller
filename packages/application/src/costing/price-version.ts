import type { PriceScenarioStore, PriceVersionRecord } from "./price-scenario-types";

/**
 * Read services for the effective price versions produced by
 * `approvePriceScenario` (PRICE-002/003; `DEC-064`, `DEC-077`). Pure
 * orchestration over `PriceScenarioStore`, mirroring `read.ts`: each method
 * filters the served organization at the application boundary (defence in depth
 * on top of the store's organization-scoped queries) and returns stored facts,
 * never recomputed maths.
 */

export interface ListPriceVersionsInput {
  readonly organizationId: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface ListPriceVersionsResult {
  readonly versions: readonly PriceVersionRecord[];
}

export interface GetPriceVersionInput {
  readonly organizationId: string;
  readonly priceVersionId: string;
}

/** The organization's price versions, newest `effectiveFrom` first, paged. */
export async function listPriceVersions(
  store: PriceScenarioStore,
  query: ListPriceVersionsInput,
): Promise<ListPriceVersionsResult> {
  const versions = await store.listPriceVersions(query);
  return {
    versions: versions.filter((version) => version.organizationId === query.organizationId),
  };
}

/** One price version by id; a cross-organization or unknown id reads as `undefined`. */
export async function getPriceVersion(
  store: PriceScenarioStore,
  query: GetPriceVersionInput,
): Promise<PriceVersionRecord | undefined> {
  const version = await store.findPriceVersion(query);
  return version !== undefined && version.organizationId === query.organizationId
    ? version
    : undefined;
}
