import { DomainError, MONEY_SCALE, normalizeCurrency, parseDecimal } from "@aquarela/domain";
import { COST_BEHAVIOR, OPERATING_COST_RECURRENCE, TAX_BASIS } from "@aquarela/persistence";

import { COSTING_AUDIT_ACTIONS } from "./actions";
import type { CostingStore } from "./types";
import { assertEffectiveRange } from "./validation";

const RECURRENCES: readonly string[] = OPERATING_COST_RECURRENCE;
const BEHAVIORS: readonly string[] = COST_BEHAVIOR;
const TAX_BASES: readonly string[] = TAX_BASIS;

export interface RegisterOperatingCostInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly costCenterId: string;
  readonly locationId?: string | null;
  /** `DEC-112`: links this cost to a shared `cost_pool` for allocation. */
  readonly costPoolId?: string | null;
  readonly amount: string;
  /** Defaults to `NOK`. */
  readonly currency?: string;
  readonly recurrence: string;
  readonly behavior: string;
  readonly taxBasis: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | null;
  readonly vendor?: string | null;
  readonly evidenceFileId?: string | null;
}

export interface RegisterOperatingCostResult {
  readonly operatingCostId: string;
}

/**
 * Registers one operating-cost fact (COST-003, `DATA_DICTIONARY` §4). Vocabulary,
 * amount and effective-window checks run before the transaction; the cost centre
 * and the optional location are org-checked inside it, then the row and its audit
 * fact commit together.
 */
export async function registerOperatingCost(
  store: CostingStore,
  input: RegisterOperatingCostInput,
): Promise<RegisterOperatingCostResult> {
  if (!RECURRENCES.includes(input.recurrence)) {
    throw new DomainError(`recurrence must be one of ${RECURRENCES.join(", ")}`);
  }
  if (!BEHAVIORS.includes(input.behavior)) {
    throw new DomainError(`behavior must be one of ${BEHAVIORS.join(", ")}`);
  }
  if (!TAX_BASES.includes(input.taxBasis)) {
    throw new DomainError(`taxBasis must be one of ${TAX_BASES.join(", ")}`);
  }
  if (parseDecimal(input.amount, MONEY_SCALE) < 0n) {
    throw new DomainError("amount must not be negative");
  }
  const currency = normalizeCurrency(input.currency ?? "NOK");
  const effectiveTo = input.effectiveTo ?? null;
  assertEffectiveRange(input.effectiveFrom, effectiveTo);
  const locationId = input.locationId ?? null;
  const costPoolId = input.costPoolId ?? null;

  return store.withTransaction(async (tx) => {
    const costCenter = await tx.findCostCenter(input.costCenterId);
    if (costCenter === undefined || costCenter.organizationId !== input.organizationId) {
      throw new DomainError("cost center not found in organization");
    }
    if (locationId !== null) {
      const location = await tx.findLocation(locationId);
      if (location === undefined || location.organizationId !== input.organizationId) {
        throw new DomainError("location not found in organization");
      }
    }
    if (costPoolId !== null) {
      const pool = await tx.findCostPool(costPoolId);
      if (pool === undefined || pool.organizationId !== input.organizationId) {
        throw new DomainError("cost pool not found in organization");
      }
    }

    const created = await tx.createOperatingCost({
      organizationId: input.organizationId,
      locationId,
      costCenterId: input.costCenterId,
      costPoolId,
      amount: input.amount,
      currency,
      recurrence: input.recurrence,
      behavior: input.behavior,
      taxBasis: input.taxBasis,
      effectiveFrom: input.effectiveFrom,
      effectiveTo,
      vendor: input.vendor ?? null,
      evidenceFileId: input.evidenceFileId ?? null,
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: COSTING_AUDIT_ACTIONS.operatingCostRegistered,
      entityType: "operating_cost",
      entityId: created.id,
      after: {
        cost_center_id: input.costCenterId,
        location_id: locationId,
        cost_pool_id: costPoolId,
        amount: input.amount,
        recurrence: input.recurrence,
        behavior: input.behavior,
        tax_basis: input.taxBasis,
      },
    });

    return { operatingCostId: created.id };
  });
}
