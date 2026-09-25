import type {
  CalculationSnapshotRecord,
  CostCardRecord,
  SnapshotComponentRecord,
} from "./cost-card-types";
import type { PriceScenarioRecord } from "./price-scenario-types";
import type {
  AllocationRuleRecord,
  CostCenterRecord,
  CostPoolRecord,
  LaborRateRecord,
  OperatingCostRecord,
} from "./types";

/**
 * Read-side port for the Costs area (08_UI_UX.md §8.3): list/detail projections
 * over the slice-6/7 facts. This is deliberately separate from the write ports
 * (`CostingStore`/`CostCardStore`/`PriceScenarioStore`) so reads can never accrete
 * write paths, and so the screens/API have one narrow, org-scoped surface.
 *
 * Every record here is a structural projection of a persistence row; no maths is
 * re-derived — the derived figures the UI shows (cost-card totals, scenario
 * outcome) are read from the snapshots the compute commands wrote.
 */

/** A `(id, code, name)` reference row for display; name is null where the table has none. */
export interface CostingRefRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly code: string;
  readonly name: string | null;
}

export interface CostingItemRefRecord extends CostingRefRecord {
  readonly baseUnitId: string;
}

export interface CostingUnitRefRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly code: string;
}

export interface CostingOrganizationRefRecord {
  readonly id: string;
  readonly currency: string;
}

/** An allocation rule plus its pool's code (the pool carries the org scope). */
export interface AllocationRuleReadRecord extends AllocationRuleRecord {
  readonly costPoolCode: string;
}

/** One prior calculation in the same scope, for the cost-card historical comparison. */
export interface CostCardHistoryEntry {
  readonly card: CostCardRecord;
  /** The snapshot's stored totals (already computed by `calculateCostCard`), or null. */
  readonly totals: Record<string, unknown> | null;
}

export interface CostCardDetailRecord {
  readonly card: CostCardRecord;
  /** The card's frozen calculation snapshot (null when it has none yet). */
  readonly snapshot: CalculationSnapshotRecord | null;
  /** The snapshot's stored intermediates — the source drill-down. */
  readonly components: readonly SnapshotComponentRecord[];
  /** Prior calculations for the same scope, newest first (excludes the card itself). */
  readonly history: readonly CostCardHistoryEntry[];
}

export interface CostingReadStore {
  findOrganization(organizationId: string): Promise<CostingOrganizationRefRecord | undefined>;
  findProductVariant(productVariantId: string): Promise<CostingRefRecord | undefined>;
  findLocation(locationId: string): Promise<CostingRefRecord | undefined>;
  findChannel(channelId: string): Promise<CostingRefRecord | undefined>;
  findCostCenter(costCenterId: string): Promise<CostingRefRecord | undefined>;
  findItem(itemId: string): Promise<CostingItemRefRecord | undefined>;
  findUnit(unitId: string): Promise<CostingUnitRefRecord | undefined>;

  listCostCards(query: { readonly organizationId: string }): Promise<readonly CostCardRecord[]>;
  findCostCard(costCardId: string): Promise<CostCardRecord | undefined>;
  listCostCardsForScope(query: {
    readonly organizationId: string;
    readonly productVariantId: string;
    readonly locationId: string;
    readonly channelId: string | null;
  }): Promise<readonly CostCardRecord[]>;
  findCalculationSnapshot(snapshotId: string): Promise<CalculationSnapshotRecord | undefined>;
  listSnapshotComponents(snapshotId: string): Promise<readonly SnapshotComponentRecord[]>;

  listPriceScenarios(query: {
    readonly organizationId: string;
  }): Promise<readonly PriceScenarioRecord[]>;
  findPriceScenario(priceScenarioId: string): Promise<PriceScenarioRecord | undefined>;

  listOperatingCosts(query: {
    readonly organizationId: string;
  }): Promise<readonly OperatingCostRecord[]>;
  listLaborRates(query: { readonly organizationId: string }): Promise<readonly LaborRateRecord[]>;
  listCostPools(query: { readonly organizationId: string }): Promise<readonly CostPoolRecord[]>;
  listAllocationRules(query: {
    readonly organizationId: string;
  }): Promise<readonly AllocationRuleReadRecord[]>;

  /**
   * One bounded page of the organization's cost centres (`DATA_DICTIONARY` §1),
   * ordered by `code` (then `id`). `limit`/`offset` are applied by the store so a
   * caller cannot pull the whole register; the application `listCostCenters`
   * service validates them against `MAX_COST_CENTER_LIMIT` first.
   */
  listCostCenters(query: {
    readonly organizationId: string;
    readonly kind?: string;
    readonly locationId?: string;
    readonly limit: number;
    readonly offset: number;
  }): Promise<readonly CostCenterRecord[]>;
}
