import { and, desc, eq, gt, isNull, lte, or } from "drizzle-orm";

import type { Database } from "../client";
import { allocationRule, costPool, laborRate, operatingCost } from "../schema";

export type OperatingCost = typeof operatingCost.$inferSelect;
export type NewOperatingCost = typeof operatingCost.$inferInsert;
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

export interface EffectiveOperatingCostQuery {
  readonly organizationId: string;
  readonly asOf: Date;
  readonly locationId?: string | null;
  readonly costCenterId?: string | null;
}

/**
 * Operating costs effective at `asOf` (half-open window). `locationId` and
 * `costCenterId` are optional filters: passing null or absent does not narrow
 * the set (a null location means a company-shared cost, not "no location").
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
