import * as repo from "@aquarela/persistence";
import type { Database } from "@aquarela/persistence";

import { createPostgresCostingStore } from "../costing/postgres-store";
import { createPostgresRecipeStore } from "../recipes/postgres-store";

import { createPostgresProductionStore } from "./postgres-store";
import type { ProductionBatchCostStore } from "./types";

/**
 * Composes the reads `computeProductionBatchCost` needs (`DEC-124`): the recipe
 * store (so `computeRecipeCost` reuses the real engine), the production/inventory
 * readers for the batch header and its ledger movements, the `DEC-112`
 * labour/overhead reads and the two persistence aggregates the allocation
 * denominators need — the `cost-card-composition-postgres-store` sibling-spread
 * precedent. Read-only: nothing here writes.
 */
export function createPostgresProductionBatchCostStore(db: Database): ProductionBatchCostStore {
  const recipes = createPostgresRecipeStore(db);
  const production = createPostgresProductionStore(db);
  const costing = createPostgresCostingStore(db);
  return {
    ...recipes,
    findProductionBatch: production.findProductionBatch,
    listStockMovements: production.listStockMovements,
    findEffectiveLaborRate: costing.findEffectiveLaborRate,
    listEffectiveOperatingCosts: costing.listEffectiveOperatingCosts,
    listEffectiveAllocationRules: costing.listEffectiveAllocationRules,
    countEligibleProducts: (query) => repo.countEligibleProducts(db, query),
    sumSalesVolume: (query) =>
      repo.sumSalesVolume(db, {
        organizationId: query.organizationId,
        from: query.from,
        to: query.to,
        locationIds: [query.locationId],
      }),
  };
}
