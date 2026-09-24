import { DomainError, QUANTITY_SCALE, parseDecimal } from "@aquarela/domain";

import { assertIsoDate } from "../costing/validation";
import { PRODUCTION_AUDIT_ACTIONS } from "./actions";
import type { ProductionStore } from "./types";

/** One plan line to write (`DEC-125`): an approved version and a positive qty. */
export interface CreateProductionPlanLineInput {
  readonly recipeVersionId: string;
  /** numeric(19,6), strictly positive. */
  readonly plannedQty: string;
}

export interface CreateProductionPlanInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly locationId: string;
  /** `yyyy-mm-dd` (`production_plan.production_date`). */
  readonly productionDate: string;
  /** Stored as given; no vocabulary authority pins the plan states (open point (f)). */
  readonly status?: string;
  /**
   * `DEC-125`: optional plan lines. Each recipe version must belong to the
   * organization and carry a positive planned quantity; the lines are written in
   * the same transaction as the header.
   */
  readonly lines?: readonly CreateProductionPlanLineInput[];
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
 * Creates a production-plan **header** (`PROD-001`; DATA_DICTIONARY §7) with
 * optional lines (`DEC-125`). The plan is a dated container: `createProductionBatch`
 * links a batch to it via `plan_id`, optionally through a plan line.
 *
 * The status is stored exactly as given (default `planned`); the plan has no
 * status vocabulary authority, so no check is enforced here either. Everything
 * runs in one transaction with the org-scoped location check, the org-scoped
 * recipe-version checks and the audit fact.
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

    // `DEC-125`: validate every line's version belongs to the organization and
    // its quantity is positive, then write the lines in the same transaction.
    for (const line of input.lines ?? []) {
      if (parseDecimal(line.plannedQty, QUANTITY_SCALE) <= 0n) {
        throw new DomainError("plannedQty must be positive");
      }
      const version = await tx.findRecipeVersion(line.recipeVersionId);
      if (version === undefined) {
        throw new DomainError("recipe version not found in organization");
      }
      const recipe = await tx.findRecipe(version.recipeId);
      if (recipe === undefined || recipe.organizationId !== input.organizationId) {
        throw new DomainError("recipe version not found in organization");
      }
      await tx.createProductionPlanLine({
        organizationId: input.organizationId,
        planId: plan.id,
        recipeVersionId: version.id,
        plannedQty: line.plannedQty,
      });
    }

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
        line_count: (input.lines ?? []).length,
      },
    });

    return { productionPlanId: plan.id, status: plan.status, replayed: false };
  });
}
