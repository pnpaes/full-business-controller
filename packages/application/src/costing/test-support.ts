import type { AuditInput } from "../auth";
import type {
  AllocationRuleRecord,
  CostCenterRecord,
  CostPoolRecord,
  CostingStore,
  LaborRateRecord,
  LocationRecord,
  NewAllocationRuleRecord,
  NewCostPoolRecord,
  NewLaborRateRecord,
  NewOperatingCostRecord,
  OperatingCostRecord,
} from "./types";

/** `date` columns are `yyyy-mm-dd`; the fake compares them as strings. */
const asOfDate = (asOf: Date): string => asOf.toISOString().slice(0, 10);

/** Half-open `[effectiveFrom, effectiveTo)`; mirrors `repositories/costing.ts` as the authority. */
const isEffective = (from: string, to: string | null, asOf: string): boolean =>
  from <= asOf && (to === null || asOf < to);

/**
 * In-memory `CostingStore` for the unit suite. It mirrors the observable contract
 * closely enough to exercise the commands without a database;
 * `costing.postgres.test.ts` covers the real adapter.
 */
export class FakeCostingStore implements CostingStore {
  readonly costCenters = new Map<string, CostCenterRecord>();
  readonly locations = new Map<string, LocationRecord>();
  readonly laborRates: LaborRateRecord[] = [];
  readonly operatingCosts: OperatingCostRecord[] = [];
  readonly costPools = new Map<string, CostPoolRecord>();
  readonly allocationRules: AllocationRuleRecord[] = [];
  readonly audits: AuditInput[] = [];

  private sequence = 0;

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }

  async withTransaction<T>(fn: (store: CostingStore) => Promise<T>): Promise<T> {
    return fn(this);
  }

  findCostCenter(costCenterId: string): Promise<CostCenterRecord | undefined> {
    return Promise.resolve(this.costCenters.get(costCenterId));
  }

  findLocation(locationId: string): Promise<LocationRecord | undefined> {
    return Promise.resolve(this.locations.get(locationId));
  }

  createLaborRate(input: NewLaborRateRecord): Promise<LaborRateRecord> {
    const record: LaborRateRecord = { id: this.nextId("labor-rate"), ...input };
    this.laborRates.push(record);
    return Promise.resolve(record);
  }

  findEffectiveLaborRate(query: {
    readonly organizationId: string;
    readonly costCenterId: string;
    readonly roleCode: string;
    readonly asOf: Date;
  }): Promise<LaborRateRecord | undefined> {
    const asOf = asOfDate(query.asOf);
    let newest: LaborRateRecord | undefined;
    for (const rate of this.laborRates) {
      if (
        rate.organizationId !== query.organizationId ||
        rate.costCenterId !== query.costCenterId ||
        rate.roleCode !== query.roleCode ||
        !isEffective(rate.effectiveFrom, rate.effectiveTo, asOf)
      ) {
        continue;
      }
      if (newest === undefined || rate.effectiveFrom >= newest.effectiveFrom) {
        newest = rate;
      }
    }
    return Promise.resolve(newest);
  }

  createOperatingCost(input: NewOperatingCostRecord): Promise<OperatingCostRecord> {
    const record: OperatingCostRecord = { id: this.nextId("operating-cost"), ...input };
    this.operatingCosts.push(record);
    return Promise.resolve(record);
  }

  listEffectiveOperatingCosts(query: {
    readonly organizationId: string;
    readonly asOf: Date;
    readonly locationId?: string | null;
    readonly costCenterId?: string | null;
  }): Promise<readonly OperatingCostRecord[]> {
    const asOf = asOfDate(query.asOf);
    return Promise.resolve(
      this.operatingCosts.filter((cost) => {
        if (cost.organizationId !== query.organizationId) {
          return false;
        }
        if (!isEffective(cost.effectiveFrom, cost.effectiveTo, asOf)) {
          return false;
        }
        if (query.locationId !== undefined && query.locationId !== null) {
          if (cost.locationId !== query.locationId) {
            return false;
          }
        }
        if (query.costCenterId !== undefined && query.costCenterId !== null) {
          if (cost.costCenterId !== query.costCenterId) {
            return false;
          }
        }
        return true;
      }),
    );
  }

  createCostPool(input: NewCostPoolRecord): Promise<CostPoolRecord> {
    const record: CostPoolRecord = { id: this.nextId("cost-pool"), ...input };
    this.costPools.set(record.id, record);
    return Promise.resolve(record);
  }

  findCostPool(costPoolId: string): Promise<CostPoolRecord | undefined> {
    return Promise.resolve(this.costPools.get(costPoolId));
  }

  listCostPoolsByCode(organizationId: string, code: string): Promise<readonly CostPoolRecord[]> {
    return Promise.resolve(
      [...this.costPools.values()]
        .filter((pool) => pool.organizationId === organizationId && pool.code === code)
        .sort((a, b) =>
          a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : 0,
        ),
    );
  }

  createAllocationRule(input: NewAllocationRuleRecord): Promise<AllocationRuleRecord> {
    const record: AllocationRuleRecord = { id: this.nextId("allocation-rule"), ...input };
    this.allocationRules.push(record);
    return Promise.resolve(record);
  }

  listEffectiveAllocationRules(query: {
    readonly organizationId: string;
    readonly asOf: Date;
    readonly costPoolId?: string;
  }): Promise<readonly AllocationRuleRecord[]> {
    const asOf = asOfDate(query.asOf);
    return Promise.resolve(
      this.allocationRules.filter((rule) => {
        const pool = this.costPools.get(rule.costPoolId);
        if (pool === undefined || pool.organizationId !== query.organizationId) {
          return false;
        }
        if (query.costPoolId !== undefined && rule.costPoolId !== query.costPoolId) {
          return false;
        }
        return isEffective(rule.effectiveFrom, rule.effectiveTo, asOf);
      }),
    );
  }

  writeAudit(input: AuditInput): Promise<void> {
    this.audits.push(input);
    return Promise.resolve();
  }
}
