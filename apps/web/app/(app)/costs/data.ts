import {
  createPostgresCostingReadStore,
  createPostgresPriceScenarioStore,
  getCostCardDetail,
  getPriceScenarioDetail,
  getPriceVersion,
  listAllocationRules,
  listCostCards,
  listCostCenters,
  listChannels,
  listCostPools,
  listLaborRates,
  listOperatingCosts,
  listPriceScenarios,
  listPriceVersions,
  MAX_CHANNEL_LIMIT,
  MAX_COST_CENTER_LIMIT,
  type CostCenterRecord,
} from "@aquarela/application";
import {
  costCardRefRequest,
  loadCostingRefs,
  priceScenarioRefRequest,
  priceVersionRefRequest,
  toAllocationRuleRows,
  toChannelRows,
  toCostCardDetailView,
  toCostCardRows,
  toCostPoolRows,
  toLaborRateRows,
  toOperatingCostRows,
  toPriceScenarioRow,
  toPriceScenarioRows,
  toPriceVersionRow,
  toPriceVersionRows,
  type AllocationRuleRow,
  type ChannelRow,
  type CostCardDetailView,
  type CostCardRow,
  type CostPoolRow,
  type LaborRateRow,
  type OperatingCostRow,
  type PriceScenarioRow,
  type PriceVersionRow,
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

export async function loadPriceVersions(
  context: CostingReadContext,
  query: { readonly limit?: number; readonly offset?: number } = {},
): Promise<readonly PriceVersionRow[]> {
  const { organizationId, store } = context;
  const scenarioStore = createPostgresPriceScenarioStore(getDb().db);
  const { versions } = await listPriceVersions(scenarioStore, { organizationId, ...query });
  const refs = await loadCostingRefs(store, priceVersionRefRequest(versions));
  return toPriceVersionRows(organizationId, versions, refs);
}

export async function loadPriceVersion(
  context: CostingReadContext,
  priceVersionId: string,
): Promise<PriceVersionRow | undefined> {
  const { organizationId, store } = context;
  const scenarioStore = createPostgresPriceScenarioStore(getDb().db);
  const version = await getPriceVersion(scenarioStore, { organizationId, priceVersionId });
  if (version === undefined) {
    return undefined;
  }
  const refs = await loadCostingRefs(store, {
    productVariantIds: [version.productVariantId],
    locationIds: version.locationId === null ? [] : [version.locationId],
    channelIds: version.channelId === null ? [] : [version.channelId],
  });
  return toPriceVersionRow(organizationId, version, refs);
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

/**
 * The organization's real cost centres (`DATA_DICTIONARY` §1), ordered by code.
 * Bounded at the read's hard cap: the register forms use this as a picker, and a
 * truncated page would silently hide a valid centre, so ask for the maximum the
 * read allows rather than the default page.
 */
export async function loadCostCenters(
  context: CostingReadContext,
): Promise<readonly CostCenterRecord[]> {
  const { organizationId, store } = context;
  return listCostCenters(store, { organizationId, limit: MAX_COST_CENTER_LIMIT });
}

/**
 * The organization's real sales channels (`DATA_DICTIONARY` §1), ordered by
 * code, as the scenario channel picker shows them. Bounded at the read's hard
 * cap for the same reason as `loadCostCenters`: a truncated picker would
 * silently hide a valid channel.
 */
export async function loadChannels(context: CostingReadContext): Promise<readonly ChannelRow[]> {
  const { organizationId, store } = context;
  const channels = await listChannels(store, { organizationId, limit: MAX_CHANNEL_LIMIT });
  return toChannelRows(organizationId, channels);
}
