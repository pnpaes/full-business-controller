import type { CalculationSnapshotRecord, CostCardRecord } from "./cost-card-types";
import type { PriceScenarioRecord } from "./price-scenario-types";
import type {
  AllocationRuleReadRecord,
  CostCardDetailRecord,
  CostCardHistoryEntry,
  CostingReadStore,
} from "./read-types";
import type { CostPoolRecord, LaborRateRecord, OperatingCostRecord } from "./types";

/**
 * Read services for the Costs area (08_UI_UX.md §8.3). Pure orchestration over
 * `CostingReadStore`: every method filters the served organization at the
 * application boundary (defence in depth on top of the store's org-scoped
 * queries) and returns stored derived values, never recomputed maths.
 *
 * The list/detail projections are deliberately flat. A caller that needs
 * display names resolves them through the store's `find*` reference lookups.
 */

/** How many prior calculations the cost-card detail carries for comparison. */
export const COST_CARD_HISTORY_LIMIT = 6;

function orgScoped<T extends { readonly organizationId: string }>(
  record: T | undefined,
  organizationId: string,
): T | undefined {
  return record !== undefined && record.organizationId === organizationId ? record : undefined;
}

export async function listCostCards(
  store: CostingReadStore,
  query: { readonly organizationId: string },
): Promise<readonly CostCardRecord[]> {
  const cards = await store.listCostCards(query);
  return cards.filter((card) => card.organizationId === query.organizationId);
}

export async function listPriceScenarios(
  store: CostingReadStore,
  query: { readonly organizationId: string },
): Promise<readonly PriceScenarioRecord[]> {
  const scenarios = await store.listPriceScenarios(query);
  return scenarios.filter((scenario) => scenario.organizationId === query.organizationId);
}

export async function listOperatingCosts(
  store: CostingReadStore,
  query: { readonly organizationId: string },
): Promise<readonly OperatingCostRecord[]> {
  const costs = await store.listOperatingCosts(query);
  return costs.filter((cost) => cost.organizationId === query.organizationId);
}

export async function listLaborRates(
  store: CostingReadStore,
  query: { readonly organizationId: string },
): Promise<readonly LaborRateRecord[]> {
  const rates = await store.listLaborRates(query);
  return rates.filter((rate) => rate.organizationId === query.organizationId);
}

export async function listCostPools(
  store: CostingReadStore,
  query: { readonly organizationId: string },
): Promise<readonly CostPoolRecord[]> {
  const pools = await store.listCostPools(query);
  return pools.filter((pool) => pool.organizationId === query.organizationId);
}

export async function listAllocationRules(
  store: CostingReadStore,
  query: { readonly organizationId: string },
): Promise<readonly AllocationRuleReadRecord[]> {
  // `allocation_rule` has no own organization column; the store scopes it
  // through `cost_pool`, so nothing further to filter here.
  return store.listAllocationRules(query);
}

/**
 * The cost card plus its frozen snapshot, the stored intermediates (source
 * drill-down) and the prior calculations in the same scope (historical
 * comparison). A cross-organization or unknown id reads as `undefined`.
 */
export async function getCostCardDetail(
  store: CostingReadStore,
  query: { readonly organizationId: string; readonly costCardId: string },
): Promise<CostCardDetailRecord | undefined> {
  const card = orgScoped(await store.findCostCard(query.costCardId), query.organizationId);
  if (card === undefined) {
    return undefined;
  }

  const snapshot = await loadSnapshot(store, card.snapshotId);
  const components = snapshot === null ? [] : await store.listSnapshotComponents(snapshot.id);

  const scopeCards = await store.listCostCardsForScope({
    organizationId: card.organizationId,
    productVariantId: card.productVariantId,
    locationId: card.locationId,
    channelId: card.channelId,
  });
  const history = await loadHistory(
    store,
    scopeCards.filter((candidate) => candidate.id !== card.id),
  );

  return { card, snapshot, components, history };
}

export async function getPriceScenarioDetail(
  store: CostingReadStore,
  query: { readonly organizationId: string; readonly priceScenarioId: string },
): Promise<PriceScenarioRecord | undefined> {
  return orgScoped(await store.findPriceScenario(query.priceScenarioId), query.organizationId);
}

async function loadSnapshot(
  store: CostingReadStore,
  snapshotId: string | null,
): Promise<CalculationSnapshotRecord | null> {
  if (snapshotId === null) {
    return null;
  }
  return (await store.findCalculationSnapshot(snapshotId)) ?? null;
}

async function loadHistory(
  store: CostingReadStore,
  cards: readonly CostCardRecord[],
): Promise<readonly CostCardHistoryEntry[]> {
  const limited = cards.slice(0, COST_CARD_HISTORY_LIMIT);
  return Promise.all(
    limited.map(async (card) => {
      const snapshot = await loadSnapshot(store, card.snapshotId);
      return {
        card,
        totals: snapshot === null ? null : snapshot.totals,
      } satisfies CostCardHistoryEntry;
    }),
  );
}
