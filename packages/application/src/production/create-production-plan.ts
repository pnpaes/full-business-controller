import { DomainError } from "@aquarela/domain";

import { assertIsoDate } from "../costing/validation";
import { PRODUCTION_AUDIT_ACTIONS } from "./actions";
import type { ProductionStore } from "./types";

export interface CreateProductionPlanInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly locationId: string;
  /** `yyyy-mm-dd` (`production_plan.production_date`). */
  readonly productionDate: string;
  /** Stored as given; no vocabulary authority pins the plan states (open point (f)). */
  readonly status?: string;
  /**
   * Optional deterministic id. A replay of an existing id returns that plan
   * unchanged (`replayed: true`) instead of creating a second plan — the only
   * idempotency path, since `production_plan` has no natural key (open point (a)).
   */
  readonly productionPlanId?: string;
}

export interface CreateProductionPlanResult {
  readonly productionPlanId: string;
  readonly status: string;
  readonly replayed: boolean;
}

/**
 * Creates a production-plan **header** (`PROD-001`; DATA_DICTIONARY §7).
 * `production_plan` has no line/quantity table (open point (f)), so the plan is
 * a dated container: `createProductionBatch` links a batch to it via `plan_id`.
 *
 * The status is stored exactly as given (default `planned`); the plan has no
 * status vocabulary authority, so no check is enforced here either. Everything
 * runs in one transaction with the org-scoped location check and the audit fact.
 */
export async function createProductionPlan(
  store: ProductionStore,
  input: CreateProductionPlanInput,
): Promise<CreateProductionPlanResult> {
  assertIsoDate(input.productionDate, "productionDate");
  const status = input.status ?? "planned";

  return store.withTransaction(async (tx) => {
    const location = await tx.findLocation(input.locationId);
    if (location === undefined || location.organizationId !== input.organizationId) {
      throw new DomainError("location not found in organization");
    }

    if (input.productionPlanId !== undefined) {
      const existing = await tx.findProductionPlan({
        organizationId: input.organizationId,
        productionPlanId: input.productionPlanId,
      });
      if (existing !== undefined) {
        return { productionPlanId: existing.id, status: existing.status, replayed: true };
      }
    }

    const plan = await tx.createProductionPlan({
      organizationId: input.organizationId,
      locationId: input.locationId,
      productionDate: input.productionDate,
      status,
      createdBy: input.actorId,
      ...(input.productionPlanId === undefined ? {} : { id: input.productionPlanId }),
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: PRODUCTION_AUDIT_ACTIONS.planCreated,
      entityType: "production_plan",
      entityId: plan.id,
      after: {
        location_id: input.locationId,
        production_date: input.productionDate,
        status,
      },
    });

    return { productionPlanId: plan.id, status: plan.status, replayed: false };
  });
}
