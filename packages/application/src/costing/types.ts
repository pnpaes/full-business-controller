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

export interface ChannelRecord {
  readonly id: string;
  readonly organizationId: string;
}

/**
 * A `channel_fee_rule` row (`DEC-112`): one fee effective for a channel over a
 * half-open `[effectiveFrom, effectiveTo)` **timestamptz** window. A percentage
 * kind (`commission_pct`/`processing_pct`) carries `percentageRate` and a null
 * `fixedAmount`; a fixed kind (`fixed_per_order`/`delivery_subsidy`/
 * `discount_funding`) carries `fixedAmount` and a null `percentageRate` (the DB
 * `channel_fee_rule_amount_kind_check`).
 */
export interface ChannelFeeRuleRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly channelId: string;
  readonly feeKind: string;
  readonly percentageRate: string | null;
  readonly fixedAmount: string | null;
  readonly feeBasis: string;
  readonly taxRuleId: string | null;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
}

export interface NewChannelFeeRuleRecord {
  readonly organizationId: string;
  readonly channelId: string;
  readonly feeKind: string;
  readonly percentageRate: string | null;
  readonly fixedAmount: string | null;
  readonly feeBasis: string;
  readonly taxRuleId: string | null;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
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
  readonly costPoolId: string | null;
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
  readonly costPoolId: string | null;
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
  findChannel(channelId: string): Promise<ChannelRecord | undefined>;
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
    readonly costPoolId?: string | null;
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
  /**
   * Every `channel_fee_rule` for one channel (all windows, newest first) — the
   * read-then-write overlap check behind `registerChannelFeeRule`; the
   * `channel_fee_rule_no_overlap` exclusion constraint stays the authority.
   */
  listChannelFeeRulesByChannel(
    organizationId: string,
    channelId: string,
  ): Promise<readonly ChannelFeeRuleRecord[]>;
  /** Fee rules effective at `asOf` for one channel (half-open tstz window). */
  listEffectiveChannelFeeRules(query: {
    readonly organizationId: string;
    readonly channelId: string;
    readonly asOf: Date;
  }): Promise<readonly ChannelFeeRuleRecord[]>;
  createChannelFeeRule(input: NewChannelFeeRuleRecord): Promise<ChannelFeeRuleRecord>;
  /** Append-only audit fact; the caller must not pass secrets (ADR-0003 convention). */
  writeAudit(input: AuditInput): Promise<void>;
}
