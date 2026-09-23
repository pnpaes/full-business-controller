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
  AllocationRuleRecord,
  ChannelFeeRuleRecord,
  CostCenterRecord,
  CostPoolRecord,
  CostingStore,
  LaborRateRecord,
  LocationRecord,
  OperatingCostRecord,
} from "./types";

/** A transaction handle has no `transaction` method of its own. */
function isNodeDatabase(db: Database): db is NodeDatabase {
  return typeof (db as NodeDatabase).transaction === "function";
}

/**
 * The relational `query` API is present on both the pool database and a
 * transaction (a transaction extends the base database), so this narrows the
 * union for the id lookups that have no repository function yet.
 */
function relational(db: Database): NodeDatabase {
  return db as NodeDatabase;
}

function toCostCenter(row: repo.CostCenter): CostCenterRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    locationId: row.locationId,
    code: row.code,
    name: row.name,
    kind: row.kind,
  };
}

type LocationRow = typeof repo.location.$inferSelect;

function toLocation(row: LocationRow): LocationRecord {
  return { id: row.id, organizationId: row.organizationId };
}

/**
 * The `labor_rate.loaded_hourly_rate` column is `numeric(19,4)` while the domain
 * loaded rate is 2 dp (`LOADED_RATE_SCALE`), so the money string is narrowed to
 * the scale the labour primitives parse. Round-trip stable: registration stores
 * the derived 2 dp value.
 */
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

function toChannelFeeRule(row: repo.ChannelFeeRule): ChannelFeeRuleRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    channelId: row.channelId,
    feeKind: row.feeKind,
    percentageRate: row.percentageRate,
    fixedAmount: row.fixedAmount,
    feeBasis: row.feeBasis,
    taxRuleId: row.taxRuleId,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
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

/** Accepts the full row and the org-scoped join projection alike. */
function toAllocationRule(row: {
  readonly id: string;
  readonly costPoolId: string;
  readonly driver: string;
  readonly scopeType: string;
  readonly denominatorSource: string;
  readonly fallbackBehavior: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}): AllocationRuleRecord {
  return {
    id: row.id,
    costPoolId: row.costPoolId,
    driver: row.driver,
    scopeType: row.scopeType,
    denominatorSource: row.denominatorSource,
    fallbackBehavior: row.fallbackBehavior,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
  };
}

/** Adapts the persistence repositories to the `CostingStore` port. */
export function createPostgresCostingStore(db: Database): CostingStore {
  return {
    withTransaction: async (fn) => {
      if (!isNodeDatabase(db)) {
        return fn(createPostgresCostingStore(db));
      }
      return db.transaction((tx) => fn(createPostgresCostingStore(tx)));
    },
    findCostCenter: async (costCenterId) => {
      const row = await relational(db).query.costCenter.findFirst({
        where: (table, { eq }) => eq(table.id, costCenterId),
      });
      return row === undefined ? undefined : toCostCenter(row);
    },
    findLocation: async (locationId) => {
      const row = await relational(db).query.location.findFirst({
        where: (table, { eq }) => eq(table.id, locationId),
      });
      return row === undefined ? undefined : toLocation(row);
    },
    findChannel: async (channelId) => {
      const row = await relational(db).query.channel.findFirst({
        where: (table, { eq }) => eq(table.id, channelId),
        columns: { id: true, organizationId: true },
      });
      return row === undefined ? undefined : { id: row.id, organizationId: row.organizationId };
    },
    createLaborRate: async (input) => toLaborRate(await repo.createLaborRate(db, input)),
    findEffectiveLaborRate: async (query) => {
      const row = await repo.findEffectiveLaborRate(db, query);
      return row === undefined ? undefined : toLaborRate(row);
    },
    createOperatingCost: async (input) =>
      toOperatingCost(await repo.createOperatingCost(db, input)),
    listEffectiveOperatingCosts: async (query) =>
      (await repo.listEffectiveOperatingCosts(db, query)).map(toOperatingCost),
    createCostPool: async (input) => toCostPool(await repo.createCostPool(db, input)),
    findCostPool: async (costPoolId) => {
      const row = await repo.findCostPool(db, costPoolId);
      return row === undefined ? undefined : toCostPool(row);
    },
    listCostPoolsByCode: async (organizationId, code) =>
      (await repo.listCostPoolsByCode(db, organizationId, code)).map(toCostPool),
    createAllocationRule: async (input) =>
      toAllocationRule(await repo.createAllocationRule(db, input)),
    listEffectiveAllocationRules: async (query) =>
      (await repo.listEffectiveAllocationRules(db, query)).map(toAllocationRule),
    listChannelFeeRulesByChannel: async (organizationId, channelId) => {
      const rows = await relational(db).query.channelFeeRule.findMany({
        where: (fields, { and, eq }) =>
          and(eq(fields.organizationId, organizationId), eq(fields.channelId, channelId)),
        orderBy: (fields, { desc }) => [desc(fields.effectiveFrom)],
      });
      return rows.map(toChannelFeeRule);
    },
    listEffectiveChannelFeeRules: async (query) =>
      (await repo.listEffectiveChannelFeeRules(db, query)).map(toChannelFeeRule),
    createChannelFeeRule: async (input) =>
      toChannelFeeRule(await repo.createChannelFeeRule(db, input)),
    writeAudit: async (input) => {
      await repo.writeAuditEvent(db, input);
    },
  };
}
