import { DomainError } from "@aquarela/domain";

import { assertIsoInstant } from "../inventory/validation";
import { PRODUCTION_AUDIT_ACTIONS } from "./actions";
import {
  resolvePlannedSnapshot,
  type PlannedInputLine,
  type PlannedOutputLine,
} from "./recipe-snapshot";
import type { ProductionStore } from "./types";

export interface CreateProductionBatchInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly locationId: string;
  /** Must be an **approved** recipe version (`PROD-001`, COST-002). */
  readonly recipeVersionId: string;
  readonly planId?: string | null;
  readonly workstation?: string | null;
  /** ISO instant, optional. Also the effective date for unit conversion. */
  readonly plannedStart?: string | null;
  readonly operatorId?: string | null;
  /** Outputs' destination; nullable while no WIP area exists (open point (e)). */
  readonly destinationStorageAreaId?: string | null;
  /**
   * Optional deterministic batch id. Since `production_batch` has no natural key
   * (open point (a)), this is the slice's idempotency path: a replay of an
   * existing id returns that batch instead of creating a second one.
   */
  readonly productionBatchId?: string;
}

export interface CreateProductionBatchResult {
  readonly productionBatchId: string;
  readonly status: string;
  /** numeric(19,6), snapshotted from the recipe version onto the header. */
  readonly plannedOutputQty: string;
  readonly plannedInputs: readonly PlannedInputLine[];
  readonly plannedOutputs: readonly PlannedOutputLine[];
  readonly replayed: boolean;
}

/**
 * Creates a production batch against an **approved** recipe version (`PROD-001`):
 * enforces the approval (an unapproved/draft version is rejected, mirroring
 * `computeRecipeCost`'s COST-002 guard), resolves and validates the planned
 * snapshot from the recipe version (`DEC-031`), and persists the header with
 * `planned_output_qty` and status `planned`.
 *
 * The planned input/output **lines** are materialised at completion, not here:
 * the persistence repository exposes no batch-line update, so writing lines at
 * creation would leave them un-updatable (open point (i), reported). The snapshot
 * is nevertheless computed now — so a recipe that cannot be produced is rejected
 * at plan time — and returned for the caller/screen, then re-derived atomically
 * at completion from the immutable approved version.
 *
 * Everything runs in one transaction: the location/plan/storage-area checks, the
 * header and the audit fact.
 */
export async function createProductionBatch(
  store: ProductionStore,
  input: CreateProductionBatchInput,
): Promise<CreateProductionBatchResult> {
  if (input.plannedStart !== undefined && input.plannedStart !== null) {
    assertIsoInstant(input.plannedStart, "plannedStart");
  }

  return store.withTransaction(async (tx) => {
    const version = await tx.findRecipeVersion(input.recipeVersionId);
    if (version === undefined) {
      throw new DomainError("recipe version not found");
    }
    const recipe = await tx.findRecipe(version.recipeId);
    if (recipe === undefined || recipe.organizationId !== input.organizationId) {
      throw new DomainError("recipe not found in organization");
    }
    if (version.state !== "approved") {
      throw new DomainError(
        `recipe version must be approved to plan a batch (state is "${version.state}"): PROD-001`,
      );
    }

    const location = await tx.findLocation(input.locationId);
    if (location === undefined || location.organizationId !== input.organizationId) {
      throw new DomainError("location not found in organization");
    }

    if (input.planId !== undefined && input.planId !== null) {
      const plan = await tx.findProductionPlan({
        organizationId: input.organizationId,
        productionPlanId: input.planId,
      });
      if (plan === undefined) {
        throw new DomainError("production plan not found in organization");
      }
    }

    if (input.destinationStorageAreaId !== undefined && input.destinationStorageAreaId !== null) {
      const area = await tx.findStorageArea(input.destinationStorageAreaId);
      if (area === undefined || area.organizationId !== input.organizationId) {
        throw new DomainError("storage area not found in organization");
      }
      if (area.locationId !== input.locationId) {
        throw new DomainError("storage area does not belong to the location");
      }
    }

    if (input.productionBatchId !== undefined) {
      const existing = await tx.findProductionBatch({
        organizationId: input.organizationId,
        productionBatchId: input.productionBatchId,
      });
      if (existing !== undefined) {
        const snapshot = await resolvePlannedSnapshot(tx, {
          organizationId: input.organizationId,
          version,
          asOf: existing.plannedStart === null ? new Date() : new Date(existing.plannedStart),
        });
        return {
          productionBatchId: existing.id,
          status: existing.status,
          plannedOutputQty: existing.plannedOutputQty ?? snapshot.plannedOutputQty,
          plannedInputs: snapshot.inputs,
          plannedOutputs: snapshot.outputs,
          replayed: true,
        };
      }
    }

    const asOf =
      input.plannedStart === undefined || input.plannedStart === null
        ? new Date()
        : new Date(input.plannedStart);
    const snapshot = await resolvePlannedSnapshot(tx, {
      organizationId: input.organizationId,
      version,
      asOf,
    });

    const batch = await tx.createProductionBatch({
      organizationId: input.organizationId,
      locationId: input.locationId,
      workstation: input.workstation ?? null,
      recipeVersionId: version.id,
      planId: input.planId ?? null,
      status: "planned",
      plannedStart: input.plannedStart ?? null,
      operatorId: input.operatorId ?? null,
      destinationStorageAreaId: input.destinationStorageAreaId ?? null,
      plannedOutputQty: snapshot.plannedOutputQty,
      ...(input.productionBatchId === undefined ? {} : { id: input.productionBatchId }),
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: PRODUCTION_AUDIT_ACTIONS.batchCreated,
      entityType: "production_batch",
      entityId: batch.id,
      after: {
        location_id: input.locationId,
        recipe_version_id: version.id,
        plan_id: input.planId ?? null,
        workstation: input.workstation ?? null,
        planned_output_qty: snapshot.plannedOutputQty,
        planned_input_count: snapshot.inputs.length,
      },
    });

    return {
      productionBatchId: batch.id,
      status: batch.status,
      plannedOutputQty: batch.plannedOutputQty ?? snapshot.plannedOutputQty,
      plannedInputs: snapshot.inputs,
      plannedOutputs: snapshot.outputs,
      replayed: false,
    };
  });
}
