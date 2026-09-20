import type {
  CalculationSnapshotRecord,
  CostCardRecord,
  SnapshotComponentRecord,
} from "./cost-card-types";
import type { PriceScenarioRecord } from "./price-scenario-types";
import type {
  AllocationRuleReadRecord,
  CostingItemRefRecord,
  CostingOrganizationRefRecord,
  CostingReadStore,
  CostingRefRecord,
  CostingUnitRefRecord,
} from "./read-types";
import type { CostPoolRecord, LaborRateRecord, OperatingCostRecord } from "./types";

/**
 * In-memory `CostingReadStore` for the read-service unit suite. It holds the
 * durable records the read surface projects and mirrors the Postgres adapter's
 * observable contract (org-scoped lists, newest-first ordering); the real
 * adapter is covered by `read.postgres.test.ts`.
 */
export class FakeCostingReadStore implements CostingReadStore {
  readonly organizations = new Map<string, CostingOrganizationRefRecord>();
  readonly productVariants = new Map<string, CostingRefRecord>();
  readonly locations = new Map<string, CostingRefRecord>();
  readonly channels = new Map<string, CostingRefRecord>();
  readonly costCenters = new Map<string, CostingRefRecord>();
  readonly items = new Map<string, CostingItemRefRecord>();
  readonly units = new Map<string, CostingUnitRefRecord>();
  readonly costCards = new Map<string, CostCardRecord>();
  readonly snapshots = new Map<string, CalculationSnapshotRecord>();
  readonly components: SnapshotComponentRecord[] = [];
  readonly priceScenarios = new Map<string, PriceScenarioRecord>();
  readonly operatingCosts: OperatingCostRecord[] = [];
  readonly laborRates: LaborRateRecord[] = [];
  readonly costPools = new Map<string, CostPoolRecord>();
  readonly allocationRules: AllocationRuleReadRecord[] = [];
  /** `allocation_rule` carries no own organization; the fake tracks the pool's. */
  readonly allocationRuleOrganizations = new Map<string, string>();

  findOrganization(organizationId: string): Promise<CostingOrganizationRefRecord | undefined> {
    return Promise.resolve(this.organizations.get(organizationId));
  }

  findProductVariant(productVariantId: string): Promise<CostingRefRecord | undefined> {
    return Promise.resolve(this.productVariants.get(productVariantId));
  }

  findLocation(locationId: string): Promise<CostingRefRecord | undefined> {
    return Promise.resolve(this.locations.get(locationId));
  }

  findChannel(channelId: string): Promise<CostingRefRecord | undefined> {
    return Promise.resolve(this.channels.get(channelId));
  }

  findCostCenter(costCenterId: string): Promise<CostingRefRecord | undefined> {
    return Promise.resolve(this.costCenters.get(costCenterId));
  }

  findItem(itemId: string): Promise<CostingItemRefRecord | undefined> {
    return Promise.resolve(this.items.get(itemId));
  }

  findUnit(unitId: string): Promise<CostingUnitRefRecord | undefined> {
    return Promise.resolve(this.units.get(unitId));
  }

  listCostCards(query: { readonly organizationId: string }): Promise<readonly CostCardRecord[]> {
    return Promise.resolve(this.costCardsNewestFirst().filter(isOwned(query.organizationId)));
  }

  findCostCard(costCardId: string): Promise<CostCardRecord | undefined> {
    return Promise.resolve(this.costCards.get(costCardId));
  }

  listCostCardsForScope(query: {
    readonly organizationId: string;
    readonly productVariantId: string;
    readonly locationId: string;
    readonly channelId: string | null;
  }): Promise<readonly CostCardRecord[]> {
    return Promise.resolve(
      this.costCardsNewestFirst().filter(
        (card) =>
          card.organizationId === query.organizationId &&
          card.productVariantId === query.productVariantId &&
          card.locationId === query.locationId &&
          (card.channelId ?? null) === (query.channelId ?? null),
      ),
    );
  }

  findCalculationSnapshot(snapshotId: string): Promise<CalculationSnapshotRecord | undefined> {
    return Promise.resolve(this.snapshots.get(snapshotId));
  }

  listSnapshotComponents(snapshotId: string): Promise<readonly SnapshotComponentRecord[]> {
    return Promise.resolve(this.components.filter((row) => row.snapshotId === snapshotId));
  }

  listPriceScenarios(query: {
    readonly organizationId: string;
  }): Promise<readonly PriceScenarioRecord[]> {
    return Promise.resolve(
      [...this.priceScenarios.values()]
        .filter(isOwned(query.organizationId))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)),
    );
  }

  findPriceScenario(priceScenarioId: string): Promise<PriceScenarioRecord | undefined> {
    return Promise.resolve(this.priceScenarios.get(priceScenarioId));
  }

  listOperatingCosts(query: {
    readonly organizationId: string;
  }): Promise<readonly OperatingCostRecord[]> {
    return Promise.resolve(this.operatingCosts.filter(isOwned(query.organizationId)));
  }

  listLaborRates(query: { readonly organizationId: string }): Promise<readonly LaborRateRecord[]> {
    return Promise.resolve(this.laborRates.filter(isOwned(query.organizationId)));
  }

  listCostPools(query: { readonly organizationId: string }): Promise<readonly CostPoolRecord[]> {
    return Promise.resolve([...this.costPools.values()].filter(isOwned(query.organizationId)));
  }

  listAllocationRules(query: {
    readonly organizationId: string;
  }): Promise<readonly AllocationRuleReadRecord[]> {
    return Promise.resolve(
      this.allocationRules.filter(
        (rule) => this.allocationRuleOrganizations.get(rule.id) === query.organizationId,
      ),
    );
  }

  /** Adds an allocation rule and records the organization its pool belongs to. */
  addAllocationRule(organizationId: string, rule: AllocationRuleReadRecord): void {
    this.allocationRules.push(rule);
    this.allocationRuleOrganizations.set(rule.id, organizationId);
  }

  private costCardsNewestFirst(): CostCardRecord[] {
    return [...this.costCards.values()].sort((a, b) =>
      a.calculatedAt < b.calculatedAt ? 1 : a.calculatedAt > b.calculatedAt ? -1 : 0,
    );
  }
}

function isOwned<T extends { readonly organizationId: string }>(
  organizationId: string,
): (record: T) => boolean {
  return (record) => record.organizationId === organizationId;
}

export interface CostingReadFixture {
  readonly organizationId: string;
  readonly otherOrganizationId: string;
  readonly productVariantId: string;
  readonly locationId: string;
  readonly channelId: string;
  readonly costCenterId: string;
  readonly itemId: string;
  readonly unitId: string;
}

/**
 * Seeds the org + display-reference rows the read tests share. Fixed ids keep
 * assertions readable; a test that needs a foreign-org row adds its own.
 */
export function seedCostingReadFixture(store: FakeCostingReadStore): CostingReadFixture {
  const organizationId = "org";
  const otherOrganizationId = "org-other";
  const productVariantId = "variant";
  const locationId = "loc";
  const channelId = "channel";
  const costCenterId = "cost-center";
  const itemId = "item";
  const unitId = "unit";

  store.organizations.set(organizationId, { id: organizationId, currency: "NOK" });
  store.organizations.set(otherOrganizationId, { id: otherOrganizationId, currency: "NOK" });
  store.productVariants.set(productVariantId, {
    id: productVariantId,
    organizationId,
    code: "FLAT_WHITE",
    name: "Flat White",
  });
  store.locations.set(locationId, {
    id: locationId,
    organizationId,
    code: "MAIN",
    name: "Main café",
  });
  store.channels.set(channelId, {
    id: channelId,
    organizationId,
    code: "IN_STORE",
    name: "In store",
  });
  store.costCenters.set(costCenterId, {
    id: costCenterId,
    organizationId,
    code: "KITCHEN",
    name: "Kitchen",
  });
  store.items.set(itemId, {
    id: itemId,
    organizationId,
    code: "MILK",
    name: "Milk",
    baseUnitId: unitId,
  });
  store.units.set(unitId, { id: unitId, organizationId, code: "l" });

  return {
    organizationId,
    otherOrganizationId,
    productVariantId,
    locationId,
    channelId,
    costCenterId,
    itemId,
    unitId,
  };
}
