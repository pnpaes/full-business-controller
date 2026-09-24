import { DomainError, QUANTITY_SCALE, parseDecimal } from "@aquarela/domain";

import { assertIsoInstant } from "../inventory/validation";
import { PRODUCTION_AUDIT_ACTIONS } from "./actions";
import {
  resolvePlannedSnapshot,
  scalePlannedSnapshot,
  type PlannedInputLine,
  type PlannedOutputLine,
  type PlannedSnapshot,
} from "./recipe-snapshot";
import type { ProductionRecipeVersionRecord, ProductionStore } from "./types";

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
   * `DEC-125`: the batch's intended output quantity (numeric(19,6)). When
   * supplied, the recipe version's planned snapshot is scaled by
   * `plannedQty / version.plannedOutputQty` (rounded once at B0) and stored on
   * `production_batch.planned_qty`. Omitted → the previous single-batch
   * behaviour, byte-identical to before this slice.
   */
  readonly plannedQty?: string | null;
  /**
   * `DEC-125`: create from a plan line. The line must belong to the organization
   * and the batch's plan, and its `recipe_version_id` must match the batch's
   * `recipeVersionId` (a mismatch or a foreign line is rejected). When supplied
   * without `plannedQty`, the line's planned quantity is used.
   */
  readonly planLineId?: string | null;
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
  /** `DEC-125`: the batch's intended output quantity, or null. */
  readonly plannedQty: string | null;
  readonly plannedInputs: readonly PlannedInputLine[];
  readonly plannedOutputs: readonly PlannedOutputLine[];
  readonly replayed: boolean;
}

/** Rejects a non-positive planned quantity; returns the validated string. */
function requirePositivePlannedQty(value: string): string {
  if (parseDecimal(value, QUANTITY_SCALE) <= 0n) {
    throw new DomainError("plannedQty must be positive");
  }
  return value;
}

async function plannedSnapshot(
  store: ProductionStore,
  input: {
    readonly organizationId: string;
    readonly version: ProductionRecipeVersionRecord;
    readonly asOf: Date;
    readonly plannedQty: string | null;
  },
): Promise<PlannedSnapshot> {
  const base = await resolvePlannedSnapshot(store, {
    organizationId: input.organizationId,
    version: input.version,
    asOf: input.asOf,
  });
  return input.plannedQty === null ? base : scalePlannedSnapshot(base, input.plannedQty);
}

/**
 * Creates a production batch against an **approved** recipe version (`PROD-001`):
 * enforces the approval (an unapproved/draft version is rejected, mirroring
 * `computeRecipeCost`'s COST-002 guard), resolves and validates the planned
 * snapshot from the recipe version (`DEC-031`), and persists the header with
 * `planned_output_qty` and status `planned`.
 *
 * `DEC-125`: an optional `plannedQty` scales the snapshot (see
 * `CreateProductionBatchInput`), and an optional `planLineId` links the batch to
 * a plan line after validating org/plan/version membership. With neither
 * supplied the behaviour is unchanged.
 *
 * The planned input/output **lines** are materialised at completion, not here:
 * the persistence repository exposes no batch-line update, so writing lines at
 * creation would leave them un-updatable (open point (i), reported). The snapshot
 * is nevertheless computed now — so a recipe that cannot be produced is rejected
 * at plan time — and returned for the caller/screen, then re-derived atomically
 * at completion from the immutable approved version.
 *
 * Everything runs in one transaction: the location/plan/line/storage-area checks,
 * the header and the audit fact.
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

    // `DEC-125`: resolve the plan, optionally through a plan line. A supplied
    // line fixes the plan and must match the batch's recipe version.
    let planId: string | null = input.planId ?? null;
    let plannedQty: string | null = input.plannedQty ?? null;
    if (input.planLineId !== undefined && input.planLineId !== null) {
      const line = await tx.findProductionPlanLine({
        organizationId: input.organizationId,
        planLineId: input.planLineId,
      });
      if (line === undefined) {
        throw new DomainError("production plan line not found in organization");
      }
      if (planId !== null && planId !== line.planId) {
        throw new DomainError("production plan line does not belong to the plan");
      }
      planId = line.planId;
      if (line.recipeVersionId !== input.recipeVersionId) {
        throw new DomainError("production plan line recipe version does not match the batch");
      }
      if (plannedQty === null) {
        plannedQty = line.plannedQty;
      }
    }
    if (plannedQty !== null) {
      requirePositivePlannedQty(plannedQty);
    }

    if (planId !== null) {
      const plan = await tx.findProductionPlan({
        organizationId: input.organizationId,
        productionPlanId: planId,
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
        const snapshot = await plannedSnapshot(tx, {
          organizationId: input.organizationId,
          version,
          asOf: existing.plannedStart === null ? new Date() : new Date(existing.plannedStart),
          plannedQty: existing.plannedQty,
        });
        return {
          productionBatchId: existing.id,
          status: existing.status,
          plannedOutputQty: existing.plannedOutputQty ?? snapshot.plannedOutputQty,
          plannedQty: existing.plannedQty,
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
    const snapshot = await plannedSnapshot(tx, {
      organizationId: input.organizationId,
      version,
      asOf,
      plannedQty,
    });

    const batch = await tx.createProductionBatch({
      organizationId: input.organizationId,
      locationId: input.locationId,
      workstation: input.workstation ?? null,
      recipeVersionId: version.id,
      planId,
      status: "planned",
      plannedStart: input.plannedStart ?? null,
      operatorId: input.operatorId ?? null,
      destinationStorageAreaId: input.destinationStorageAreaId ?? null,
      plannedQty,
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
        plan_id: planId,
        plan_line_id: input.planLineId ?? null,
        workstation: input.workstation ?? null,
        planned_qty: plannedQty,
        planned_output_qty: snapshot.plannedOutputQty,
        planned_input_count: snapshot.inputs.length,
      },
    });

    return {
      productionBatchId: batch.id,
      status: batch.status,
      plannedOutputQty: batch.plannedOutputQty ?? snapshot.plannedOutputQty,
      plannedQty: batch.plannedQty,
      plannedInputs: snapshot.inputs,
      plannedOutputs: snapshot.outputs,
      replayed: false,
    };
  });
}
