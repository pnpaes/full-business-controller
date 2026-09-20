import { DomainError, NotFoundError, selectEffectiveRecipeVersion } from "@aquarela/domain";

import { computeRecipeCost, type RecipeCostComponent } from "./compute-recipe-cost";
import type {
  RecipeAllergenRecordView,
  RecipeLineRecord,
  RecipeRecord,
  RecipeStore,
  RecipeVersionRecord,
} from "./types";

/**
 * Read services for the recipe editor surface (`08_UI_UX.md` §8.3): list, detail
 * and cost preview. Costing is **not** reimplemented here — the preview delegates
 * to `computeRecipeCost`, which already owns the §6 formula, the DEC-047 cost
 * source precedence and the approved-version guard.
 */

/** Page size applied when the caller omits `limit`. */
export const DEFAULT_RECIPE_LIST_LIMIT = 50;
/** Upper bound on a requested page size (keeps one request bounded). */
export const MAX_RECIPE_LIST_LIMIT = 100;

export interface ListRecipesInput {
  readonly organizationId: string;
  readonly search?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface GetRecipeInput {
  readonly organizationId: string;
  readonly recipeId: string;
  /** Cost-preview as-of instant; defaults to now. */
  readonly asOf?: Date;
}

export interface GetRecipeCostPreviewInput {
  readonly organizationId: string;
  readonly recipeId: string;
  /** Cost-preview as-of instant; defaults to now. */
  readonly asOf?: Date;
}

/**
 * The cost preview for the version that would be costed. `available: false` is a
 * normal outcome, not an error: a recipe with no approved version, or a version
 * whose components have no resolvable cost, still has to render.
 */
export type RecipeCostPreview =
  | {
      readonly available: true;
      readonly recipeVersionId: string;
      readonly versionNo: number;
      readonly state: string;
      readonly currency: string;
      readonly yieldRate: string;
      readonly recipeInputCost: string;
      readonly recipeOutputCost: string;
      readonly costPerUsableOutputUnit: string;
      readonly components: readonly RecipeCostComponent[];
    }
  | {
      readonly available: false;
      readonly recipeVersionId: string | null;
      readonly versionNo: number | null;
      readonly state: string | null;
      readonly reason: string;
    };

/** One version with the nested lines and allergen declarations the editor shows. */
export interface RecipeVersionSummary {
  readonly version: RecipeVersionRecord;
  readonly lines: readonly RecipeLineRecord[];
  readonly allergens: readonly RecipeAllergenRecordView[];
}

export interface ListedRecipe {
  readonly recipe: RecipeRecord;
  readonly latestVersion: RecipeVersionRecord | null;
  readonly costPreview: RecipeCostPreview;
}

export interface RecipeDetail {
  readonly recipe: RecipeRecord;
  /** Newest first (`version_no` descending). */
  readonly versions: readonly RecipeVersionSummary[];
  readonly costPreview: RecipeCostPreview;
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_RECIPE_LIST_LIMIT;
  }
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_RECIPE_LIST_LIMIT);
}

/** The highest `version_no`, or `undefined` for an empty list. */
function latestByVersionNo(
  versions: readonly RecipeVersionRecord[],
): RecipeVersionRecord | undefined {
  return versions.reduce<RecipeVersionRecord | undefined>(
    (newest, version) =>
      newest === undefined || version.versionNo > newest.versionNo ? version : newest,
    undefined,
  );
}

/**
 * The approved version effective at `asOf`, falling back to the latest approved
 * version, then to the latest version of any state (so an unapproved-only recipe
 * can report *why* it has no cost). An overlap between approved windows is
 * swallowed here rather than thrown: choosing a preview version must not fail the
 * read, and `computeRecipeCost` re-derives the cost regardless.
 */
function choosePreviewVersion(
  versions: readonly RecipeVersionRecord[],
  asOf: Date,
): RecipeVersionRecord | undefined {
  const approved = versions.filter((version) => version.state === "approved");
  let effective: RecipeVersionRecord | undefined;
  try {
    effective = selectEffectiveRecipeVersion(approved, asOf);
  } catch {
    effective = undefined;
  }
  return effective ?? latestByVersionNo(approved) ?? latestByVersionNo(versions);
}

/** Cost preview for a recipe whose versions are already loaded (no second find). */
async function previewFor(
  store: RecipeStore,
  recipe: RecipeRecord,
  versions: readonly RecipeVersionRecord[],
  asOf: Date,
): Promise<RecipeCostPreview> {
  const version = choosePreviewVersion(versions, asOf);
  if (version === undefined) {
    return {
      available: false,
      recipeVersionId: null,
      versionNo: null,
      state: null,
      reason: "this recipe has no versions yet",
    };
  }
  if (version.state !== "approved") {
    return {
      available: false,
      recipeVersionId: version.id,
      versionNo: version.versionNo,
      state: version.state,
      reason: `version ${version.versionNo} is "${version.state}"; only an approved version can be costed`,
    };
  }
  try {
    const cost = await computeRecipeCost(store, {
      organizationId: recipe.organizationId,
      recipeVersionId: version.id,
      asOf,
    });
    return {
      available: true,
      recipeVersionId: version.id,
      versionNo: version.versionNo,
      state: version.state,
      currency: cost.currency,
      yieldRate: cost.yieldRate,
      recipeInputCost: cost.recipeInputCost,
      recipeOutputCost: cost.recipeOutputCost,
      costPerUsableOutputUnit: cost.costPerUsableOutputUnit,
      components: cost.components,
    };
  } catch (error) {
    if (error instanceof DomainError) {
      // A missing cost source or approved sub-recipe is a legitimate "not costable
      // yet" state for a preview; surface the reason instead of a 500.
      return {
        available: false,
        recipeVersionId: version.id,
        versionNo: version.versionNo,
        state: version.state,
        reason: error.message,
      };
    }
    throw error;
  }
}

async function requireRecipe(
  store: RecipeStore,
  organizationId: string,
  recipeId: string,
): Promise<RecipeRecord> {
  const recipe = await store.findRecipe(recipeId);
  if (recipe === undefined || recipe.organizationId !== organizationId) {
    // Top-level lookup miss: a typed 404 (`DEC-076`), not a validation error.
    throw new NotFoundError("recipe not found in organization");
  }
  return recipe;
}

/**
 * Recipes for the editor list with their latest version and a cost preview.
 *
 * The per-recipe version and cost reads are an N+1 by design for a bounded page
 * (`ponytail:` batch them behind a latest-version/cost-snapshot query if the list
 * grows past a screenful).
 */
export async function listRecipes(
  store: RecipeStore,
  input: ListRecipesInput,
): Promise<readonly ListedRecipe[]> {
  const recipes = await store.listRecipes(input.organizationId, {
    ...(input.search === undefined ? {} : { search: input.search }),
    limit: clampLimit(input.limit),
    offset: input.offset ?? 0,
  });
  const asOf = new Date();
  const listed: ListedRecipe[] = [];
  for (const recipe of recipes) {
    const versions = await store.listRecipeVersions(recipe.id);
    listed.push({
      recipe,
      latestVersion: latestByVersionNo(versions) ?? null,
      costPreview: await previewFor(store, recipe, versions, asOf),
    });
  }
  return listed;
}

/**
 * One recipe with every version (newest first), each version's nested lines and
 * allergen declarations, and a cost preview. Rejects a missing or
 * cross-organization recipe with a `DomainError`.
 */
export async function getRecipe(store: RecipeStore, input: GetRecipeInput): Promise<RecipeDetail> {
  const recipe = await requireRecipe(store, input.organizationId, input.recipeId);
  const versions = await store.listRecipeVersions(recipe.id);
  const summaries = await Promise.all(
    versions.map(async (version): Promise<RecipeVersionSummary> => {
      const [lines, allergens] = await Promise.all([
        store.listRecipeLines(version.id),
        store.listRecipeAllergens(version.id),
      ]);
      return { version, lines, allergens };
    }),
  );
  const ordered = [...summaries].sort((a, b) => b.version.versionNo - a.version.versionNo);
  return {
    recipe,
    versions: ordered,
    costPreview: await previewFor(store, recipe, versions, input.asOf ?? new Date()),
  };
}

/** The cost preview alone (delegates to `computeRecipeCost` via `previewFor`). */
export async function getRecipeCostPreview(
  store: RecipeStore,
  input: GetRecipeCostPreviewInput,
): Promise<RecipeCostPreview> {
  const recipe = await requireRecipe(store, input.organizationId, input.recipeId);
  const versions = await store.listRecipeVersions(recipe.id);
  return previewFor(store, recipe, versions, input.asOf ?? new Date());
}
