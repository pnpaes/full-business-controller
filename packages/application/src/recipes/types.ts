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
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
  readonly approvedBy: string | null;
  readonly approvedAt: Date | null;
  readonly notes: string | null;
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
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
  readonly approvedBy: string | null;
  readonly approvedAt: Date | null;
  readonly notes: string | null;
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
  findRecipe(recipeId: string): Promise<RecipeRecord | undefined>;
  findRecipeByCode(organizationId: string, code: string): Promise<RecipeRecord | undefined>;
  /** Organization-scoped recipe list with an optional search and bounded pagination. */
  listRecipes(organizationId: string, query: ListRecipesQuery): Promise<readonly RecipeRecord[]>;
  createRecipe(input: NewRecipeRecord): Promise<RecipeRecord>;
  findRecipeVersion(recipeVersionId: string): Promise<RecipeVersionRecord | undefined>;
  listRecipeVersions(recipeId: string): Promise<readonly RecipeVersionRecord[]>;
  createRecipeVersion(input: NewRecipeVersionRecord): Promise<RecipeVersionRecord>;
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
  /** Append-only audit fact; the caller must not pass secrets (ADR-0003 convention). */
  writeAudit(input: AuditInput): Promise<void>;
}
