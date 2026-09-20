import type { AuditInput } from "../auth";

/**
 * Application-level ports and DTOs for slice-6 operating costs + labour +
 * allocation. The store is a narrow port over `@aquarela/persistence` so the
 * commands can be unit-tested against an in-memory fake; `createPostgresCostingStore`
 * is the real adapter. Record types are structural subsets of the persistence
 * rows; `date` columns are `yyyy-mm-dd` strings.
 *
 * One deliberate normalisation: `LaborRateRecord.loadedHourlyRate` is carried at
 * the domain loaded-rate scale (2 dp, `LOADED_RATE_SCALE`) even though the
 * `labor_rate.loaded_hourly_rate` column is `numeric(19,4)`. The adapter narrows
 * the stored money string, so the commands can hand it straight to the domain
 * labour primitives, which parse rates at 2 dp.
 */

export interface CostCenterRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly locationId: string | null;
  readonly code: string;
  readonly name: string;
  readonly kind: string;
}

export interface LocationRecord {
  readonly id: string;
  readonly organizationId: string;
}

export interface LaborRateRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly costCenterId: string;
  readonly roleCode: string;
  /** 2 dp (`LOADED_RATE_SCALE`), narrowed from the `numeric(19,4)` column. */
  readonly loadedHourlyRate: string;
  readonly productiveHoursPct: string | null;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}

export interface NewLaborRateRecord {
  readonly organizationId: string;
  readonly costCenterId: string;
  readonly roleCode: string;
  readonly loadedHourlyRate: string;
  readonly productiveHoursPct: string | null;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}

export interface OperatingCostRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly locationId: string | null;
  readonly costCenterId: string;
  readonly amount: string;
  readonly currency: string;
  readonly recurrence: string;
  readonly behavior: string;
  readonly taxBasis: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly vendor: string | null;
  readonly evidenceFileId: string | null;
}

export interface NewOperatingCostRecord {
  readonly organizationId: string;
  readonly locationId: string | null;
  readonly costCenterId: string;
  readonly amount: string;
  readonly currency: string;
  readonly recurrence: string;
  readonly behavior: string;
  readonly taxBasis: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly vendor: string | null;
  readonly evidenceFileId: string | null;
}

export interface CostPoolRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly code: string;
  readonly name: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}

export interface NewCostPoolRecord {
  readonly organizationId: string;
  readonly code: string;
  readonly name: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}

export interface AllocationRuleRecord {
  readonly id: string;
  readonly costPoolId: string;
  readonly driver: string;
  readonly scopeType: string;
  readonly denominatorSource: string;
  readonly fallbackBehavior: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}

export interface NewAllocationRuleRecord {
  readonly costPoolId: string;
  readonly driver: string;
  readonly scopeType: string;
  readonly denominatorSource: string;
  readonly fallbackBehavior: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}

export interface CostingStore {
  /** Binds `fn` to one transaction so the state change and its audit row commit together. */
  withTransaction<T>(fn: (store: CostingStore) => Promise<T>): Promise<T>;
  findCostCenter(costCenterId: string): Promise<CostCenterRecord | undefined>;
  findLocation(locationId: string): Promise<LocationRecord | undefined>;
  createLaborRate(input: NewLaborRateRecord): Promise<LaborRateRecord>;
  findEffectiveLaborRate(query: {
    readonly organizationId: string;
    readonly costCenterId: string;
    readonly roleCode: string;
    readonly asOf: Date;
  }): Promise<LaborRateRecord | undefined>;
  createOperatingCost(input: NewOperatingCostRecord): Promise<OperatingCostRecord>;
  listEffectiveOperatingCosts(query: {
    readonly organizationId: string;
    readonly asOf: Date;
    readonly locationId?: string | null;
    readonly costCenterId?: string | null;
  }): Promise<readonly OperatingCostRecord[]>;
  createCostPool(input: NewCostPoolRecord): Promise<CostPoolRecord>;
  findCostPool(costPoolId: string): Promise<CostPoolRecord | undefined>;
  /** Every version of one `cost_pool.code`, newest version first. */
  listCostPoolsByCode(organizationId: string, code: string): Promise<readonly CostPoolRecord[]>;
  createAllocationRule(input: NewAllocationRuleRecord): Promise<AllocationRuleRecord>;
  listEffectiveAllocationRules(query: {
    readonly organizationId: string;
    readonly asOf: Date;
    readonly costPoolId?: string;
  }): Promise<readonly AllocationRuleRecord[]>;
  /** Append-only audit fact; the caller must not pass secrets (ADR-0003 convention). */
  writeAudit(input: AuditInput): Promise<void>;
}
