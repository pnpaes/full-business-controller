import type { Database, NodeDatabase } from "@aquarela/persistence";

import { createPostgresRecipeStore } from "../recipes/postgres-store";

import type { CostCardCompositionStore } from "./assemble-cost-card-composition";
import { createPostgresPriceScenarioStore } from "./price-scenario-postgres-store";

/** A transaction handle has no `transaction` method of its own. */
function isNodeDatabase(db: Database): db is NodeDatabase {
  return typeof (db as NodeDatabase).transaction === "function";
}

/**
 * Composes the recipe store (effective assignment + `computeRecipeCost`) with the
 * price-scenario store's effective price-version read into the assembler's narrow
 * port (the `reconciliation/postgres-store` sibling-spread precedent). The
 * assembler is read-only, but `withTransaction` is rebuilt so a transaction
 * handle still satisfies the full port.
 */
export function createPostgresCostCardCompositionStore(db: Database): CostCardCompositionStore {
  const recipes = createPostgresRecipeStore(db);
  const prices = createPostgresPriceScenarioStore(db);
  return {
    ...recipes,
    withTransaction: async (fn) => {
      if (!isNodeDatabase(db)) {
        return fn(createPostgresCostCardCompositionStore(db));
      }
      return db.transaction((tx) => fn(createPostgresCostCardCompositionStore(tx)));
    },
    findEffectivePriceVersion: prices.findEffectivePriceVersion,
  };
}
