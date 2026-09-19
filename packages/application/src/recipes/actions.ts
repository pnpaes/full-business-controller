/**
 * Audit action vocabulary for recipes. Values are the `audit_event.action`
 * strings; keeping them here stops a handler from drifting into near-duplicate
 * names.
 */
export const RECIPE_AUDIT_ACTIONS = {
  recipeRegistered: "recipes.recipe.registered",
  versionRegistered: "recipes.recipe_version.registered",
  allergenRegistered: "recipes.allergen.registered",
} as const;

export type RecipeAuditAction = (typeof RECIPE_AUDIT_ACTIONS)[keyof typeof RECIPE_AUDIT_ACTIONS];
