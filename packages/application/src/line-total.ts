import type { Money, Quantity } from "@aquarela/domain";

/**
 * Placeholder use case proving the domain boundary: the application layer owns
 * orchestration and returns domain value objects, never floats.
 */
export function lineTotal(unitPrice: Money, quantity: Quantity): Money {
  return unitPrice.multiply(quantity.toString());
}
