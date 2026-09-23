import { and, desc, eq, gt, isNull, lte, or } from "drizzle-orm";

import type { Database } from "../client";
import { allocationRule, channelFeeRule, costPool, laborRate, operatingCost } from "../schema";

export type OperatingCost = typeof operatingCost.$inferSelect;
export type NewOperatingCost = typeof operatingCost.$inferInsert;
export type ChannelFeeRule = typeof channelFeeRule.$inferSelect;
export type NewChannelFeeRule = typeof channelFeeRule.$inferInsert;
export type LaborRate = typeof laborRate.$inferSelect;
export type NewLaborRate = typeof laborRate.$inferInsert;
export type CostPool = typeof costPool.$inferSelect;
export type NewCostPool = typeof costPool.$inferInsert;
export type AllocationRule = typeof allocationRule.$inferSelect;
export type NewAllocationRule = typeof allocationRule.$inferInsert;

/**
 * `effective_from`/`effective_to` are `date` columns, so the half-open
 * `[effective_from, effective_to)` window is evaluated against a `yyyy-mm-dd`
 * string (`catalog.ts` uses the same convention for `cost_observation`).
 */
const asOfDate = (asOf: Date): string => asOf.toISOString().slice(0, 10);

export async function createOperatingCost(
  db: Database,
  input: NewOperatingCost,
): Promise<OperatingCost> {
  const rows = await db.insert(operatingCost).values(input).returning();
  return rows[0]!;
}

/**
 * Every operating-cost fact for the organization, newest effective window first.
 * Unlike `listEffectiveOperatingCosts` this is not date-scoped: it is the read
 * surface behind the Costs area's operating-costs table (all rows, any state).
 */
export async function listOperatingCosts(
  db: Database,
  organizationId: string,
): Promise<OperatingCost[]> {
  return db
    .select()
    .from(operatingCost)
    .where(eq(operatingCost.organizationId, organizationId))
    .orderBy(desc(operatingCost.effectiveFrom), operatingCost.costCenterId);
}

export interface EffectiveOperatingCostQuery {
  readonly organizationId: string;
  readonly asOf: Date;
  readonly locationId?: string | null;
  readonly costCenterId?: string | null;
  readonly costPoolId?: string | null;
}

/**
 * Operating costs effective at `asOf` (half-open window). `locationId`,
 * `costCenterId` and `costPoolId` are optional filters: passing null or absent
 * does not narrow the set (a null location means a company-shared cost, not
 * "no location"; a null pool means a cost with no shared-pool link).
 */
export async function listEffectiveOperatingCosts(
  db: Database,
  query: EffectiveOperatingCostQuery,
): Promise<OperatingCost[]> {
  const asOf = asOfDate(query.asOf);
  const locationFilter =
    query.locationId === undefined || query.locationId === null
      ? undefined
      : eq(operatingCost.locationId, query.locationId);
  const costCenterFilter =
    query.costCenterId === undefined || query.costCenterId === null
      ? undefined
      : eq(operatingCost.costCenterId, query.costCenterId);
  const costPoolFilter =
    query.costPoolId === undefined || query.costPoolId === null
      ? undefined
      : eq(operatingCost.costPoolId, query.costPoolId);
  return db
    .select()
    .from(operatingCost)
    .where(
      and(
        eq(operatingCost.organizationId, query.organizationId),
        lte(operatingCost.effectiveFrom, asOf),
        or(isNull(operatingCost.effectiveTo), gt(operatingCost.effectiveTo, asOf)),
        locationFilter,
        costCenterFilter,
        costPoolFilter,
      ),
    )
    .orderBy(desc(operatingCost.effectiveFrom));
}

export async function createLaborRate(db: Database, input: NewLaborRate): Promise<LaborRate> {
  const rows = await db.insert(laborRate).values(input).returning();
  return rows[0]!;
}

export interface EffectiveLaborRateQuery {
  readonly organizationId: string;
  readonly costCenterId: string;
  readonly roleCode: string;
  readonly asOf: Date;
}

/** The newest rate effective at `asOf`, or undefined when none is in window. */
export async function findEffectiveLaborRate(
  db: Database,
  query: EffectiveLaborRateQuery,
): Promise<LaborRate | undefined> {
  const asOf = asOfDate(query.asOf);
  const rows = await db
    .select()
    .from(laborRate)
    .where(
      and(
        eq(laborRate.organizationId, query.organizationId),
        eq(laborRate.costCenterId, query.costCenterId),
        eq(laborRate.roleCode, query.roleCode),
        lte(laborRate.effectiveFrom, asOf),
        or(isNull(laborRate.effectiveTo), gt(laborRate.effectiveTo, asOf)),
      ),
    )
    .orderBy(desc(laborRate.effectiveFrom))
    .limit(1);
  return rows[0];
}

/**
 * Every labour rate for the organization, newest effective window first. The
 * read surface behind the Costs area's labour-rates table; not date-scoped.
 */
export async function listLaborRates(db: Database, organizationId: string): Promise<LaborRate[]> {
  return db
    .select()
    .from(laborRate)
    .where(eq(laborRate.organizationId, organizationId))
    .orderBy(desc(laborRate.effectiveFrom), laborRate.roleCode);
}

export async function findCostPool(
  db: Database,
  costPoolId: string,
): Promise<CostPool | undefined> {
  const rows = await db.select().from(costPool).where(eq(costPool.id, costPoolId)).limit(1);
  return rows[0];
}

/**
 * `cost_pool.code` is versioned, not unique: a code may carry several
 * non-overlapping effective windows. All versions of one code, newest first, so
 * a code-only lookup is deterministic when several versions exist.
 */
export async function listCostPoolsByCode(
  db: Database,
  organizationId: string,
  code: string,
): Promise<CostPool[]> {
  return db
    .select()
    .from(costPool)
    .where(and(eq(costPool.organizationId, organizationId), eq(costPool.code, code)))
    .orderBy(desc(costPool.effectiveFrom));
}

export async function createCostPool(db: Database, input: NewCostPool): Promise<CostPool> {
  const rows = await db.insert(costPool).values(input).returning();
  return rows[0]!;
}

/**
 * Every cost pool for the organization, grouped by code and newest version
 * first. The read surface behind the Costs area's cost-pools table; unlike
 * `listCostPoolsByCode` it spans all codes and is not date-scoped.
 */
export async function listCostPools(db: Database, organizationId: string): Promise<CostPool[]> {
  return db
    .select()
    .from(costPool)
    .where(eq(costPool.organizationId, organizationId))
    .orderBy(costPool.code, desc(costPool.effectiveFrom));
}

export interface EffectiveChannelFeeRuleQuery {
  readonly organizationId: string;
  readonly channelId: string;
  readonly asOf: Date;
}

/**
 * Channel fee rules effective at `asOf` for one organization + channel, newest
 * effective window first. `effective_from`/`effective_to` are `tstz` columns
 * here (unlike `operating_cost`), so the half-open `[effective_from,
 * effective_to)` window is evaluated against the `asOf` timestamp itself.
 */
export async function listEffectiveChannelFeeRules(
  db: Database,
  query: EffectiveChannelFeeRuleQuery,
): Promise<ChannelFeeRule[]> {
  return db
    .select()
    .from(channelFeeRule)
    .where(
      and(
        eq(channelFeeRule.organizationId, query.organizationId),
        eq(channelFeeRule.channelId, query.channelId),
        lte(channelFeeRule.effectiveFrom, query.asOf),
        or(isNull(channelFeeRule.effectiveTo), gt(channelFeeRule.effectiveTo, query.asOf)),
      ),
    )
    .orderBy(desc(channelFeeRule.effectiveFrom));
}

export async function createChannelFeeRule(
  db: Database,
  input: NewChannelFeeRule,
): Promise<ChannelFeeRule> {
  const rows = await db.insert(channelFeeRule).values(input).returning();
  return rows[0]!;
}

export async function createAllocationRule(
  db: Database,
  input: NewAllocationRule,
): Promise<AllocationRule> {
  const rows = await db.insert(allocationRule).values(input).returning();
  return rows[0]!;
}

export interface EffectiveAllocationRuleQuery {
  readonly organizationId: string;
  readonly asOf: Date;
  readonly costPoolId?: string;
}

/**
 * Allocation rules effective at `asOf` for the organization's cost pools,
 * newest-first. Scoped through `cost_pool` because `allocation_rule` carries no
 * `organization_id` of its own.
 */
export async function listEffectiveAllocationRules(
  db: Database,
  query: EffectiveAllocationRuleQuery,
): Promise<AllocationRule[]> {
  const asOf = asOfDate(query.asOf);
  const poolFilter =
    query.costPoolId === undefined ? undefined : eq(allocationRule.costPoolId, query.costPoolId);
  const rows = await db
    .select({
      id: allocationRule.id,
      costPoolId: allocationRule.costPoolId,
      driver: allocationRule.driver,
      scopeType: allocationRule.scopeType,
      denominatorSource: allocationRule.denominatorSource,
      fallbackBehavior: allocationRule.fallbackBehavior,
      effectiveFrom: allocationRule.effectiveFrom,
      effectiveTo: allocationRule.effectiveTo,
      createdAt: allocationRule.createdAt,
    })
    .from(allocationRule)
    .innerJoin(costPool, eq(allocationRule.costPoolId, costPool.id))
    .where(
      and(
        eq(costPool.organizationId, query.organizationId),
        lte(allocationRule.effectiveFrom, asOf),
        or(isNull(allocationRule.effectiveTo), gt(allocationRule.effectiveTo, asOf)),
        poolFilter,
      ),
    )
    .orderBy(desc(allocationRule.effectiveFrom));
  return rows;
}

/** An allocation rule joined to its pool's code (the pool carries the org scope). */
export interface AllocationRuleReadRow extends AllocationRule {
  readonly costPoolCode: string;
}

/**
 * Every allocation rule for the organization's cost pools, grouped by pool code
 * and newest version first, with the pool's code for display. Not date-scoped:
 * the read surface behind the Costs area's allocation-rules table.
 */
export async function listAllocationRules(
  db: Database,
  organizationId: string,
): Promise<AllocationRuleReadRow[]> {
  return db
    .select({
      id: allocationRule.id,
      costPoolId: allocationRule.costPoolId,
      driver: allocationRule.driver,
      scopeType: allocationRule.scopeType,
      denominatorSource: allocationRule.denominatorSource,
      fallbackBehavior: allocationRule.fallbackBehavior,
      effectiveFrom: allocationRule.effectiveFrom,
      effectiveTo: allocationRule.effectiveTo,
      createdAt: allocationRule.createdAt,
      costPoolCode: costPool.code,
    })
    .from(allocationRule)
    .innerJoin(costPool, eq(allocationRule.costPoolId, costPool.id))
    .where(eq(costPool.organizationId, organizationId))
    .orderBy(costPool.code, desc(allocationRule.effectiveFrom));
}
