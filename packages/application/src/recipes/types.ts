import type { UnitDimension } from "@aquarela/domain";

import type { AuditInput } from "../auth";
import type { ConversionEdge } from "../catalog";

/**
 * Application-level ports and DTOs for slice-5 recipes / sub-recipes / versions /
 * yield / allergens. The store is a narrow port over `@aquarela/persistence` so
 * the commands can be unit-tested against an in-memory fake;
 * `createPostgresRecipeStore` is the real adapter. Record types are structural
 * subsets of the persistence rows.
 */

export interface RecipeUnit {
  readonly id: string;
  readonly code: string;
  readonly dimension: UnitDimension;
  readonly isBase: boolean;
}

export interface RecipeItemRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly code: string;
  readonly name: string;
  readonly baseUnitId: string;
  readonly currentCost: string | null;
}

/**
 * The org scope of a `cost_center` (mirrors `CostingStore.findCostCenter` but
 * carries only what `registerRecipeVersion` needs to check the `DEC-112` labour
 * mapping's organization).
 */
export interface RecipeCostCenterRecord {
  readonly id: string;
  readonly organizationId: string;
}

export interface FindVariantRecipeAssignmentQuery {
  readonly organizationId: string;
  readonly productVariantId: string;
  readonly locationId: string;
  readonly asOf: Date;
}

/**
 * The effective variant→recipe resolution for one location and instant. Only the
 * assigned version id is exposed here; the recipe-cost assembler re-costs that
 * version through `computeRecipeCost`. `product_recipe_assignment` has no
 * repository accessor, so the Postgres adapter reads it through the
 * relational-query client (the sales-store `findVariantRecipe` precedent).
 */
export interface VariantRecipeAssignmentRecord {
  readonly recipeVersionId: string;
}

/** Filters for the recipe list read. `limit`/`offset` are applied by the store. */
export interface ListRecipesQuery {
  readonly search?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface RecipeRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly code: string;
  readonly name: string;
  readonly outputItemId: string | null;
}

export interface RecipeVersionRecord {
  readonly id: string;
  readonly recipeId: string;
  readonly versionNo: number;
  readonly state: string;
  readonly plannedInputQty: string;
  readonly plannedOutputQty: string;
  readonly approvedUsableOutput: string;
  readonly yieldRate: string;
  readonly preparationMinutes: number | null;
  /** `DEC-112`: the direct-labour mapping (all-or-nothing with `laborRoleCode`). */
  readonly laborCostCenterId: string | null;
  readonly laborRoleCode: string | null;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
  readonly approvedBy: string | null;
  readonly approvedAt: Date | null;
  readonly notes: string | null;
  /** `DEC-123`: free-text method/steps for the version (nullable, no backfill). */
  readonly method: string | null;
}

export interface RecipeLineRecord {
  readonly id: string;
  readonly recipeVersionId: string;
  readonly componentKind: string;
  readonly itemId: string | null;
  readonly subRecipeId: string | null;
  readonly quantity: string;
  readonly unitId: string;
  readonly lossFactor: string;
  readonly stage: string | null;
  readonly substitutionGroup: string | null;
}

export interface NewRecipeRecord {
  readonly organizationId: string;
  readonly code: string;
  readonly name: string;
  readonly outputItemId: string | null;
}

export interface NewRecipeVersionRecord {
  readonly recipeId: string;
  readonly versionNo: number;
  readonly state: string;
  readonly plannedInputQty: string;
  readonly plannedOutputQty: string;
  readonly approvedUsableOutput: string;
  readonly yieldRate: string;
  readonly preparationMinutes: number | null;
  readonly laborCostCenterId: string | null;
  readonly laborRoleCode: string | null;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
  readonly approvedBy: string | null;
  readonly approvedAt: Date | null;
  readonly notes: string | null;
  readonly method: string | null;
}

export interface NewRecipeLineRecord {
  readonly recipeVersionId: string;
  readonly componentKind: string;
  readonly itemId: string | null;
  readonly subRecipeId: string | null;
  readonly quantity: string;
  readonly unitId: string;
  readonly lossFactor: string;
  readonly stage: string | null;
  readonly substitutionGroup: string | null;
}

export interface AllergenRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly code: string;
  readonly name: string;
  readonly isDerived: boolean;
}

export interface NewAllergenRecord {
  readonly organizationId: string;
  readonly code: string;
  readonly name: string;
  readonly isDerived: boolean;
}

export interface NewRecipeAllergenRecord {
  readonly recipeVersionId: string;
  readonly allergenId: string;
  readonly source: string;
  readonly verifiedBy: string | null;
}

/** A declared allergen read back with its master identity. */
export interface RecipeAllergenRecordView {
  readonly allergenId: string;
  readonly code: string;
  readonly name: string;
  readonly isDerived: boolean;
  readonly source: string;
  readonly verifiedBy: string | null;
}

export interface RecipeSubRecipeEdge {
  readonly parentRecipeId: string;
  readonly childRecipeId: string;
}

/**
 * `DEC-123`: one append-only recipe **trial**. A trial is a fact — its measured
 * values are never edited; only the nullable `resultingRecipeVersionId` forward
 * link is written, once, when the version it motivated is registered.
 */
export interface RecipeTestRecord {
  readonly id: string;
  readonly organizationId: string;
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
}

export interface NewRecipeTestRecord {
  readonly organizationId: string;
  readonly recipeVersionId: string;
  readonly testedAt: Date;
  readonly batchInputQty: string;
  readonly actualOutputQty: string | null;
  readonly actualDurationMinutes: number | null;
  readonly actualCost: string | null;
  readonly currency: string | null;
  readonly qualityComments: string | null;
  readonly proposedAdjustment: string | null;
  readonly actorId: string;
}

/** A trial read back with the tried version's identity and its resulting version. */
export interface RecipeTestView extends RecipeTestRecord {
  readonly recipeId: string;
  readonly testedVersionNo: number;
  readonly testedVersionState: string;
  readonly resultingVersionNo: number | null;
  readonly resultingVersionState: string | null;
}

/** Scope for the trial list: an organization plus `recipeId` / `recipeVersionId`. */
export interface ListRecipeTestsQuery {
  readonly organizationId: string;
  readonly recipeId?: string;
  readonly recipeVersionId?: string;
}

/** A `supplier_price` effective at the as-of date (all rows are treated as approved). */
export interface SupplierPriceCandidate {
  readonly cost: string;
  readonly effectiveFrom: Date;
}

/** A raw `cost_observation`, normalised to a base-unit cost during costing. */
export interface RawCostObservation {
  readonly id: string;
  readonly packPrice: string | null;
  readonly packSize: string | null;
  readonly packUnitId: string | null;
  readonly observedAt: string;
}

export interface RecipeStore {
  /** Binds `fn` to one transaction so version, lines, allergens and audit commit together. */
  withTransaction<T>(fn: (store: RecipeStore) => Promise<T>): Promise<T>;
  findUnit(unitId: string): Promise<RecipeUnit | undefined>;
  findItem(itemId: string): Promise<RecipeItemRecord | undefined>;
  /** The org scope of a cost centre, for the `DEC-112` labour-mapping check. */
  findCostCenter(costCenterId: string): Promise<RecipeCostCenterRecord | undefined>;
  findRecipe(recipeId: string): Promise<RecipeRecord | undefined>;
  findRecipeByCode(organizationId: string, code: string): Promise<RecipeRecord | undefined>;
  /** Organization-scoped recipe list with an optional search and bounded pagination. */
  listRecipes(organizationId: string, query: ListRecipesQuery): Promise<readonly RecipeRecord[]>;
  createRecipe(input: NewRecipeRecord): Promise<RecipeRecord>;
  findRecipeVersion(recipeVersionId: string): Promise<RecipeVersionRecord | undefined>;
  listRecipeVersions(recipeId: string): Promise<readonly RecipeVersionRecord[]>;
  createRecipeVersion(input: NewRecipeVersionRecord): Promise<RecipeVersionRecord>;
  /**
   * The effective `product_recipe_assignment.recipe_version_id` for
   * `(productVariantId, locationId)` at `asOf` (half-open
   * `[effectiveFrom, effectiveTo)`), or `undefined` when the variant is not
   * recipe-assigned at that location/instant. The variant is checked against the
   * organization first, so a foreign variant reads as `undefined`.
   */
  findVariantRecipeAssignment(
    query: FindVariantRecipeAssignmentQuery,
  ): Promise<VariantRecipeAssignmentRecord | undefined>;
  listRecipeLines(recipeVersionId: string): Promise<readonly RecipeLineRecord[]>;
  createRecipeLine(input: NewRecipeLineRecord): Promise<RecipeLineRecord>;
  /** Every sub-recipe edge in the organization, for cycle detection (COST-002). */
  listSubRecipeEdges(organizationId: string): Promise<readonly RecipeSubRecipeEdge[]>;
  /** Effective (global + item-scoped) conversion edges, for unit conversion. */
  listEffectiveConversions(
    organizationId: string,
    asOf: Date,
    itemId: string | null,
  ): Promise<readonly ConversionEdge[]>;
  /** Effective supplier prices for an item, newest first. */
  listEffectiveSupplierPrices(
    organizationId: string,
    itemId: string,
    asOf: Date,
  ): Promise<readonly SupplierPriceCandidate[]>;
  /** Raw cost observations for an item on or before `asOf`, newest first. */
  listCostObservations(
    organizationId: string,
    itemId: string,
    asOf: Date,
  ): Promise<readonly RawCostObservation[]>;
  listAllergens(organizationId: string): Promise<readonly AllergenRecord[]>;
  findAllergen(allergenId: string): Promise<AllergenRecord | undefined>;
  findAllergenByCode(organizationId: string, code: string): Promise<AllergenRecord | undefined>;
  createAllergen(input: NewAllergenRecord): Promise<AllergenRecord>;
  listRecipeAllergens(recipeVersionId: string): Promise<readonly RecipeAllergenRecordView[]>;
  createRecipeAllergen(input: NewRecipeAllergenRecord): Promise<void>;
  /** `DEC-123`: appends one recipe trial. */
  createRecipeTest(input: NewRecipeTestRecord): Promise<RecipeTestRecord>;
  /** One trial with its tried/resulting version identity, or `undefined`. */
  findRecipeTest(recipeTestId: string): Promise<RecipeTestView | undefined>;
  /** Trials by recipe or version, newest tested first (org-scoped). */
  listRecipeTests(query: ListRecipeTestsQuery): Promise<readonly RecipeTestView[]>;
  /**
   * The improvement loop's single forward link (`DEC-123`): sets the trial's
   * `resultingRecipeVersionId` from null only. Returns the updated trial, or
   * `undefined` when it is unknown or already linked.
   */
  linkRecipeTestToVersion(
    recipeTestId: string,
    resultingRecipeVersionId: string,
  ): Promise<RecipeTestRecord | undefined>;
  /** Append-only audit fact; the caller must not pass secrets (ADR-0003 convention). */
  writeAudit(input: AuditInput): Promise<void>;
}
