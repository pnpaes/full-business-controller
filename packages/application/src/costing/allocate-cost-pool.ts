import {
  allocatedPoolAmount,
  allocatedUnitOverhead,
  type AllocationFallback,
  DomainError,
  entityDriverShare,
} from "@aquarela/domain";

import type { CostingStore } from "./types";

export interface AllocateCostPoolInput {
  readonly organizationId: string;
  readonly costPoolId: string;
  readonly asOf: Date;
  readonly periodCostPoolAmount: string;
  readonly entityDriverVolume: string;
  readonly totalDriverVolume: string;
  /** Pass `"0"` for a missing denominator — it is never invented (§12.6). */
  readonly eligibleDriverVolume: string;
  /** Required when the rule's fallback is `equal_share`. */
  readonly eligibleEntityCount?: string;
}

export interface AllocateCostPoolResult {
  readonly driver: string;
  readonly denominatorSource: string;
  readonly entityDriverShare: string;
  readonly allocatedPoolAmount: string;
  readonly allocatedUnitOverhead: string;
  /** The rule's configured fallback (`stop` or `equal_share`). */
  readonly fallbackUsed: string;
}

/**
 * Allocates one period's cost-pool amount to an entity via the pool's effective
 * allocation rule (COST-007/011, CALCULATION_CONTRACT §9): the driver share and
 * the allocated amount cross their boundary once each (HALF_UP), then the unit
 * overhead divides by the eligible volume under the rule's configured fallback.
 * Exactly one rule must be effective — zero or several is a data-integrity
 * failure, never a silent pick.
 */
export async function allocateCostPool(
  store: CostingStore,
  input: AllocateCostPoolInput,
): Promise<AllocateCostPoolResult> {
  const rules = await store.listEffectiveAllocationRules({
    organizationId: input.organizationId,
    asOf: input.asOf,
    costPoolId: input.costPoolId,
  });
  if (rules.length === 0) {
    throw new DomainError("no allocation rule effective for the cost pool at the requested date");
  }
  if (rules.length > 1) {
    throw new DomainError("ambiguous allocation rules for the cost pool at the requested date");
  }
  const rule = rules[0]!;

  const share = entityDriverShare(input.entityDriverVolume, input.totalDriverVolume);
  const allocated = allocatedPoolAmount(
    input.periodCostPoolAmount,
    input.entityDriverVolume,
    input.totalDriverVolume,
  );
  const overhead = allocatedUnitOverhead(allocated, input.eligibleDriverVolume, {
    fallback: rule.fallbackBehavior as AllocationFallback,
    ...(input.eligibleEntityCount === undefined
      ? {}
      : { eligibleEntityCount: input.eligibleEntityCount }),
  });

  return {
    driver: rule.driver,
    denominatorSource: rule.denominatorSource,
    entityDriverShare: share,
    allocatedPoolAmount: allocated,
    allocatedUnitOverhead: overhead,
    fallbackUsed: rule.fallbackBehavior,
  };
}
