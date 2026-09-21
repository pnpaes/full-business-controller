import { MONEY_SCALE, formatDecimal, parseDecimal } from "@aquarela/domain";
import type {
  AllocationRuleReadRecord,
  CalculationSnapshotRecord,
  CostCardDetailRecord,
  CostCardHistoryEntry,
  CostCardRecord,
  CostingItemRefRecord,
  CostingReadStore,
  CostingRefRecord,
  CostingUnitRefRecord,
  CostPoolRecord,
  LaborRateRecord,
  OperatingCostRecord,
  PriceScenarioRecord,
  PriceVersionRecord,
  SnapshotComponentRecord,
} from "@aquarela/application";

/**
 * Pure query parsing, reference loading and response mapping for the
 * `/api/v1/costing` read surface. Kept free of Next imports so the route
 * handlers and the Costs screens share one mapping (the pages call the same
 * functions the routes serialize), and so the mappers are unit-testable.
 *
 * Reads carry only real rows: a missing or cross-organization reference resolves
 * to `null` rather than an invented value (08_UI_UX.md §8.4).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: string): boolean => UUID.test(value);

/** The reference rows a costing response needs, resolved once per request. */
export interface CostingRefs {
  readonly productVariants: ReadonlyMap<string, CostingRefRecord>;
  readonly locations: ReadonlyMap<string, CostingRefRecord>;
  readonly channels: ReadonlyMap<string, CostingRefRecord>;
  readonly costCenters: ReadonlyMap<string, CostingRefRecord>;
  readonly items: ReadonlyMap<string, CostingItemRefRecord>;
  readonly units: ReadonlyMap<string, CostingUnitRefRecord>;
}

export interface CostingRefRequest {
  readonly productVariantIds?: readonly string[];
  readonly locationIds?: readonly string[];
  readonly channelIds?: readonly string[];
  readonly costCenterIds?: readonly string[];
  readonly itemIds?: readonly string[];
  readonly unitIds?: readonly string[];
}

function distinct(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => value != null))];
}

async function toMap<T extends { readonly id: string }>(
  records: readonly (T | undefined)[],
): Promise<ReadonlyMap<string, T>> {
  const map = new Map<string, T>();
  for (const record of records) {
    if (record !== undefined) {
      map.set(record.id, record);
    }
  }
  return map;
}

/** Resolves the display references for the given ids through the read port. */
export async function loadCostingRefs(
  store: CostingReadStore,
  request: CostingRefRequest,
): Promise<CostingRefs> {
  const [productVariants, locations, channels, costCenters, items, units] = await Promise.all([
    Promise.all(
      distinct(request.productVariantIds ?? []).map((id) => store.findProductVariant(id)),
    ),
    Promise.all(distinct(request.locationIds ?? []).map((id) => store.findLocation(id))),
    Promise.all(distinct(request.channelIds ?? []).map((id) => store.findChannel(id))),
    Promise.all(distinct(request.costCenterIds ?? []).map((id) => store.findCostCenter(id))),
    Promise.all(distinct(request.itemIds ?? []).map((id) => store.findItem(id))),
    Promise.all(distinct(request.unitIds ?? []).map((id) => store.findUnit(id))),
  ]);
  return {
    productVariants: await toMap(productVariants),
    locations: await toMap(locations),
    channels: await toMap(channels),
    costCenters: await toMap(costCenters),
    items: await toMap(items),
    units: await toMap(units),
  };
}

function owned(
  refs: CostingRefs,
  map: "units",
  id: string | null,
  organizationId: string,
): CostingUnitRefRecord | undefined;
function owned(
  refs: CostingRefs,
  map: "productVariants" | "locations" | "channels" | "costCenters" | "items",
  id: string | null,
  organizationId: string,
): CostingRefRecord | undefined;
function owned(
  refs: CostingRefs,
  map: keyof CostingRefs,
  id: string | null,
  organizationId: string,
): CostingRefRecord | CostingUnitRefRecord | undefined {
  if (id === null) {
    return undefined;
  }
  const record = refs[map].get(id);
  return record !== undefined && record.organizationId === organizationId ? record : undefined;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

/* --------------------------------- cards ----------------------------------- */

export interface CostCardRow {
  readonly id: string;
  readonly state: string;
  readonly productVariantId: string;
  readonly productVariantCode: string | null;
  readonly productVariantName: string | null;
  readonly locationId: string;
  readonly locationCode: string | null;
  readonly locationName: string | null;
  readonly channelId: string | null;
  readonly channelName: string | null;
  readonly costSelectionPolicy: string;
  readonly calculatedAt: string;
  readonly approvedAt: string | null;
  readonly snapshotId: string | null;
}

export function toCostCardRow(
  organizationId: string,
  card: CostCardRecord,
  refs: CostingRefs,
): CostCardRow {
  const variant = owned(refs, "productVariants", card.productVariantId, organizationId);
  const location = owned(refs, "locations", card.locationId, organizationId);
  const channel = owned(refs, "channels", card.channelId, organizationId);
  return {
    id: card.id,
    state: card.state,
    productVariantId: card.productVariantId,
    productVariantCode: variant?.code ?? null,
    productVariantName: variant?.name ?? null,
    locationId: card.locationId,
    locationCode: location?.code ?? null,
    locationName: location?.name ?? null,
    channelId: card.channelId,
    channelName: channel?.name ?? null,
    costSelectionPolicy: card.costSelectionPolicy,
    calculatedAt: card.calculatedAt,
    approvedAt: card.approvedAt,
    snapshotId: card.snapshotId,
  };
}

export function toCostCardRows(
  organizationId: string,
  cards: readonly CostCardRecord[],
  refs: CostingRefs,
): readonly CostCardRow[] {
  return cards
    .filter((card) => card.organizationId === organizationId)
    .map((card) => toCostCardRow(organizationId, card, refs));
}

export interface CostCardTotalsView {
  readonly currency: string | null;
  readonly unitVariableCost: string | null;
  readonly unitVariableCostBeforeLabor: string | null;
  readonly directLaborCost: string | null;
  readonly allocatedUnitOverhead: string | null;
  readonly unitFullCost: string | null;
  readonly contributionAfterDirectLabor: string | null;
  readonly contributionMarginPctAfterLabor: string | null;
  readonly fullCostMargin: string | null;
}

/** Sums 4 dp money strings through the domain decimal helpers; null when none. */
function sumMoney(values: readonly (string | null)[]): string | null {
  let total = 0n;
  let seen = false;
  for (const value of values) {
    if (value === null) {
      continue;
    }
    total += parseDecimal(value, MONEY_SCALE);
    seen = true;
  }
  return seen ? formatDecimal(total, MONEY_SCALE) : null;
}

function sumComponentAmounts(
  components: readonly SnapshotComponentRecord[],
  componentKind: string,
): string | null {
  return sumMoney(components.filter((c) => c.componentKind === componentKind).map((c) => c.amount));
}

function toTotalsView(
  totals: Record<string, unknown> | null,
  components: readonly SnapshotComponentRecord[],
): CostCardTotalsView | null {
  if (totals === null) {
    return null;
  }
  return {
    currency: readString(totals, "currency"),
    unitVariableCost: readString(totals, "unitVariableCost"),
    unitVariableCostBeforeLabor: readString(totals, "unitVariableCostBeforeLabor"),
    directLaborCost: sumComponentAmounts(components, "direct_labor"),
    allocatedUnitOverhead: sumComponentAmounts(components, "allocated_overhead"),
    unitFullCost: readString(totals, "unitFullCost"),
    contributionAfterDirectLabor: readString(totals, "contributionAfterDirectLabor"),
    contributionMarginPctAfterLabor: readString(totals, "contributionMarginPctAfterLabor"),
    fullCostMargin: readString(totals, "fullCostMargin"),
  };
}

export interface CostCardComponentRow {
  readonly id: string;
  readonly componentKind: string;
  readonly itemId: string | null;
  readonly itemCode: string | null;
  readonly itemName: string | null;
  readonly quantity: string | null;
  readonly unitId: string | null;
  readonly unitCode: string | null;
  readonly unitCost: string | null;
  readonly amount: string | null;
  readonly roundingBoundary: string | null;
  readonly provenance: Record<string, unknown>;
}

function toComponentRow(
  organizationId: string,
  component: SnapshotComponentRecord,
  refs: CostingRefs,
): CostCardComponentRow {
  const item = owned(refs, "items", component.itemId, organizationId);
  const unit = owned(refs, "units", component.unitId, organizationId);
  return {
    id: component.id,
    componentKind: component.componentKind,
    itemId: component.itemId,
    itemCode: item?.code ?? null,
    itemName: item?.name ?? null,
    quantity: component.quantity,
    unitId: component.unitId,
    unitCode: unit?.code ?? null,
    unitCost: component.unitCost,
    amount: component.amount,
    roundingBoundary: component.roundingBoundary,
    provenance: component.provenance,
  };
}

export interface CostCardHistoryRow {
  readonly id: string;
  readonly state: string;
  readonly calculatedAt: string;
  readonly approvedAt: string | null;
  readonly totals: CostCardTotalsView | null;
}

function toHistoryRow(entry: CostCardHistoryEntry): CostCardHistoryRow {
  return {
    id: entry.card.id,
    state: entry.card.state,
    calculatedAt: entry.card.calculatedAt,
    approvedAt: entry.card.approvedAt,
    totals: toTotalsView(entry.totals, []),
  };
}

export interface CostCardDetailView {
  readonly card: CostCardRow;
  readonly snapshot: {
    readonly id: string;
    readonly asOf: string;
    readonly ruleVersion: string;
    readonly costSelectionPolicy: string;
    readonly roundingMethod: string;
    readonly createdAt: string;
  } | null;
  readonly totals: CostCardTotalsView | null;
  readonly components: readonly CostCardComponentRow[];
  readonly history: readonly CostCardHistoryRow[];
}

/** Builds the cost-card detail view; org-filtering happens in the read service. */
export function toCostCardDetailView(
  organizationId: string,
  detail: CostCardDetailRecord,
  refs: CostingRefs,
): CostCardDetailView {
  const snapshot: CalculationSnapshotRecord | null = detail.snapshot;
  return {
    card: toCostCardRow(organizationId, detail.card, refs),
    snapshot:
      snapshot === null
        ? null
        : {
            id: snapshot.id,
            asOf: snapshot.asOf,
            ruleVersion: snapshot.ruleVersion,
            costSelectionPolicy: snapshot.costSelectionPolicy,
            roundingMethod: snapshot.roundingMethod,
            createdAt: snapshot.createdAt,
          },
    totals: toTotalsView(snapshot === null ? null : snapshot.totals, detail.components),
    components: detail.components.map((component) =>
      toComponentRow(organizationId, component, refs),
    ),
    history: detail.history.map(toHistoryRow),
  };
}

/** The reference ids a cost-card detail needs for display. */
export function costCardRefRequest(detail: CostCardDetailRecord): CostingRefRequest {
  return {
    productVariantIds: [detail.card.productVariantId],
    locationIds: [detail.card.locationId],
    channelIds: detail.card.channelId === null ? [] : [detail.card.channelId],
    itemIds: detail.components.flatMap((component) =>
      component.itemId === null ? [] : [component.itemId],
    ),
    unitIds: detail.components.flatMap((component) =>
      component.unitId === null ? [] : [component.unitId],
    ),
  };
}

/* ------------------------------ price scenarios ---------------------------- */

export interface PriceScenarioRow {
  readonly id: string;
  readonly state: string;
  readonly productVariantId: string;
  readonly productVariantCode: string | null;
  readonly productVariantName: string | null;
  readonly locationId: string | null;
  readonly locationName: string | null;
  readonly channelId: string | null;
  readonly channelName: string | null;
  readonly grossPrice: string | null;
  readonly netPrice: string | null;
  readonly presentedGrossPrice: string | null;
  readonly presentedNetPrice: string | null;
  readonly includedTax: string | null;
  readonly unitVariableCost: string | null;
  readonly channelVariableCost: string | null;
  readonly unitContribution: string | null;
  readonly contributionMarginPct: string | null;
  readonly requiredGrossPrice: string | null;
  readonly breakEvenUnits: string | null;
  readonly volumeAssumption: string | null;
  readonly targetContributionPct: string | null;
  readonly feeBreakdown: Record<string, unknown>;
  readonly createdAt: string;
}

export function toPriceScenarioRow(
  organizationId: string,
  scenario: PriceScenarioRecord,
  refs: CostingRefs,
): PriceScenarioRow {
  const variant = owned(refs, "productVariants", scenario.productVariantId, organizationId);
  const location = owned(refs, "locations", scenario.locationId, organizationId);
  const channel = owned(refs, "channels", scenario.channelId, organizationId);
  return {
    id: scenario.id,
    state: scenario.state,
    productVariantId: scenario.productVariantId,
    productVariantCode: variant?.code ?? null,
    productVariantName: variant?.name ?? null,
    locationId: scenario.locationId,
    locationName: location?.name ?? null,
    channelId: scenario.channelId,
    channelName: channel?.name ?? null,
    grossPrice: scenario.grossPrice,
    netPrice: scenario.netPrice,
    presentedGrossPrice: readString(scenario.outcome, "presentedGrossPrice"),
    presentedNetPrice: readString(scenario.outcome, "presentedNetPrice"),
    includedTax: readString(scenario.outcome, "includedTax"),
    unitVariableCost: readString(scenario.outcome, "unitVariableCost"),
    channelVariableCost: readString(scenario.outcome, "channelVariableCost"),
    unitContribution: readString(scenario.outcome, "unitContribution"),
    contributionMarginPct: readString(scenario.outcome, "contributionMarginPct"),
    requiredGrossPrice: readString(scenario.outcome, "requiredGrossPrice"),
    breakEvenUnits: readString(scenario.outcome, "breakEvenUnits"),
    volumeAssumption: scenario.volumeAssumption,
    targetContributionPct: scenario.targetContributionPct,
    feeBreakdown: scenario.feeBreakdown,
    createdAt: scenario.createdAt,
  };
}

export function toPriceScenarioRows(
  organizationId: string,
  scenarios: readonly PriceScenarioRecord[],
  refs: CostingRefs,
): readonly PriceScenarioRow[] {
  return scenarios
    .filter((scenario) => scenario.organizationId === organizationId)
    .map((scenario) => toPriceScenarioRow(organizationId, scenario, refs));
}

export function priceScenarioRefRequest(
  scenarios: readonly PriceScenarioRecord[],
): CostingRefRequest {
  return {
    productVariantIds: scenarios.map((scenario) => scenario.productVariantId),
    locationIds: scenarios.flatMap((scenario) =>
      scenario.locationId === null ? [] : [scenario.locationId],
    ),
    channelIds: scenarios.flatMap((scenario) =>
      scenario.channelId === null ? [] : [scenario.channelId],
    ),
  };
}

/* ------------------------------ price versions ----------------------------- */

export interface PriceVersionRow {
  readonly id: string;
  readonly productVariantId: string;
  readonly productVariantCode: string | null;
  readonly productVariantName: string | null;
  readonly locationId: string | null;
  readonly locationName: string | null;
  readonly channelId: string | null;
  readonly channelName: string | null;
  readonly grossPrice: string;
  readonly netPrice: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly sourceScenarioId: string;
}

/**
 * One effective price version (`price_version`; PRICE-002/003) as the screens and
 * `/api/v1/costing` serialize it. A null `locationId`/`channelId` is the single
 * "any location"/"any channel" scope, not a missing value; the reference lookups
 * resolve only same-organization rows, so a foreign name never leaks
 * (08_UI_UX.md §8.4).
 */
export function toPriceVersionRow(
  organizationId: string,
  version: PriceVersionRecord,
  refs: CostingRefs,
): PriceVersionRow {
  const variant = owned(refs, "productVariants", version.productVariantId, organizationId);
  const location = owned(refs, "locations", version.locationId, organizationId);
  const channel = owned(refs, "channels", version.channelId, organizationId);
  return {
    id: version.id,
    productVariantId: version.productVariantId,
    productVariantCode: variant?.code ?? null,
    productVariantName: variant?.name ?? null,
    locationId: version.locationId,
    locationName: location?.name ?? null,
    channelId: version.channelId,
    channelName: channel?.name ?? null,
    grossPrice: version.grossPrice,
    netPrice: version.netPrice,
    effectiveFrom: version.effectiveFrom,
    effectiveTo: version.effectiveTo,
    approvedBy: version.approvedBy,
    approvedAt: version.approvedAt,
    sourceScenarioId: version.sourceScenarioId,
  };
}

export function toPriceVersionRows(
  organizationId: string,
  versions: readonly PriceVersionRecord[],
  refs: CostingRefs,
): readonly PriceVersionRow[] {
  return versions
    .filter((version) => version.organizationId === organizationId)
    .map((version) => toPriceVersionRow(organizationId, version, refs));
}

export function priceVersionRefRequest(versions: readonly PriceVersionRecord[]): CostingRefRequest {
  return {
    productVariantIds: versions.map((version) => version.productVariantId),
    locationIds: versions.flatMap((version) =>
      version.locationId === null ? [] : [version.locationId],
    ),
    channelIds: versions.flatMap((version) =>
      version.channelId === null ? [] : [version.channelId],
    ),
  };
}

/* ------------------------- slice-6 costing facts ---------------------------- */

export interface OperatingCostRow {
  readonly id: string;
  readonly costCenterId: string;
  readonly costCenterName: string | null;
  readonly locationId: string | null;
  readonly locationName: string | null;
  readonly amount: string;
  readonly currency: string;
  readonly recurrence: string;
  readonly behavior: string;
  readonly taxBasis: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly vendor: string | null;
}

export function toOperatingCostRows(
  organizationId: string,
  costs: readonly OperatingCostRecord[],
  refs: CostingRefs,
): readonly OperatingCostRow[] {
  return costs
    .filter((cost) => cost.organizationId === organizationId)
    .map((cost) => {
      const costCenter = owned(refs, "costCenters", cost.costCenterId, organizationId);
      const location = owned(refs, "locations", cost.locationId, organizationId);
      return {
        id: cost.id,
        costCenterId: cost.costCenterId,
        costCenterName: costCenter?.name ?? null,
        locationId: cost.locationId,
        locationName: location?.name ?? null,
        amount: cost.amount,
        currency: cost.currency,
        recurrence: cost.recurrence,
        behavior: cost.behavior,
        taxBasis: cost.taxBasis,
        effectiveFrom: cost.effectiveFrom,
        effectiveTo: cost.effectiveTo,
        vendor: cost.vendor,
      };
    });
}

export interface LaborRateRow {
  readonly id: string;
  readonly costCenterId: string;
  readonly costCenterName: string | null;
  readonly roleCode: string;
  readonly loadedHourlyRate: string;
  readonly productiveHoursPct: string | null;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}

export function toLaborRateRows(
  organizationId: string,
  rates: readonly LaborRateRecord[],
  refs: CostingRefs,
): readonly LaborRateRow[] {
  return rates
    .filter((rate) => rate.organizationId === organizationId)
    .map((rate) => {
      const costCenter = owned(refs, "costCenters", rate.costCenterId, organizationId);
      return {
        id: rate.id,
        costCenterId: rate.costCenterId,
        costCenterName: costCenter?.name ?? null,
        roleCode: rate.roleCode,
        loadedHourlyRate: rate.loadedHourlyRate,
        productiveHoursPct: rate.productiveHoursPct,
        effectiveFrom: rate.effectiveFrom,
        effectiveTo: rate.effectiveTo,
      };
    });
}

export interface CostPoolRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}

export function toCostPoolRows(
  organizationId: string,
  pools: readonly CostPoolRecord[],
): readonly CostPoolRow[] {
  return pools
    .filter((pool) => pool.organizationId === organizationId)
    .map((pool) => ({
      id: pool.id,
      code: pool.code,
      name: pool.name,
      effectiveFrom: pool.effectiveFrom,
      effectiveTo: pool.effectiveTo,
    }));
}

export interface AllocationRuleRow {
  readonly id: string;
  readonly costPoolId: string;
  readonly costPoolCode: string;
  readonly driver: string;
  readonly scopeType: string;
  readonly denominatorSource: string;
  readonly fallbackBehavior: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}

export function toAllocationRuleRows(
  rules: readonly AllocationRuleReadRecord[],
): readonly AllocationRuleRow[] {
  return rules.map((rule) => ({
    id: rule.id,
    costPoolId: rule.costPoolId,
    costPoolCode: rule.costPoolCode,
    driver: rule.driver,
    scopeType: rule.scopeType,
    denominatorSource: rule.denominatorSource,
    fallbackBehavior: rule.fallbackBehavior,
    effectiveFrom: rule.effectiveFrom,
    effectiveTo: rule.effectiveTo,
  }));
}
