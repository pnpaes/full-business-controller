import { DomainError } from "@aquarela/domain";
import {
  ALLOCATION_DENOMINATOR_SOURCE,
  ALLOCATION_DRIVER,
  ALLOCATION_FALLBACK,
  SCOPE_TYPE,
} from "@aquarela/persistence";

import { COSTING_AUDIT_ACTIONS } from "./actions";
import type { CostingStore } from "./types";
import { assertEffectiveRange } from "./validation";

const DRIVERS: readonly string[] = ALLOCATION_DRIVER;
const SCOPE_TYPES: readonly string[] = SCOPE_TYPE;
const FALLBACKS: readonly string[] = ALLOCATION_FALLBACK;
const DENOMINATOR_SOURCES: readonly string[] = ALLOCATION_DENOMINATOR_SOURCE;

export interface RegisterAllocationRuleInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly costPoolId: string;
  readonly driver: string;
  readonly scopeType: string;
  readonly denominatorSource: string;
  /** Defaults to `stop` (never divide silently, §12.6). */
  readonly fallbackBehavior?: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | null;
}

export interface RegisterAllocationRuleResult {
  readonly allocationRuleId: string;
}

/**
 * Registers one allocation rule on a cost pool (COST-007/011). The vocabulary,
 * denominator-source and effective-window checks run before the transaction; the
 * cross-entity pool check runs inside it. A pool's only own `organization_id`
 * lives on `cost_pool`, so the org scope is enforced through the pool lookup.
 */
export async function registerAllocationRule(
  store: CostingStore,
  input: RegisterAllocationRuleInput,
): Promise<RegisterAllocationRuleResult> {
  if (!DRIVERS.includes(input.driver)) {
    throw new DomainError(`driver must be one of ${DRIVERS.join(", ")}`);
  }
  if (!SCOPE_TYPES.includes(input.scopeType)) {
    throw new DomainError(`scopeType must be one of ${SCOPE_TYPES.join(", ")}`);
  }
  const fallbackBehavior = input.fallbackBehavior ?? "stop";
  if (!FALLBACKS.includes(fallbackBehavior)) {
    throw new DomainError(`fallbackBehavior must be one of ${FALLBACKS.join(", ")}`);
  }
  const denominatorSource = input.denominatorSource.trim();
  if (!DENOMINATOR_SOURCES.includes(denominatorSource)) {
    throw new DomainError(`denominatorSource must be one of ${DENOMINATOR_SOURCES.join(", ")}`);
  }
  const effectiveTo = input.effectiveTo ?? null;
  assertEffectiveRange(input.effectiveFrom, effectiveTo);

  return store.withTransaction(async (tx) => {
    const pool = await tx.findCostPool(input.costPoolId);
    if (pool === undefined || pool.organizationId !== input.organizationId) {
      throw new DomainError("cost pool not found in organization");
    }

    const created = await tx.createAllocationRule({
      costPoolId: input.costPoolId,
      driver: input.driver,
      scopeType: input.scopeType,
      denominatorSource,
      fallbackBehavior,
      effectiveFrom: input.effectiveFrom,
      effectiveTo,
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: COSTING_AUDIT_ACTIONS.allocationRuleRegistered,
      entityType: "allocation_rule",
      entityId: created.id,
      after: {
        cost_pool_id: input.costPoolId,
        driver: input.driver,
        scope_type: input.scopeType,
        denominator_source: denominatorSource,
        fallback_behavior: fallbackBehavior,
      },
    });

    return { allocationRuleId: created.id };
  });
}
