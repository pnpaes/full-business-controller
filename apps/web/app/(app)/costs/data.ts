import {
  createPostgresCostingReadStore,
  getCostCardDetail,
  getPriceScenarioDetail,
  listAllocationRules,
  listCostCards,
  listCostPools,
  listLaborRates,
  listOperatingCosts,
  listPriceScenarios,
} from "@aquarela/application";
import {
  costCardRefRequest,
  loadCostingRefs,
  priceScenarioRefRequest,
  toAllocationRuleRows,
  toCostCardDetailView,
  toCostCardRows,
  toCostPoolRows,
  toLaborRateRows,
  toOperatingCostRows,
  toPriceScenarioRow,
  toPriceScenarioRows,
  type AllocationRuleRow,
  type CostCardDetailView,
  type CostCardRow,
  type CostPoolRow,
  type LaborRateRow,
  type OperatingCostRow,
  type PriceScenarioRow,
} from "../../api/v1/costing/costing-views";
import { getDb } from "../../../lib/db";
import { resolveOrganization } from "../../../lib/organization";

/**
 * Server-only data loading for the Costs screens. Each function calls the same
 * application read services and view mappers as `/api/v1/costing`, so the page
 * and the HTTP surface cannot drift; nothing here recomputes a derived figure.
 */

export interface CostingReadContext {
  readonly organizationId: string;
  readonly currency: string | null;
  readonly store: ReturnType<typeof createPostgresCostingReadStore>;
}

export async function getCostingReadContext(): Promise<CostingReadContext> {
  const organizationId = resolveOrganization();
  const store = createPostgresCostingReadStore(getDb().db);
  const organization = await store.findOrganization(organizationId);
  return { organizationId, currency: organization?.currency ?? null, store };
}

export async function loadCostCards(context: CostingReadContext): Promise<readonly CostCardRow[]> {
  const { organizationId, store } = context;
  const cards = await listCostCards(store, { organizationId });
  const refs = await loadCostingRefs(store, {
    productVariantIds: cards.map((card) => card.productVariantId),
    locationIds: cards.map((card) => card.locationId),
    channelIds: cards.flatMap((card) => (card.channelId === null ? [] : [card.channelId])),
  });
  return toCostCardRows(organizationId, cards, refs);
}

export async function loadCostCardDetail(
  context: CostingReadContext,
  costCardId: string,
): Promise<CostCardDetailView | undefined> {
  const { organizationId, store } = context;
  const detail = await getCostCardDetail(store, { organizationId, costCardId });
  if (detail === undefined) {
    return undefined;
  }
  const refs = await loadCostingRefs(store, costCardRefRequest(detail));
  return toCostCardDetailView(organizationId, detail, refs);
}

export async function loadPriceScenarios(
  context: CostingReadContext,
): Promise<readonly PriceScenarioRow[]> {
  const { organizationId, store } = context;
  const scenarios = await listPriceScenarios(store, { organizationId });
  const refs = await loadCostingRefs(store, priceScenarioRefRequest(scenarios));
  return toPriceScenarioRows(organizationId, scenarios, refs);
}

export async function loadPriceScenarioDetail(
  context: CostingReadContext,
  priceScenarioId: string,
): Promise<PriceScenarioRow | undefined> {
  const { organizationId, store } = context;
  const scenario = await getPriceScenarioDetail(store, { organizationId, priceScenarioId });
  if (scenario === undefined) {
    return undefined;
  }
  const refs = await loadCostingRefs(store, {
    productVariantIds: [scenario.productVariantId],
    locationIds: scenario.locationId === null ? [] : [scenario.locationId],
    channelIds: scenario.channelId === null ? [] : [scenario.channelId],
  });
  return toPriceScenarioRow(organizationId, scenario, refs);
}

export async function loadOperatingCosts(
  context: CostingReadContext,
): Promise<readonly OperatingCostRow[]> {
  const { organizationId, store } = context;
  const costs = await listOperatingCosts(store, { organizationId });
  const refs = await loadCostingRefs(store, {
    costCenterIds: costs.map((cost) => cost.costCenterId),
    locationIds: costs.flatMap((cost) => (cost.locationId === null ? [] : [cost.locationId])),
  });
  return toOperatingCostRows(organizationId, costs, refs);
}

export async function loadLaborRates(
  context: CostingReadContext,
): Promise<readonly LaborRateRow[]> {
  const { organizationId, store } = context;
  const rates = await listLaborRates(store, { organizationId });
  const refs = await loadCostingRefs(store, {
    costCenterIds: rates.map((rate) => rate.costCenterId),
  });
  return toLaborRateRows(organizationId, rates, refs);
}

export async function loadCostPools(context: CostingReadContext): Promise<readonly CostPoolRow[]> {
  const { organizationId, store } = context;
  return toCostPoolRows(organizationId, await listCostPools(store, { organizationId }));
}

export async function loadAllocationRules(
  context: CostingReadContext,
): Promise<readonly AllocationRuleRow[]> {
  const { organizationId, store } = context;
  return toAllocationRuleRows(await listAllocationRules(store, { organizationId }));
}
