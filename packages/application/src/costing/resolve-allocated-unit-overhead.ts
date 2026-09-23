import {
  allocatedUnitOverhead,
  type AllocationFallback,
  DomainError,
  formatDecimal,
  MONEY_SCALE,
  parseDecimal,
} from "@aquarela/domain";

import type { AllocationRuleRecord, OperatingCostRecord } from "./types";

/**
 * `DEC-112` allocated unit overhead resolver. It links an `operating_cost` set to
 * a `cost_pool` (`operating_cost.cost_pool_id`), sums the linked costs whose
 * effective window **overlaps** the allocation period, resolves the driver
 * denominator from the pool's effective `allocation_rule.denominator_source`, and
 * divides:
 *
 * ```
 * pool_amount         = Σ linked operating_cost.amount                         # B-money, 4 dp
 * allocated_unit_overhead = allocatedUnitOverhead(pool_amount, total_driver_volume, {fallback})
 * ```
 *
 * `recurrence` is **not** scaled and `behavior` is **not** filtered (`DEC-112` —
 * owner/FIN still to define both). The `denominator_source` vocabulary is closed:
 * `explicit` uses the caller's volume, `eligible_products` counts the products
 * with an effective `price_version` at the location, and `equal_share` spreads
 * across that count. The volume-based sources (`revenue`, `transactions`,
 * `sales_units`, `production_*`) are **deferred** and fail closed.
 *
 * No effective rule = not resolved (`undefined`); more than one is ambiguous and
 * rejected. For `explicit`/`eligible_products` the entity and eligible volumes
 * coincide, so the per-driver-unit overhead is `pool_amount / total_driver_volume`.
 */
export interface ResolveAllocatedUnitOverheadInput {
  readonly organizationId: string;
  readonly costPoolId: string;
  readonly locationId: string;
  readonly asOf: Date;
  /** Half-open allocation period; defaults to the UTC calendar month containing `asOf`. */
  readonly periodFrom?: Date;
  readonly periodTo?: Date;
  /** Required when the rule's denominator_source is "explicit". */
  readonly explicitTotalDriverVolume?: string;
  /** Required when the rule's denominator_source is "equal_share". */
  readonly eligibleEntityCount?: string;
}

export interface ResolvedAllocatedUnitOverhead {
  readonly perUnitOverhead: string;
  readonly poolAmount: string;
  readonly totalDriverVolume: string;
  readonly denominatorSource: string;
  readonly fallbackUsed: string;
  readonly operatingCostIds: readonly string[];
}

const MONTH_START_UTC = (asOf: Date): { from: Date; to: Date } => {
  const year = asOf.getUTCFullYear();
  const month = asOf.getUTCMonth();
  return {
    from: new Date(Date.UTC(year, month, 1)),
    to: new Date(Date.UTC(year, month + 1, 1)),
  };
};

/** The `yyyy-mm-dd` of an instant, for comparing against `date`-typed windows. */
const asOfDate = (value: Date): string => value.toISOString().slice(0, 10);

export async function resolveAllocatedUnitOverhead(
  store: {
    listEffectiveOperatingCosts(query: {
      readonly organizationId: string;
      readonly asOf: Date;
      readonly costPoolId?: string | null;
    }): Promise<readonly OperatingCostRecord[]>;
    listEffectiveAllocationRules(query: {
      readonly organizationId: string;
      readonly asOf: Date;
      readonly costPoolId?: string;
    }): Promise<readonly AllocationRuleRecord[]>;
    countEligibleProducts(query: {
      readonly organizationId: string;
      readonly locationId: string;
      readonly asOf: Date;
    }): Promise<number>;
  },
  input: ResolveAllocatedUnitOverheadInput,
): Promise<ResolvedAllocatedUnitOverhead | undefined> {
  const rules = await store.listEffectiveAllocationRules({
    organizationId: input.organizationId,
    asOf: input.asOf,
    costPoolId: input.costPoolId,
  });
  if (rules.length === 0) {
    return undefined;
  }
  if (rules.length > 1) {
    throw new DomainError("ambiguous allocation rules for the cost pool at the requested date");
  }
  const rule = rules[0]!;

  const defaults = MONTH_START_UTC(input.asOf);
  const periodFrom = input.periodFrom ?? defaults.from;
  const periodTo = input.periodTo ?? defaults.to;
  if (
    !(periodFrom instanceof Date) ||
    Number.isNaN(periodFrom.getTime()) ||
    !(periodTo instanceof Date) ||
    Number.isNaN(periodTo.getTime())
  ) {
    throw new DomainError("the allocation period must be a pair of valid instants");
  }
  if (periodTo.getTime() <= periodFrom.getTime()) {
    throw new DomainError("periodTo must be after periodFrom");
  }

  const costs = await store.listEffectiveOperatingCosts({
    organizationId: input.organizationId,
    asOf: input.asOf,
    costPoolId: input.costPoolId,
  });
  const fromDate = asOfDate(periodFrom);
  const toDate = asOfDate(periodTo);
  // Half-open overlap against the date-typed operating-cost window (the
  // registerCostPool predicate), on top of the effective-at-asOf read.
  const linked = costs.filter(
    (cost) =>
      (cost.effectiveTo === null || cost.effectiveTo > fromDate) && cost.effectiveFrom < toDate,
  );

  let pool = 0n;
  for (const cost of linked) {
    pool += parseDecimal(cost.amount, MONEY_SCALE);
  }
  const poolAmount = formatDecimal(pool, MONEY_SCALE);

  const denominatorSource = rule.denominatorSource.trim();
  let totalDriverVolume: string;
  let perUnitOverhead: string;
  let fallbackUsed: string;

  switch (denominatorSource) {
    case "explicit": {
      const explicit = input.explicitTotalDriverVolume;
      if (explicit === undefined || explicit.trim().length === 0) {
        throw new DomainError(
          "explicitTotalDriverVolume is required when denominator_source is explicit (DEC-112)",
        );
      }
      totalDriverVolume = explicit;
      fallbackUsed = rule.fallbackBehavior;
      perUnitOverhead = allocatedUnitOverhead(poolAmount, totalDriverVolume, {
        fallback: rule.fallbackBehavior as AllocationFallback,
      });
      break;
    }
    case "eligible_products": {
      const count = await store.countEligibleProducts({
        organizationId: input.organizationId,
        locationId: input.locationId,
        asOf: input.asOf,
      });
      totalDriverVolume = String(count);
      fallbackUsed = rule.fallbackBehavior;
      perUnitOverhead = allocatedUnitOverhead(poolAmount, totalDriverVolume, {
        fallback: rule.fallbackBehavior as AllocationFallback,
      });
      break;
    }
    case "equal_share": {
      const supplied = input.eligibleEntityCount;
      const eligibleEntityCount =
        supplied ??
        String(
          await store.countEligibleProducts({
            organizationId: input.organizationId,
            locationId: input.locationId,
            asOf: input.asOf,
          }),
        );
      if (parseDecimal(eligibleEntityCount, 0) <= 0n) {
        throw new DomainError(
          "eligibleEntityCount is required and positive when denominator_source is equal_share (DEC-112)",
        );
      }
      totalDriverVolume = eligibleEntityCount;
      fallbackUsed = "equal_share";
      perUnitOverhead = allocatedUnitOverhead(poolAmount, "0", {
        fallback: "equal_share",
        eligibleEntityCount,
      });
      break;
    }
    default:
      // Volume-based sources are deferred (DEC-112): fail closed rather than guess.
      throw new DomainError(`unknown denominator_source "${rule.denominatorSource}" (DEC-112)`);
  }

  return {
    perUnitOverhead,
    poolAmount,
    totalDriverVolume,
    denominatorSource,
    fallbackUsed,
    operatingCostIds: linked.map((cost) => cost.id),
  };
}
