import { DomainError } from "@aquarela/domain";

import { RECIPE_AUDIT_ACTIONS } from "./actions";
import type { RecipeStore } from "./types";

export interface RegisterRecipeInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly code: string;
  readonly name: string;
  /**
   * The item the recipe produces (DEC-030). Null for a made-to-order recipe
   * whose output is not stocked; required for a recipe used as a sub-recipe.
   */
  readonly outputItemId?: string | null;
}

export interface RegisterRecipeResult {
  readonly recipeId: string;
}

/**
 * Registers a recipe identity (stable `code`/`name` + optional output item).
 * The organization-scoped duplicate check and the insert share one transaction;
 * the unique constraint is the concurrency authority.
 */
export async function registerRecipe(
  store: RecipeStore,
  input: RegisterRecipeInput,
): Promise<RegisterRecipeResult> {
  const code = input.code.trim();
  const name = input.name.trim();
  if (code.length === 0) {
    throw new DomainError("recipe code must not be empty");
  }
  if (name.length === 0) {
    throw new DomainError("recipe name must not be empty");
  }
  const outputItemId = input.outputItemId ?? null;

  return store.withTransaction(async (tx) => {
    if (outputItemId !== null) {
      const item = await tx.findItem(outputItemId);
      if (item === undefined || item.organizationId !== input.organizationId) {
        throw new DomainError("recipe output item not found in organization");
      }
    }
    const existing = await tx.findRecipeByCode(input.organizationId, code);
    if (existing !== undefined) {
      throw new DomainError("recipe code already registered for this organization");
    }
    const created = await tx.createRecipe({
      organizationId: input.organizationId,
      code,
      name,
      outputItemId,
    });
    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: RECIPE_AUDIT_ACTIONS.recipeRegistered,
      entityType: "recipe",
      entityId: created.id,
      after: { code, name, output_item_id: outputItemId },
    });
    return { recipeId: created.id };
  });
}
