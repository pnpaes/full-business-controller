import type { UnitDimension } from "@aquarela/domain";
import * as repo from "@aquarela/persistence";
import type { Database, NodeDatabase } from "@aquarela/persistence";

import type { ConversionEdge, MasterUnit } from "../catalog";
import type {
  AllergenRecord,
  RecipeAllergenRecordView,
  RecipeLineRecord,
  RecipeRecord,
  RecipeStore,
  RecipeUnit,
  RecipeVersionRecord,
} from "./types";

/** A transaction handle has no `transaction` method of its own. */
function isNodeDatabase(db: Database): db is NodeDatabase {
  return typeof (db as NodeDatabase).transaction === "function";
}

/**
 * The relational `query` API is present on both the pool database and a
 * transaction, so this narrows the union for the `product_recipe_assignment`
 * read that has no repository accessor.
 */
function relational(db: Database): NodeDatabase {
  return db as NodeDatabase;
}

/** The DB `check` constraints restrict this to `unit_dimension`. */
function toDimension(value: string): UnitDimension {
  return value as UnitDimension;
}

function toRecipeUnit(row: repo.Unit): RecipeUnit {
  return { id: row.id, code: row.code, dimension: toDimension(row.dimension), isBase: row.isBase };
}

function toConversionUnit(row: repo.EffectiveConversion, side: "from" | "to"): MasterUnit {
  return side === "from"
    ? {
        id: row.fromUnitId,
        code: row.fromUnitCode,
        dimension: toDimension(row.fromUnitDimension),
        isBase: row.fromUnitIsBase,
      }
    : {
        id: row.toUnitId,
        code: row.toUnitCode,
        dimension: toDimension(row.toUnitDimension),
        isBase: row.toUnitIsBase,
      };
}

function toRecipe(row: repo.Recipe): RecipeRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    name: row.name,
    outputItemId: row.outputItemId,
  };
}

function toRecipeVersion(row: repo.RecipeVersion): RecipeVersionRecord {
  return {
    id: row.id,
    recipeId: row.recipeId,
    versionNo: row.versionNo,
    state: row.state,
    plannedInputQty: row.plannedInputQty,
    plannedOutputQty: row.plannedOutputQty,
    approvedUsableOutput: row.approvedUsableOutput,
    yieldRate: row.yieldRate,
    preparationMinutes: row.preparationMinutes,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt,
    notes: row.notes,
  };
}

function toRecipeLine(row: repo.RecipeLine): RecipeLineRecord {
  return {
    id: row.id,
    recipeVersionId: row.recipeVersionId,
    componentKind: row.componentKind,
    itemId: row.itemId,
    subRecipeId: row.subRecipeId,
    quantity: row.quantity,
    unitId: row.unitId,
    lossFactor: row.lossFactor,
    stage: row.stage,
    substitutionGroup: row.substitutionGroup,
  };
}

function toAllergen(row: repo.Allergen): AllergenRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    name: row.name,
    isDerived: row.isDerived,
  };
}

function toAllergenDeclaration(row: repo.RecipeAllergenDeclaration): RecipeAllergenRecordView {
  return {
    allergenId: row.allergenId,
    code: row.code,
    name: row.name,
    isDerived: row.isDerived,
    source: row.source,
    verifiedBy: row.verifiedBy,
  };
}

/** Adapts the persistence repositories to the `RecipeStore` port. */
export function createPostgresRecipeStore(db: Database): RecipeStore {
  return {
    withTransaction: async (fn) => {
      if (!isNodeDatabase(db)) {
        return fn(createPostgresRecipeStore(db));
      }
      return db.transaction((tx) => fn(createPostgresRecipeStore(tx)));
    },
    findUnit: async (unitId) => {
      const row = await repo.findUnitById(db, unitId);
      return row === undefined ? undefined : toRecipeUnit(row);
    },
    findItem: async (itemId) => {
      const row = await repo.findItemById(db, itemId);
      return row === undefined
        ? undefined
        : {
            id: row.id,
            organizationId: row.organizationId,
            code: row.code,
            name: row.name,
            baseUnitId: row.baseUnitId,
            currentCost: row.currentCost,
          };
    },
    findRecipe: async (recipeId) => {
      const row = await repo.findRecipeById(db, recipeId);
      return row === undefined ? undefined : toRecipe(row);
    },
    findRecipeByCode: async (organizationId, code) => {
      const row = await repo.findRecipeByCode(db, organizationId, code);
      return row === undefined ? undefined : toRecipe(row);
    },
    listRecipes: async (organizationId, query) =>
      (await repo.listRecipesForOrganization(db, { organizationId, ...query })).map(toRecipe),
    createRecipe: async (input) => toRecipe(await repo.createRecipe(db, input)),
    findRecipeVersion: async (recipeVersionId) => {
      const row = await repo.findRecipeVersionById(db, recipeVersionId);
      return row === undefined ? undefined : toRecipeVersion(row);
    },
    listRecipeVersions: async (recipeId) =>
      (await repo.listRecipeVersions(db, recipeId)).map(toRecipeVersion),
    createRecipeVersion: async (input) =>
      toRecipeVersion(await repo.createRecipeVersion(db, input)),
    findVariantRecipeAssignment: async (query) => {
      const variant = await relational(db).query.productVariant.findFirst({
        columns: { id: true, organizationId: true },
        where: (fields, { eq }) => eq(fields.id, query.productVariantId),
      });
      if (variant === undefined || variant.organizationId !== query.organizationId) {
        return undefined;
      }
      // Half-open `[effectiveFrom, effectiveTo)`: the same predicate the sales
      // store's `findVariantRecipe` uses (mirrors `findEffectivePriceVersion`).
      const assignment = await relational(db).query.productRecipeAssignment.findFirst({
        where: (fields, { and, eq, gt, isNull, lte, or }) =>
          and(
            eq(fields.productVariantId, query.productVariantId),
            eq(fields.locationId, query.locationId),
            lte(fields.effectiveFrom, query.asOf),
            or(isNull(fields.effectiveTo), gt(fields.effectiveTo, query.asOf)),
          ),
      });
      return assignment === undefined ? undefined : { recipeVersionId: assignment.recipeVersionId };
    },
    listRecipeLines: async (recipeVersionId) =>
      (await repo.listRecipeLines(db, recipeVersionId)).map(toRecipeLine),
    createRecipeLine: async (input) => toRecipeLine(await repo.createRecipeLine(db, input)),
    listSubRecipeEdges: (organizationId) => repo.listSubRecipeEdges(db, organizationId),
    listEffectiveConversions: async (organizationId, asOf, itemId): Promise<ConversionEdge[]> => {
      const rows = await repo.listEffectiveConversions(db, { organizationId, asOf, itemId });
      return rows.map((row) => ({
        fromUnit: toConversionUnit(row, "from"),
        toUnit: toConversionUnit(row, "to"),
        factor: row.factor,
        itemId: row.itemId,
        effectiveFrom: row.effectiveFrom,
        effectiveTo: row.effectiveTo,
      }));
    },
    listEffectiveSupplierPrices: async (organizationId, itemId, asOf) =>
      (await repo.listEffectiveSupplierPricesForItem(db, organizationId, itemId, asOf)).map(
        (row) => ({ cost: row.landedBaseUnitCost, effectiveFrom: row.effectiveFrom }),
      ),
    listCostObservations: async (organizationId, itemId, asOf) =>
      (await repo.listCostObservationsUpTo(db, organizationId, itemId, asOf)).map((row) => ({
        id: row.id,
        packPrice: row.packPrice,
        packSize: row.packSize,
        packUnitId: row.packUnitId,
        observedAt: row.observedAt,
      })),
    listAllergens: async (organizationId) =>
      (await repo.listAllergensForOrganization(db, organizationId)).map(toAllergen),
    findAllergen: async (allergenId) => {
      const row = await repo.findAllergenById(db, allergenId);
      return row === undefined ? undefined : toAllergen(row);
    },
    findAllergenByCode: async (organizationId, code) => {
      const row = await repo.findAllergenByCode(db, organizationId, code);
      return row === undefined ? undefined : toAllergen(row);
    },
    createAllergen: async (input) => toAllergen(await repo.createAllergen(db, input)),
    listRecipeAllergens: async (recipeVersionId) =>
      (await repo.listRecipeAllergens(db, recipeVersionId)).map(toAllergenDeclaration),
    createRecipeAllergen: async (input) => {
      await repo.createRecipeAllergen(db, input);
    },
    writeAudit: async (input) => {
      await repo.writeAuditEvent(db, input);
    },
  };
}
