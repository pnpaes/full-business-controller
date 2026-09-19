import { DomainError, selectEffectiveRecipeVersion } from "@aquarela/domain";

import type {
  RecipeAllergenRecordView,
  RecipeLineRecord,
  RecipeRecord,
  RecipeStore,
  RecipeVersionRecord,
} from "./types";

export interface LoadRecipeVersionInput {
  readonly organizationId: string;
  readonly recipeId: string;
  readonly asOf: Date;
}

export interface LoadedRecipeVersion {
  readonly recipe: RecipeRecord;
  readonly version: RecipeVersionRecord;
  readonly lines: readonly RecipeLineRecord[];
  readonly allergens: readonly RecipeAllergenRecordView[];
}

/**
 * Loads the recipe version effective at `asOf` (half-open window) with its lines
 * and allergen declarations. Overlapping windows or a missing version are
 * rejected rather than guessed.
 *
 * This is a **read** and deliberately edition-agnostic: any state is returned,
 * including `draft`, `submitted`, `rejected` and `retired`, because viewing a
 * draft alongside its lines and allergens is a legitimate operation. It does not
 * filter to `approved`; callers that require an approved version must filter on
 * `version.state` themselves. Costing does not use this loader:
 * `computeRecipeCost` reads the version directly and enforces its own
 * approved-state guard.
 */
export async function loadRecipeVersionAsOf(
  store: RecipeStore,
  input: LoadRecipeVersionInput,
): Promise<LoadedRecipeVersion> {
  const recipe = await store.findRecipe(input.recipeId);
  if (recipe === undefined || recipe.organizationId !== input.organizationId) {
    throw new DomainError("recipe not found in organization");
  }
  const version = selectEffectiveRecipeVersion(
    await store.listRecipeVersions(input.recipeId),
    input.asOf,
  );
  if (version === undefined) {
    throw new DomainError("no recipe version is effective at the requested date");
  }
  const [lines, allergens] = await Promise.all([
    store.listRecipeLines(version.id),
    store.listRecipeAllergens(version.id),
  ]);
  return { recipe, version, lines, allergens };
}
