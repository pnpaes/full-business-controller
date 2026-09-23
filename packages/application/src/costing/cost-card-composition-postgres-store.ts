import type { Database, NodeDatabase } from "@aquarela/persistence";
import * as repo from "@aquarela/persistence";

import { createPostgresRecipeStore } from "../recipes/postgres-store";

import type { CostCardComponentStore } from "./assemble-cost-card-composition";
import { createPostgresCostingStore } from "./postgres-store";
import { createPostgresPriceScenarioStore } from "./price-scenario-postgres-store";

/** A transaction handle has no `transaction` method of its own. */
function isNodeDatabase(db: Database): db is NodeDatabase {
  return typeof (db as NodeDatabase).transaction === "function";
}

/**
 * Composes the recipe store (effective assignment + `computeRecipeCost` + the
 * `DEC-112` cost-centre lookup), the price-scenario store's effective
 * price-version read, the costing store's labour/channel-fee/operating-cost/
 * allocation reads and the `countEligibleProducts` persistence read into the
 * assembler's narrow port (the `reconciliation/postgres-store` sibling-spread
 * precedent). The assembler is read-only, but `withTransaction` is rebuilt so a
 * transaction handle still satisfies the full port.
 */
export function createPostgresCostCardCompositionStore(db: Database): CostCardComponentStore {
  const recipes = createPostgresRecipeStore(db);
  const prices = createPostgresPriceScenarioStore(db);
  const costing = createPostgresCostingStore(db);
  return {
    ...recipes,
    withTransaction: async (fn) => {
      if (!isNodeDatabase(db)) {
        return fn(createPostgresCostCardCompositionStore(db));
      }
      return db.transaction((tx) => fn(createPostgresCostCardCompositionStore(tx)));
    },
    findEffectivePriceVersion: prices.findEffectivePriceVersion,
    findEffectiveLaborRate: costing.findEffectiveLaborRate,
    listEffectiveChannelFeeRules: costing.listEffectiveChannelFeeRules,
    listEffectiveOperatingCosts: costing.listEffectiveOperatingCosts,
    listEffectiveAllocationRules: costing.listEffectiveAllocationRules,
    countEligibleProducts: (query) => repo.countEligibleProducts(db, query),
  };
}
