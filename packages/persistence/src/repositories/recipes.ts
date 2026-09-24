import { and, asc, desc, eq, gt, ilike, isNotNull, isNull, lte, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Database } from "../client";
import {
  allergen,
  costObservation,
  item,
  recipe,
  recipeAllergen,
  recipeLine,
  recipeTest,
  recipeVersion,
  supplierItem,
  supplierPrice,
} from "../schema";

export type Recipe = typeof recipe.$inferSelect;
export type NewRecipe = typeof recipe.$inferInsert;
export type RecipeVersion = typeof recipeVersion.$inferSelect;
export type NewRecipeVersion = typeof recipeVersion.$inferInsert;
export type RecipeLine = typeof recipeLine.$inferSelect;
export type NewRecipeLine = typeof recipeLine.$inferInsert;
export type Allergen = typeof allergen.$inferSelect;
export type NewAllergen = typeof allergen.$inferInsert;
export type RecipeAllergen = typeof recipeAllergen.$inferSelect;
export type NewRecipeAllergen = typeof recipeAllergen.$inferInsert;
export type RecipeTest = typeof recipeTest.$inferSelect;
export type NewRecipeTest = typeof recipeTest.$inferInsert;

export async function createRecipe(db: Database, input: NewRecipe): Promise<Recipe> {
  const rows = await db.insert(recipe).values(input).returning();
  return rows[0]!;
}

export async function findRecipeById(db: Database, recipeId: string): Promise<Recipe | undefined> {
  const rows = await db.select().from(recipe).where(eq(recipe.id, recipeId)).limit(1);
  return rows[0];
}

export async function findRecipeByCode(
  db: Database,
  organizationId: string,
  code: string,
): Promise<Recipe | undefined> {
  const rows = await db
    .select()
    .from(recipe)
    .where(and(eq(recipe.organizationId, organizationId), eq(recipe.code, code)))
    .limit(1);
  return rows[0];
}

/** Default page size for `listRecipesForOrganization` when the caller omits `limit`. */
export const DEFAULT_RECIPE_LIST_LIMIT = 50;

export interface ListRecipesQuery {
  readonly organizationId: string;
  /** Case-insensitive substring match on `code` or `name`. */
  readonly search?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Escapes the LIKE metacharacters in a user-supplied search term. PostgreSQL's
 * default `LIKE`/`ILIKE` escape character is `\`, so no explicit `ESCAPE` clause
 * is needed; drizzle still binds the pattern as a parameter, so this only stops
 * a literal `%`/`_` acting as a wildcard.
 */
function escapeLikeTerm(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

/**
 * Recipes in one organization, ordered by `code`, with an optional
 * case-insensitive substring filter and bounded pagination. Scoped by
 * `organization_id` so a caller never sees another tenant's recipes.
 */
export async function listRecipesForOrganization(
  db: Database,
  query: ListRecipesQuery,
): Promise<Recipe[]> {
  const term = query.search?.trim();
  const pattern = term === undefined || term.length === 0 ? undefined : `%${escapeLikeTerm(term)}%`;
  return db
    .select()
    .from(recipe)
    .where(
      and(
        eq(recipe.organizationId, query.organizationId),
        pattern === undefined
          ? undefined
          : or(ilike(recipe.code, pattern), ilike(recipe.name, pattern)),
      ),
    )
    .orderBy(asc(recipe.code))
    .limit(query.limit ?? DEFAULT_RECIPE_LIST_LIMIT)
    .offset(query.offset ?? 0);
}

export async function createRecipeVersion(
  db: Database,
  input: NewRecipeVersion,
): Promise<RecipeVersion> {
  const rows = await db.insert(recipeVersion).values(input).returning();
  return rows[0]!;
}

export async function findRecipeVersionById(
  db: Database,
  recipeVersionId: string,
): Promise<RecipeVersion | undefined> {
  const rows = await db
    .select()
    .from(recipeVersion)
    .where(eq(recipeVersion.id, recipeVersionId))
    .limit(1);
  return rows[0];
}

/**
 * All versions of a recipe, including drafts. The domain `selectEffectiveRecipeVersion`
 * picks the one effective at a date and rejects overlaps.
 */
export async function listRecipeVersions(db: Database, recipeId: string): Promise<RecipeVersion[]> {
  return db.select().from(recipeVersion).where(eq(recipeVersion.recipeId, recipeId));
}

export async function createRecipeLine(db: Database, input: NewRecipeLine): Promise<RecipeLine> {
  const rows = await db.insert(recipeLine).values(input).returning();
  return rows[0]!;
}

export async function listRecipeLines(
  db: Database,
  recipeVersionId: string,
): Promise<RecipeLine[]> {
  return db.select().from(recipeLine).where(eq(recipeLine.recipeVersionId, recipeVersionId));
}

export async function createAllergen(db: Database, input: NewAllergen): Promise<Allergen> {
  const rows = await db.insert(allergen).values(input).returning();
  return rows[0]!;
}

export async function findAllergenById(
  db: Database,
  allergenId: string,
): Promise<Allergen | undefined> {
  const rows = await db.select().from(allergen).where(eq(allergen.id, allergenId)).limit(1);
  return rows[0];
}

export async function findAllergenByCode(
  db: Database,
  organizationId: string,
  code: string,
): Promise<Allergen | undefined> {
  const rows = await db
    .select()
    .from(allergen)
    .where(and(eq(allergen.organizationId, organizationId), eq(allergen.code, code)))
    .limit(1);
  return rows[0];
}

export async function listAllergensForOrganization(
  db: Database,
  organizationId: string,
): Promise<Allergen[]> {
  return db.select().from(allergen).where(eq(allergen.organizationId, organizationId));
}

export async function createRecipeAllergen(
  db: Database,
  input: NewRecipeAllergen,
): Promise<RecipeAllergen> {
  const rows = await db.insert(recipeAllergen).values(input).returning();
  return rows[0]!;
}

/** A declared allergen with its master identity, joined for reads. */
export interface RecipeAllergenDeclaration {
  readonly allergenId: string;
  readonly code: string;
  readonly name: string;
  readonly isDerived: boolean;
  readonly source: string;
  readonly verifiedBy: string | null;
}

export async function listRecipeAllergens(
  db: Database,
  recipeVersionId: string,
): Promise<RecipeAllergenDeclaration[]> {
  return db
    .select({
      allergenId: allergen.id,
      code: allergen.code,
      name: allergen.name,
      isDerived: allergen.isDerived,
      source: recipeAllergen.source,
      verifiedBy: recipeAllergen.verifiedBy,
    })
    .from(recipeAllergen)
    .innerJoin(allergen, eq(recipeAllergen.allergenId, allergen.id))
    .where(eq(recipeAllergen.recipeVersionId, recipeVersionId));
}

/** A resolved sub-recipe dependency: `parentRecipeId` has a line consuming `childRecipeId`. */
export interface SubRecipeEdge {
  readonly parentRecipeId: string;
  readonly childRecipeId: string;
}

/**
 * Every sub-recipe edge in the organization, for cycle detection (COST-002).
 * Scoped through `recipe.organization_id` because `recipe_version` itself has no
 * organization column.
 */
export async function listSubRecipeEdges(
  db: Database,
  organizationId: string,
): Promise<SubRecipeEdge[]> {
  const rows = await db
    .select({ parentRecipeId: recipeVersion.recipeId, childRecipeId: recipeLine.subRecipeId })
    .from(recipeLine)
    .innerJoin(recipeVersion, eq(recipeLine.recipeVersionId, recipeVersion.id))
    .innerJoin(recipe, eq(recipeVersion.recipeId, recipe.id))
    .where(and(eq(recipe.organizationId, organizationId), isNotNull(recipeLine.subRecipeId)));
  return rows.map((row) => ({
    parentRecipeId: row.parentRecipeId,
    childRecipeId: row.childRecipeId!,
  }));
}

/** A `supplier_price` that is effective at `asOf`, with its item joined in. */
export interface SupplierPriceCandidate {
  readonly supplierItemId: string;
  readonly landedBaseUnitCost: string;
  readonly effectiveFrom: Date;
}

/**
 * Effective supplier prices for an item, newest first. `supplier_price` is keyed
 * by `supplier_item_id`, so it is joined through `supplier_item` to the item.
 * Every stored row is treated as approved (the table has no state column; rows
 * are written from accepted receipts).
 */
export async function listEffectiveSupplierPricesForItem(
  db: Database,
  organizationId: string,
  itemId: string,
  asOf: Date,
): Promise<SupplierPriceCandidate[]> {
  return db
    .select({
      supplierItemId: supplierPrice.supplierItemId,
      landedBaseUnitCost: supplierPrice.landedBaseUnitCost,
      effectiveFrom: supplierPrice.effectiveFrom,
    })
    .from(supplierPrice)
    .innerJoin(supplierItem, eq(supplierPrice.supplierItemId, supplierItem.id))
    .where(
      and(
        eq(supplierItem.organizationId, organizationId),
        eq(supplierItem.itemId, itemId),
        lte(supplierPrice.effectiveFrom, asOf),
        or(isNull(supplierPrice.effectiveTo), gt(supplierPrice.effectiveTo, asOf)),
      ),
    )
    .orderBy(desc(supplierPrice.effectiveFrom));
}

/** A `cost_observation` observed on or before `asOf`. */
export interface CostObservationCandidate {
  readonly id: string;
  readonly packPrice: string | null;
  readonly packSize: string | null;
  readonly packUnitId: string | null;
  readonly observedAt: string;
}

export async function listCostObservationsUpTo(
  db: Database,
  organizationId: string,
  itemId: string,
  asOf: Date,
): Promise<CostObservationCandidate[]> {
  return db
    .select({
      id: costObservation.id,
      packPrice: costObservation.packPrice,
      packSize: costObservation.packSize,
      packUnitId: costObservation.packUnitId,
      observedAt: costObservation.observedAt,
    })
    .from(costObservation)
    .innerJoin(item, eq(costObservation.itemId, item.id))
    .where(
      and(
        eq(costObservation.organizationId, organizationId),
        eq(costObservation.itemId, itemId),
        lte(costObservation.observedAt, asOf.toISOString().slice(0, 10)),
      ),
    )
    .orderBy(desc(costObservation.observedAt));
}

/**
 * A `DEC-123` recipe trial joined to the version it tried (for the recipe and
 * version number/state) and, when the improvement loop has closed, the version
 * the trial motivated. `recipe_test` carries no recipe link of its own, so the
 * recipe is reached through the tried version.
 */
export interface RecipeTestView {
  readonly id: string;
  readonly organizationId: string;
  readonly recipeId: string;
  readonly recipeVersionId: string;
  readonly testedAt: Date;
  readonly batchInputQty: string;
  readonly actualOutputQty: string | null;
  readonly actualDurationMinutes: number | null;
  readonly actualCost: string | null;
  readonly currency: string | null;
  readonly qualityComments: string | null;
  readonly proposedAdjustment: string | null;
  readonly resultingRecipeVersionId: string | null;
  readonly actorId: string;
  readonly createdAt: Date;
  readonly testedVersionNo: number;
  readonly testedVersionState: string;
  readonly resultingVersionNo: number | null;
  readonly resultingVersionState: string | null;
}

/** The `recipe_version` self-join that resolves a trial's resulting version. */
const resultingVersion = alias(recipeVersion, "resulting_recipe_version");

/**
 * The read projection shared by `findRecipeTestById` and the two list
 * accessors: the trial columns plus the tried version's recipe/number/state and
 * the resulting version's number/state (both nullable). Callers add the scope
 * and ordering.
 */
function selectRecipeTests(db: Database) {
  return db
    .select({
      id: recipeTest.id,
      organizationId: recipeTest.organizationId,
      // `recipe_version` has no organization column, so the scope is proved
      // through the recipe it belongs to.
      recipeId: recipeVersion.recipeId,
      recipeVersionId: recipeTest.recipeVersionId,
      testedAt: recipeTest.testedAt,
      batchInputQty: recipeTest.batchInputQty,
      actualOutputQty: recipeTest.actualOutputQty,
      actualDurationMinutes: recipeTest.actualDurationMinutes,
      actualCost: recipeTest.actualCost,
      currency: recipeTest.currency,
      qualityComments: recipeTest.qualityComments,
      proposedAdjustment: recipeTest.proposedAdjustment,
      resultingRecipeVersionId: recipeTest.resultingRecipeVersionId,
      actorId: recipeTest.actorId,
      createdAt: recipeTest.createdAt,
      testedVersionNo: recipeVersion.versionNo,
      testedVersionState: recipeVersion.state,
      resultingVersionNo: resultingVersion.versionNo,
      resultingVersionState: resultingVersion.state,
    })
    .from(recipeTest)
    .innerJoin(recipeVersion, eq(recipeTest.recipeVersionId, recipeVersion.id))
    .innerJoin(recipe, eq(recipeVersion.recipeId, recipe.id))
    .leftJoin(resultingVersion, eq(recipeTest.resultingRecipeVersionId, resultingVersion.id));
}

/** One trial by id, or `undefined` when unknown. */
export async function findRecipeTestById(
  db: Database,
  recipeTestId: string,
): Promise<RecipeTestView | undefined> {
  const rows = await selectRecipeTests(db).where(eq(recipeTest.id, recipeTestId)).limit(1);
  return rows[0];
}

/**
 * Trials of one recipe (through its versions, since `recipe_test` has no
 * organization/recipe column), newest tested first. Organization-scoped so a
 * caller never reads another tenant's trials.
 */
export async function listRecipeTestsByRecipe(
  db: Database,
  organizationId: string,
  recipeId: string,
): Promise<RecipeTestView[]> {
  return selectRecipeTests(db)
    .where(and(eq(recipe.organizationId, organizationId), eq(recipe.id, recipeId)))
    .orderBy(desc(recipeTest.testedAt), desc(recipeTest.createdAt));
}

/** Trials of one version, newest tested first, scoped by the trial's organization. */
export async function listRecipeTestsByVersion(
  db: Database,
  organizationId: string,
  recipeVersionId: string,
): Promise<RecipeTestView[]> {
  return selectRecipeTests(db)
    .where(
      and(
        eq(recipeTest.organizationId, organizationId),
        eq(recipeTest.recipeVersionId, recipeVersionId),
      ),
    )
    .orderBy(desc(recipeTest.testedAt), desc(recipeTest.createdAt));
}

/** Inserts one append-only trial fact. */
export async function createRecipeTest(db: Database, input: NewRecipeTest): Promise<RecipeTest> {
  const rows = await db.insert(recipeTest).values(input).returning();
  return rows[0]!;
}

/**
 * The improvement loop's single forward write (`DEC-123`): sets
 * `resulting_recipe_version_id` only while it is still null. Returns the updated
 * row, or `undefined` when the trial is unknown or already linked — the caller
 * never edits a recorded trial's measured values.
 */
export async function linkRecipeTestToVersion(
  db: Database,
  recipeTestId: string,
  resultingRecipeVersionId: string,
): Promise<RecipeTest | undefined> {
  const rows = await db
    .update(recipeTest)
    .set({ resultingRecipeVersionId })
    .where(and(eq(recipeTest.id, recipeTestId), isNull(recipeTest.resultingRecipeVersionId)))
    .returning();
  return rows[0];
}
