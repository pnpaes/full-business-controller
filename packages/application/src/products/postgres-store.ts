import { DomainError } from "@aquarela/domain";
import * as repo from "@aquarela/persistence";
import type { Database, NodeDatabase } from "@aquarela/persistence";

import type {
  AddonApplicabilityRecord,
  ApprovedRecipeVersionOption,
  LocationOption,
  NewAddonApplicabilityRecord,
  NewProductRecord,
  NewProductVariantRecord,
  NewRecipeAssignmentRecord,
  ProductRecord,
  ProductStore,
  ProductVariantRecord,
  RecipeAssignmentRecord,
  RecipeVersionScopeRecord,
  UpdateProductVariantRecord,
} from "./types";

/** A transaction handle has no `transaction` method of its own. */
function isNodeDatabase(db: Database): db is NodeDatabase {
  return typeof (db as NodeDatabase).transaction === "function";
}

/**
 * The relational `query` API is present on both the pool database and a
 * transaction, so this narrows the union: `product`, `product_variant`,
 * `addon_applicability` and `product_recipe_assignment` have no repository
 * accessors and are read through it (the recipes/sales-store precedent).
 */
function relational(db: Database): NodeDatabase {
  return db as NodeDatabase;
}

const ASSIGNMENT_OVERLAP_MESSAGE =
  "an assignment for this variant and location is already effective in this window";

/** SQLSTATE `23P01` is an exclusion-constraint violation (overlapping window). */
const EXCLUSION_VIOLATION = "23P01";

type ProductRow = typeof repo.product.$inferSelect;
type ProductVariantRow = typeof repo.productVariant.$inferSelect;
type ProductAssignmentRow = typeof repo.productRecipeAssignment.$inferSelect;
type ProductAddonRow = typeof repo.addonApplicability.$inferSelect;

/**
 * The driver SQLSTATE for a failed query. Drizzle 0.45 wraps the `pg` error in a
 * `DrizzleQueryError`, so the SQLSTATE lives on `cause` rather than the top
 * level; both shapes are accepted so the translation does not depend on the
 * wrapper.
 */
function errorSqlState(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const direct = (error as { code?: string }).code;
  if (direct !== undefined) {
    return direct;
  }
  const cause = (error as { cause?: unknown }).cause;
  if (typeof cause === "object" && cause !== null) {
    return (cause as { code?: string }).code;
  }
  return undefined;
}

/** The `pra_no_overlap` exclusion constraint fired (a concurrent overlap). */
function isAssignmentOverlap(error: unknown): boolean {
  return errorSqlState(error) === EXCLUSION_VIOLATION;
}

function toProduct(row: ProductRow): ProductRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    name: row.name,
    category: row.category,
    productKind: row.productKind,
    activeFrom: row.activeFrom,
    activeTo: row.activeTo,
  };
}

function toVariant(row: ProductVariantRow): ProductVariantRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    productId: row.productId,
    code: row.code,
    sku: row.sku,
    name: row.name,
    size: row.size,
    finishedGoodItemId: row.finishedGoodItemId,
    activeFrom: row.activeFrom,
    activeTo: row.activeTo,
  };
}

function toAssignment(row: ProductAssignmentRow): RecipeAssignmentRecord {
  return {
    id: row.id,
    productVariantId: row.productVariantId,
    locationId: row.locationId,
    recipeVersionId: row.recipeVersionId,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
  };
}

function toAddon(row: ProductAddonRow): AddonApplicabilityRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    addonProductId: row.addonProductId,
    baseProductId: row.baseProductId,
    priceEffect: row.priceEffect,
    activeFrom: row.activeFrom,
    activeTo: row.activeTo,
  };
}

/** Adapts the persistence tables/repositories to the `ProductStore` port. */
export function createPostgresProductStore(db: Database): ProductStore {
  return {
    withTransaction: async (fn) => {
      if (!isNodeDatabase(db)) {
        return fn(createPostgresProductStore(db));
      }
      return db.transaction((tx) => fn(createPostgresProductStore(tx)));
    },
    findProduct: async (productId) => {
      const row = await relational(db).query.product.findFirst({
        where: (fields, { eq }) => eq(fields.id, productId),
      });
      return row === undefined ? undefined : toProduct(row);
    },
    findProductByCode: async (organizationId, code) => {
      const row = await relational(db).query.product.findFirst({
        where: (fields, { and, eq }) =>
          and(eq(fields.organizationId, organizationId), eq(fields.code, code)),
      });
      return row === undefined ? undefined : toProduct(row);
    },
    createProduct: async (input: NewProductRecord) => {
      const rows = await db
        .insert(repo.product)
        .values({
          organizationId: input.organizationId,
          code: input.code,
          name: input.name,
          category: input.category,
          productKind: input.productKind,
        })
        .returning();
      return toProduct(rows[0]!);
    },
    listProducts: async (organizationId) => {
      const rows = await relational(db).query.product.findMany({
        where: (fields, { eq }) => eq(fields.organizationId, organizationId),
        orderBy: (fields, { asc }) => [asc(fields.code)],
      });
      return rows.map(toProduct);
    },
    findVariant: async (productVariantId) => {
      const row = await relational(db).query.productVariant.findFirst({
        where: (fields, { eq }) => eq(fields.id, productVariantId),
      });
      return row === undefined ? undefined : toVariant(row);
    },
    findVariantByCode: async (productId, code) => {
      const row = await relational(db).query.productVariant.findFirst({
        where: (fields, { and, eq }) => and(eq(fields.productId, productId), eq(fields.code, code)),
      });
      return row === undefined ? undefined : toVariant(row);
    },
    findVariantBySku: async (organizationId, sku) => {
      const row = await relational(db).query.productVariant.findFirst({
        where: (fields, { and, eq }) =>
          and(eq(fields.organizationId, organizationId), eq(fields.sku, sku)),
      });
      return row === undefined ? undefined : toVariant(row);
    },
    listVariants: async (productId) => {
      const rows = await relational(db).query.productVariant.findMany({
        where: (fields, { eq }) => eq(fields.productId, productId),
        orderBy: (fields, { asc }) => [asc(fields.code)],
      });
      return rows.map(toVariant);
    },
    createVariant: async (input: NewProductVariantRecord) => {
      const rows = await db
        .insert(repo.productVariant)
        .values({
          organizationId: input.organizationId,
          productId: input.productId,
          code: input.code,
          sku: input.sku,
          name: input.name,
          size: input.size,
          finishedGoodItemId: input.finishedGoodItemId,
        })
        .returning();
      return toVariant(rows[0]!);
    },
    updateVariant: async (input: UpdateProductVariantRecord) => {
      const existing = await relational(db).query.productVariant.findFirst({
        where: (fields, { eq }) => eq(fields.id, input.productVariantId),
      });
      if (existing === undefined) {
        return;
      }
      const changes: { name?: string; size?: string | null; finishedGoodItemId?: string | null } =
        {};
      if (input.name !== undefined) {
        changes.name = input.name;
      }
      if (input.size !== undefined) {
        changes.size = input.size;
      }
      if (input.finishedGoodItemId !== undefined) {
        changes.finishedGoodItemId = input.finishedGoodItemId;
      }
      // ponytail: the persistence layer is frozen, so the mutable-field update is
      // expressed as an id-targeted upsert through the exported table rather than
      // a repository `updateVariant` (the catalog `updateItem` precedent).
      await db
        .insert(repo.productVariant)
        .values({
          id: existing.id,
          organizationId: existing.organizationId,
          productId: existing.productId,
          code: existing.code,
          sku: existing.sku,
          name: existing.name,
          size: existing.size,
          finishedGoodItemId: existing.finishedGoodItemId,
          activeFrom: existing.activeFrom,
        })
        .onConflictDoUpdate({ target: repo.productVariant.id, set: changes });
    },
    findItemScope: async (itemId) => {
      const row = await repo.findItemById(db, itemId);
      return row === undefined
        ? undefined
        : { id: row.id, organizationId: row.organizationId, purpose: row.purpose };
    },
    findLocationScope: async (locationId) => {
      const row = await repo.findLocationById(db, locationId);
      return row === undefined
        ? undefined
        : { id: row.id, organizationId: row.organizationId, code: row.code, name: row.name };
    },
    listLocations: async (organizationId): Promise<readonly LocationOption[]> => {
      const rows = await repo.listLocations(db, { organizationId });
      return rows.map((row) => ({
        id: row.id,
        organizationId: row.organizationId,
        code: row.code,
        name: row.name,
      }));
    },
    findRecipeVersionScope: async (recipeVersionId) => {
      const version = await relational(db).query.recipeVersion.findFirst({
        where: (fields, { eq }) => eq(fields.id, recipeVersionId),
        columns: { id: true, recipeId: true, state: true, versionNo: true },
      });
      if (version === undefined) {
        return undefined;
      }
      const recipe = await relational(db).query.recipe.findFirst({
        where: (fields, { eq }) => eq(fields.id, version.recipeId),
        columns: { organizationId: true },
      });
      if (recipe === undefined) {
        return undefined;
      }
      const scope: RecipeVersionScopeRecord = {
        id: version.id,
        organizationId: recipe.organizationId,
        recipeId: version.recipeId,
        state: version.state,
        versionNo: version.versionNo,
      };
      return scope;
    },
    listApprovedRecipeVersions: async (
      organizationId,
    ): Promise<readonly ApprovedRecipeVersionOption[]> => {
      const recipes = await relational(db).query.recipe.findMany({
        where: (fields, { eq }) => eq(fields.organizationId, organizationId),
        columns: { id: true, code: true, name: true },
      });
      if (recipes.length === 0) {
        return [];
      }
      const byId = new Map(recipes.map((recipe) => [recipe.id, recipe]));
      const versions = await relational(db).query.recipeVersion.findMany({
        where: (fields, { and, eq, inArray }) =>
          and(eq(fields.state, "approved"), inArray(fields.recipeId, [...byId.keys()])),
        orderBy: (fields, { desc }) => [desc(fields.versionNo)],
      });
      const options: ApprovedRecipeVersionOption[] = [];
      for (const version of versions) {
        const recipe = byId.get(version.recipeId);
        if (recipe === undefined) {
          continue;
        }
        options.push({
          id: version.id,
          recipeId: version.recipeId,
          recipeCode: recipe.code,
          recipeName: recipe.name,
          versionNo: version.versionNo,
          effectiveFrom: version.effectiveFrom,
          effectiveTo: version.effectiveTo,
        });
      }
      return options;
    },
    createRecipeAssignment: async (input: NewRecipeAssignmentRecord) => {
      try {
        const rows = await db
          .insert(repo.productRecipeAssignment)
          .values({
            productVariantId: input.productVariantId,
            locationId: input.locationId,
            recipeVersionId: input.recipeVersionId,
            effectiveFrom: input.effectiveFrom,
            effectiveTo: input.effectiveTo,
          })
          .returning();
        return { id: rows[0]!.id };
      } catch (error) {
        if (isAssignmentOverlap(error)) {
          throw new DomainError(ASSIGNMENT_OVERLAP_MESSAGE);
        }
        throw error;
      }
    },
    listRecipeAssignmentsForVariant: async (productVariantId) => {
      const rows = await relational(db).query.productRecipeAssignment.findMany({
        where: (fields, { eq }) => eq(fields.productVariantId, productVariantId),
        orderBy: (fields, { asc }) => [asc(fields.effectiveFrom)],
      });
      return rows.map(toAssignment);
    },
    findAddonApplicability: async (addonProductId, baseProductId) => {
      const row = await relational(db).query.addonApplicability.findFirst({
        where: (fields, { and, eq }) =>
          and(eq(fields.addonProductId, addonProductId), eq(fields.baseProductId, baseProductId)),
      });
      return row === undefined ? undefined : toAddon(row);
    },
    createAddonApplicability: async (input: NewAddonApplicabilityRecord) => {
      const rows = await db
        .insert(repo.addonApplicability)
        .values({
          organizationId: input.organizationId,
          addonProductId: input.addonProductId,
          baseProductId: input.baseProductId,
          priceEffect: input.priceEffect,
        })
        .returning();
      return toAddon(rows[0]!);
    },
    listAddonApplicabilityForProduct: async (productId) => {
      const rows = await relational(db).query.addonApplicability.findMany({
        where: (fields, { eq, or }) =>
          or(eq(fields.addonProductId, productId), eq(fields.baseProductId, productId)),
      });
      return rows.map(toAddon);
    },
    writeAudit: async (input) => {
      await repo.writeAuditEvent(db, input);
    },
  };
}
