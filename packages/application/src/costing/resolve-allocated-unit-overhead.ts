import {
  allocatedUnitOverhead,
  type AllocationFallback,
  DomainError,
  normaliseRecurringCostsToPeriod,
  parseDecimal,
  QUANTITY_SCALE,
  recurringCostContributesToPeriod,
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
 * pool_amount         = Σ normaliseRecurringCostsToPeriod(linked costs, [from, to))  # B-money, 4 dp
 * allocated_unit_overhead = allocatedUnitOverhead(pool_amount, total_driver_volume, {fallback})
 * ```
 *
 * Each linked cost's `amount` is a per-recurrence-unit amount, so it is scaled
 * to the allocation period by `periodDays / nominalDays` (calendar-anchored at
 * `periodFrom`), summed exactly and rounded **once** at the pool boundary
 * (`DEC-115`); a `one_off` counts once, only in the period containing its
 * `effectiveFrom`. `behavior` is still **not** filtered and partial-window
 * proration is still deferred (`DEC-115` supersedes the `DEC-112`
 * "recurrence unscaled" note for the pool amount). The `denominator_source`
 * vocabulary is closed:
 * `explicit` uses the caller's volume, `eligible_products` counts the products
 * with an effective `price_version` at the location, and `equal_share` spreads
 * across that count. The period-scoped sales volume supplies `revenue`
 * (Σ net sales), `transactions` (distinct transaction count) and `sales_units`
 * (Σ line quantity) via `sumSalesVolume` (`DEC-114`). The production/time sources
 * (`production_hours`, `production_minutes`, `recorded_time`, `operating_hours`)
 * are **deferred** and fail closed.
 *
 * A volume denominator always forces `stop` semantics: `equal_share` needs an
 * eligible-entity set that a volume driver does not define, so the rule's
 * `fallback_behavior` is ignored for `revenue`/`transactions`/`sales_units`
 * (rejecting the combination at registration is the deferred alternative,
 * `DEC-114`).
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
  /**
   * The linked costs that **contributed** to the pool, not every linked cost:
   * a cost whose period-scaled contribution is zero (a `one_off` outside
   * `[periodFrom, periodTo)`, or a zero amount) is excluded. `poolAmount` is the
   * period-scaled sum of the same set (`DEC-115`).
   */
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
    /** `DEC-114`: the half-open `[from, to)` period sales volume for one location. */
    sumSalesVolume(query: {
      readonly organizationId: string;
      readonly locationId: string;
      readonly from: string;
      readonly to: string;
    }): Promise<{
      readonly revenue: string;
      readonly transactions: string;
      readonly units: string;
    }>;
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

  const poolCosts = linked.map((cost) => ({
    cost,
    normalisable: {
      amount: cost.amount,
      recurrence: cost.recurrence,
      effectiveFrom: cost.effectiveFrom,
    },
  }));
  const poolAmount = normaliseRecurringCostsToPeriod({
    costs: poolCosts.map((entry) => entry.normalisable),
    periodFrom: fromDate,
    periodTo: toDate,
  });
  // Only a cost with a non-zero scaled contribution is a pool member: a
  // `one_off` outside its period scales to 0 and is excluded (DEC-115).
  const operatingCostIds = poolCosts
    .filter((entry) => recurringCostContributesToPeriod(entry.normalisable, fromDate, toDate))
    .map((entry) => entry.cost.id);

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
    case "revenue":
    case "transactions":
    case "sales_units": {
      const volume = await store.sumSalesVolume({
        organizationId: input.organizationId,
        locationId: input.locationId,
        from: periodFrom.toISOString(),
        to: periodTo.toISOString(),
      });
      // `equal_share` needs an eligible-entity set a volume driver does not
      // define, so a volume denominator always forces `stop` semantics rather
      // than the rule's `fallback_behavior` (DEC-114); rejecting the
      // combination at registration is the deferred alternative.
      const raw =
        denominatorSource === "revenue"
          ? volume.revenue
          : denominatorSource === "transactions"
            ? volume.transactions
            : volume.units;
      // ponytail: every volume is validated at QUANTITY_SCALE (6 dp) ≥ the money scale, so the guard
      // is permissive rather than exact. The only producer, `sumSalesVolume`, casts to numeric(19,4)
      // / integer, so the ceiling is unreachable today; a non-cast producer must validate `revenue`
      // at MONEY_SCALE, `transactions` at scale 0 and `sales_units` at QUANTITY_SCALE.
      if (parseDecimal(raw, QUANTITY_SCALE) <= 0n) {
        throw new DomainError(
          `no ${denominatorSource} denominator for allocation rule "${rule.id}" (DEC-114)`,
        );
      }
      totalDriverVolume = raw;
      fallbackUsed = "stop";
      perUnitOverhead = allocatedUnitOverhead(poolAmount, totalDriverVolume, {
        fallback: "stop",
      });
      break;
    }
    default:
      // Production/time sources are deferred (DEC-112/DEC-114): fail closed
      // rather than guess.
      throw new DomainError(`unknown denominator_source "${rule.denominatorSource}" (DEC-112)`);
  }

  return {
    perUnitOverhead,
    poolAmount,
    totalDriverVolume,
    denominatorSource,
    fallbackUsed,
    operatingCostIds,
  };
}
