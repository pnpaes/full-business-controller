import { DomainError } from "@aquarela/domain";

import { PRODUCT_AUDIT_ACTIONS } from "./actions";
import type { ProductStore } from "./types";

export interface AssignRecipeToVariantInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly productVariantId: string;
  readonly locationId: string;
  readonly recipeVersionId: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo?: Date | null;
}

export interface AssignRecipeToVariantResult {
  readonly assignmentId: string;
}

/** Half-open `[from, to)` windows overlap unless one ends at or before the other starts. */
function windowsOverlap(aFrom: Date, aTo: Date | null, bFrom: Date, bTo: Date | null): boolean {
  const aEnd = aTo === null ? Number.POSITIVE_INFINITY : aTo.getTime();
  const bEnd = bTo === null ? Number.POSITIVE_INFINITY : bTo.getTime();
  return aFrom.getTime() < bEnd && bFrom.getTime() < aEnd;
}

/**
 * Assigns an approved recipe version to a variant at a location (`DEC-128`),
 * effective for the half-open window `[effectiveFrom, effectiveTo)` (`null`
 * `effectiveTo` = open-ended). Validated at this boundary so an invalid row
 * never reaches the database:
 *
 * - the variant exists and belongs to the organization;
 * - the location exists and belongs to the organization;
 * - the recipe version exists, belongs to the organization (through its recipe)
 *   and is **approved** — a `draft` (or any non-approved state) is rejected; the
 *   version is not created here, only referenced;
 * - the window is `effectiveTo > effectiveFrom` when bounded;
 * - the window does not overlap an existing assignment for the same variant and
 *   location. The `pra_no_overlap` exclusion constraint is the backstop under
 *   concurrency; the Postgres adapter translates its violation into the same
 *   message-only `DomainError`.
 */
export async function assignRecipeToVariant(
  store: ProductStore,
  input: AssignRecipeToVariantInput,
): Promise<AssignRecipeToVariantResult> {
  const effectiveFrom = input.effectiveFrom;
  const effectiveTo = input.effectiveTo ?? null;
  if (effectiveTo !== null && effectiveTo.getTime() <= effectiveFrom.getTime()) {
    throw new DomainError("effectiveTo must be after effectiveFrom");
  }

  return store.withTransaction(async (tx) => {
    const variant = await tx.findVariant(input.productVariantId);
    if (variant === undefined || variant.organizationId !== input.organizationId) {
      throw new DomainError("product variant not found in this organization");
    }

    const location = await tx.findLocationScope(input.locationId);
    if (location === undefined || location.organizationId !== input.organizationId) {
      throw new DomainError("location not found in this organization");
    }

    const version = await tx.findRecipeVersionScope(input.recipeVersionId);
    if (version === undefined || version.organizationId !== input.organizationId) {
      throw new DomainError("recipe version not found in this organization");
    }
    if (version.state !== "approved") {
      throw new DomainError("recipe version must be approved before it can be assigned");
    }

    const existing = await tx.listRecipeAssignmentsForVariant(input.productVariantId);
    const overlapping = existing.some(
      (assignment) =>
        assignment.locationId === input.locationId &&
        windowsOverlap(
          effectiveFrom,
          effectiveTo,
          assignment.effectiveFrom,
          assignment.effectiveTo,
        ),
    );
    if (overlapping) {
      throw new DomainError(
        "an assignment for this variant and location is already effective in this window",
      );
    }

    const created = await tx.createRecipeAssignment({
      productVariantId: input.productVariantId,
      locationId: input.locationId,
      recipeVersionId: input.recipeVersionId,
      effectiveFrom,
      effectiveTo,
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: PRODUCT_AUDIT_ACTIONS.recipeAssigned,
      entityType: "product_recipe_assignment",
      entityId: created.id,
      after: {
        product_variant_id: input.productVariantId,
        location_id: input.locationId,
        recipe_version_id: input.recipeVersionId,
        effective_from: effectiveFrom.toISOString(),
        effective_to: effectiveTo === null ? null : effectiveTo.toISOString(),
      },
    });

    return { assignmentId: created.id };
  });
}
