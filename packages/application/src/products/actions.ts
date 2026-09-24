/**
 * Audit action vocabulary for the product / variant identity commands
 * (`DEC-128`). Values are the `audit_event.action` strings; keeping them here
 * stops a handler from drifting into near-duplicate names.
 */
export const PRODUCT_AUDIT_ACTIONS = {
  productRegistered: "products.product.registered",
  variantRegistered: "products.variant.registered",
  variantUpdated: "products.variant.updated",
  recipeAssigned: "products.recipe_assignment.assigned",
  addonApplicabilitySet: "products.addon_applicability.set",
} as const;

export type ProductAuditAction = (typeof PRODUCT_AUDIT_ACTIONS)[keyof typeof PRODUCT_AUDIT_ACTIONS];
