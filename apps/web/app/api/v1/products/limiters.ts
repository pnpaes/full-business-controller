import { createSharedLimiters } from "../../../../lib/rate-limit";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

/**
 * Per-IP throttles for the product-catalog mutations, applied by
 * `withMutationGuards` before the command runs. Master data changes are rare
 * compared with operational posts, so the limits are tight; they only blunt
 * scripted abuse. The counter is the shared `DEC-135` store, so every instance
 * enforces one window; a store outage fails open.
 */
export const productLimiters = createSharedLimiters("products", {
  registerItem: { limit: 30, windowMs: FIFTEEN_MINUTES_MS },
  updateItem: { limit: 30, windowMs: FIFTEEN_MINUTES_MS },
  registerSupplierItem: { limit: 30, windowMs: FIFTEEN_MINUTES_MS },
  registerUnitConversion: { limit: 30, windowMs: FIFTEEN_MINUTES_MS },
  registerProduct: { limit: 30, windowMs: FIFTEEN_MINUTES_MS },
  registerVariant: { limit: 30, windowMs: FIFTEEN_MINUTES_MS },
  updateVariant: { limit: 30, windowMs: FIFTEEN_MINUTES_MS },
  assignRecipe: { limit: 60, windowMs: FIFTEEN_MINUTES_MS },
  setAddonApplicability: { limit: 30, windowMs: FIFTEEN_MINUTES_MS },
});
