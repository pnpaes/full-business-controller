import {
  formatDecimal,
  LOADED_RATE_SCALE,
  MONEY_SCALE,
  parseDecimal,
  rescale,
} from "@aquarela/domain";
import * as repo from "@aquarela/persistence";
import type { Database, NodeDatabase } from "@aquarela/persistence";

import type {
  CalculationSnapshotRecord,
  CostCardRecord,
  SnapshotComponentRecord,
} from "./cost-card-types";
import { asJsonObject } from "./json";
import type { PriceScenarioRecord } from "./price-scenario-types";
import type {
  AllocationRuleReadRecord,
  ChannelListRecord,
  CostingItemRefRecord,
  CostingReadStore,
  CostingRefRecord,
  CostingUnitRefRecord,
} from "./read-types";
import type {
  CostCenterRecord,
  CostPoolRecord,
  LaborRateRecord,
  OperatingCostRecord,
} from "./types";

/**
 * Read adapter for `CostingReadStore`: maps the persistence rows to the read
 * projections. `date` columns stay `yyyy-mm-dd`; `timestamptz` columns become
 * ISO strings; the `labor_rate.loaded_hourly_rate` is narrowed from
 * `numeric(19,4)` to the domain's 2 dp loaded rate, exactly as the write
 * adapter does.
 */

/** Query API is present on the pool database and a transaction alike. */
function relational(db: Database): NodeDatabase {
  return db as NodeDatabase;
}

function toCostCard(row: repo.CostCard): CostCardRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    productVariantId: row.productVariantId,
    locationId: row.locationId,
    channelId: row.channelId,
    recipeVersionId: row.recipeVersionId,
    state: row.state,
    costSelectionPolicy: row.costSelectionPolicy,
    calculatedAt: row.calculatedAt.toISOString(),
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt === null ? null : row.approvedAt.toISOString(),
    snapshotId: row.snapshotId,
  };
}

function toSnapshot(row: repo.CalculationSnapshot): CalculationSnapshotRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    costCardId: row.costCardId,
    priceScenarioId: row.priceScenarioId,
    costSelectionPolicy: row.costSelectionPolicy,
    asOf: row.asOf.toISOString(),
    taxRuleSnapshot: asJsonObject(row.taxRuleSnapshot),
    fxRateId: row.fxRateId,
    roundingMethod: row.roundingMethod,
    roundingScales: asJsonObject(row.roundingScales),
    ruleVersion: row.ruleVersion,
    totals: asJsonObject(row.totals),
    createdAt: row.createdAt.toISOString(),
  };
}

function toComponent(row: repo.SnapshotComponent): SnapshotComponentRecord {
  return {
    id: row.id,
    snapshotId: row.snapshotId,
    componentKind: row.componentKind,
    itemId: row.itemId,
    quantity: row.quantity,
    unitId: row.unitId,
    unitCost: row.unitCost,
    amount: row.amount,
    roundingBoundary: row.roundingBoundary,
    provenance: asJsonObject(row.provenance),
  };
}

function toPriceScenario(row: repo.PriceScenario): PriceScenarioRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    productVariantId: row.productVariantId,
    locationId: row.locationId,
    channelId: row.channelId,
    grossPrice: row.grossPrice,
    netPrice: row.netPrice,
    targetContributionPct: row.targetContributionPct,
    volumeAssumption: row.volumeAssumption,
    feeBreakdown: asJsonObject(row.feeBreakdown),
    outcome: asJsonObject(row.outcome),
    state: row.state,
    createdAt: row.createdAt.toISOString(),
  };
}

function toLoadedHourlyRate(value: string): string {
  return formatDecimal(
    rescale(parseDecimal(value, MONEY_SCALE), MONEY_SCALE, LOADED_RATE_SCALE),
    LOADED_RATE_SCALE,
  );
}

function toLaborRate(row: repo.LaborRate): LaborRateRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    costCenterId: row.costCenterId,
    roleCode: row.roleCode,
    loadedHourlyRate: toLoadedHourlyRate(row.loadedHourlyRate),
    productiveHoursPct: row.productiveHoursPct,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
  };
}

function toOperatingCost(row: repo.OperatingCost): OperatingCostRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    locationId: row.locationId,
    costCenterId: row.costCenterId,
    costPoolId: row.costPoolId,
    amount: row.amount,
    currency: row.currency,
    recurrence: row.recurrence,
    behavior: row.behavior,
    taxBasis: row.taxBasis,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    vendor: row.vendor,
    evidenceFileId: row.evidenceFileId,
  };
}

function toCostPool(row: repo.CostPool): CostPoolRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    name: row.name,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
  };
}

function toAllocationRule(row: repo.AllocationRuleReadRow): AllocationRuleReadRecord {
  return {
    id: row.id,
    costPoolId: row.costPoolId,
    driver: row.driver,
    scopeType: row.scopeType,
    denominatorSource: row.denominatorSource,
    fallbackBehavior: row.fallbackBehavior,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    costPoolCode: row.costPoolCode,
  };
}

/** Adapts the persistence repositories to the `CostingReadStore` port. */
export function createPostgresCostingReadStore(db: Database): CostingReadStore {
  const query = () => relational(db).query;
  return {
    findOrganization: async (organizationId) => {
      const row = await query().organization.findFirst({
        where: (table, { eq }) => eq(table.id, organizationId),
        columns: { id: true, currency: true },
      });
      return row === undefined ? undefined : { id: row.id, currency: row.currency };
    },
    findProductVariant: async (productVariantId) => {
      const row = await query().productVariant.findFirst({
        where: (table, { eq }) => eq(table.id, productVariantId),
        columns: { id: true, organizationId: true, code: true, name: true },
      });
      return row === undefined ? undefined : toRef(row);
    },
    findLocation: async (locationId) => {
      const row = await repo.findLocationById(db, locationId);
      return row === undefined ? undefined : toRef(row);
    },
    findChannel: async (channelId) => {
      const row = await query().channel.findFirst({
        where: (table, { eq }) => eq(table.id, channelId),
        columns: { id: true, organizationId: true, code: true, name: true },
      });
      return row === undefined ? undefined : toRef(row);
    },
    findCostCenter: async (costCenterId) => {
      const row = await query().costCenter.findFirst({
        where: (table, { eq }) => eq(table.id, costCenterId),
        columns: { id: true, organizationId: true, code: true, name: true },
      });
      return row === undefined ? undefined : toRef(row);
    },
    findItem: async (itemId) => {
      const row = await repo.findItemById(db, itemId);
      return row === undefined
        ? undefined
        : ({
            id: row.id,
            organizationId: row.organizationId,
            code: row.code,
            name: row.name,
            baseUnitId: row.baseUnitId,
          } satisfies CostingItemRefRecord);
    },
    findUnit: async (unitId) => {
      const row = await repo.findUnitById(db, unitId);
      return row === undefined
        ? undefined
        : ({
            id: row.id,
            organizationId: row.organizationId,
            code: row.code,
          } satisfies CostingUnitRefRecord);
    },
    listCostCards: async (query_) =>
      (await repo.listCostCards(db, query_.organizationId)).map(toCostCard),
    findCostCard: async (costCardId) => {
      const row = await repo.findCostCard(db, costCardId);
      return row === undefined ? undefined : toCostCard(row);
    },
    listCostCardsForScope: async (query_) =>
      (await repo.listCostCardsForScope(db, query_)).map(toCostCard),
    findCalculationSnapshot: async (snapshotId) => {
      const row = await repo.findCalculationSnapshot(db, snapshotId);
      return row === undefined ? undefined : toSnapshot(row);
    },
    listSnapshotComponents: async (snapshotId) =>
      (await repo.listSnapshotComponents(db, snapshotId)).map(toComponent),
    listPriceScenarios: async (query_) =>
      (await repo.listPriceScenarios(db, query_.organizationId)).map(toPriceScenario),
    findPriceScenario: async (priceScenarioId) => {
      const row = await repo.findPriceScenario(db, priceScenarioId);
      return row === undefined ? undefined : toPriceScenario(row);
    },
    listOperatingCosts: async (query_) =>
      (await repo.listOperatingCosts(db, query_.organizationId)).map(toOperatingCost),
    listLaborRates: async (query_) =>
      (await repo.listLaborRates(db, query_.organizationId)).map(toLaborRate),
    listCostPools: async (query_) =>
      (await repo.listCostPools(db, query_.organizationId)).map(toCostPool),
    listAllocationRules: async (query_) =>
      (await repo.listAllocationRules(db, query_.organizationId)).map(toAllocationRule),
    listCostCenters: async (query_) => {
      const rows = await query().costCenter.findMany({
        where: (table, { and, eq }) =>
          and(
            eq(table.organizationId, query_.organizationId),
            query_.kind === undefined ? undefined : eq(table.kind, query_.kind),
            query_.locationId === undefined ? undefined : eq(table.locationId, query_.locationId),
          ),
        orderBy: (table, { asc }) => [asc(table.code), asc(table.id)],
        limit: query_.limit,
        offset: query_.offset,
      });
      return rows.map(toCostCenter);
    },
    listChannels: async (query_) => {
      const rows = await query().channel.findMany({
        where: (table, { and, eq }) =>
          and(
            eq(table.organizationId, query_.organizationId),
            query_.isDelivery === undefined ? undefined : eq(table.isDelivery, query_.isDelivery),
          ),
        orderBy: (table, { asc }) => [asc(table.code), asc(table.id)],
        limit: query_.limit,
        offset: query_.offset,
      });
      return rows.map(toChannelList);
    },
  };
}

function toRef(row: {
  readonly id: string;
  readonly organizationId: string;
  readonly code: string;
  readonly name: string | null;
}): CostingRefRecord {
  return { id: row.id, organizationId: row.organizationId, code: row.code, name: row.name };
}

function toCostCenter(row: {
  readonly id: string;
  readonly organizationId: string;
  readonly locationId: string | null;
  readonly code: string;
  readonly name: string;
  readonly kind: string;
}): CostCenterRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    locationId: row.locationId,
    code: row.code,
    name: row.name,
    kind: row.kind,
  };
}

function toChannelList(row: {
  readonly id: string;
  readonly organizationId: string;
  readonly code: string;
  readonly name: string;
  readonly isDelivery: boolean;
}): ChannelListRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    name: row.name,
    isDelivery: row.isDelivery,
  };
}
