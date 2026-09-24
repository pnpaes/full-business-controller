import type { Database, NodeDatabase } from "@aquarela/persistence";

import { createPostgresCostCardCompositionStore } from "../costing/cost-card-composition-postgres-store";
import { createPostgresReportingStore } from "../reporting/postgres-store";

import type { SimulationStore } from "./types";

/**
 * The relational `query` API is present on both the pool database and a
 * transaction, so this narrows the union for the `product_recipe_assignment`
 * read that has no repository accessor (the recipe-store precedent).
 */
function relational(db: Database): NodeDatabase {
  return db as NodeDatabase;
}

/**
 * Composes the simulation's narrow port from reads that already exist: the
 * cost-card composition store (`DEC-111`/`DEC-112` — the recipe port, the
 * effective price version, the labour/channel/operating-cost/allocation reads),
 * the reporting store's `summarizeSales` and one new read over
 * `product_recipe_assignment` (variant for a recipe version). Read-only: no
 * write path, no schema change, no migration.
 */
export function createPostgresSimulationStore(db: Database): SimulationStore {
  const composition = createPostgresCostCardCompositionStore(db);
  const reporting = createPostgresReportingStore(db);
  return {
    ...composition,
    summarizeSales: (query) => reporting.summarizeSales(query),
    findVariantForRecipeVersion: async (query) => {
      const assignment = await relational(db).query.productRecipeAssignment.findFirst({
        columns: { productVariantId: true },
        where: (fields, { and, eq, gt, isNull, lte, or }) =>
          and(
            eq(fields.recipeVersionId, query.recipeVersionId),
            eq(fields.locationId, query.locationId),
            lte(fields.effectiveFrom, query.asOf),
            or(isNull(fields.effectiveTo), gt(fields.effectiveTo, query.asOf)),
          ),
      });
      if (assignment === undefined) {
        return undefined;
      }
      const variant = await relational(db).query.productVariant.findFirst({
        columns: { organizationId: true },
        where: (fields, { eq }) => eq(fields.id, assignment.productVariantId),
      });
      if (variant === undefined || variant.organizationId !== query.organizationId) {
        return undefined;
      }
      return { productVariantId: assignment.productVariantId };
    },
  };
}
