import type { AuditInput } from "../auth";
import type { ConversionEdge } from "../catalog";
import type {
  AllergenRecord,
  NewAllergenRecord,
  NewRecipeAllergenRecord,
  NewRecipeLineRecord,
  NewRecipeRecord,
  NewRecipeVersionRecord,
  RawCostObservation,
  RecipeAllergenRecordView,
  RecipeLineRecord,
  RecipeRecord,
  RecipeStore,
  RecipeSubRecipeEdge,
  RecipeUnit,
  RecipeVersionRecord,
  SupplierPriceCandidate,
} from "./types";

/**
 * In-memory `RecipeStore` for the unit suite. It mirrors the observable contract
 * closely enough to exercise the commands without a database;
 * `recipes.postgres.test.ts` covers the real adapter.
 */
export class FakeRecipeStore implements RecipeStore {
  readonly units = new Map<string, RecipeUnit>();
  readonly items = new Map<
    string,
    { id: string; organizationId: string; baseUnitId: string; currentCost: string | null }
  >();
  readonly recipes = new Map<string, RecipeRecord>();
  readonly versions: RecipeVersionRecord[] = [];
  readonly lines: RecipeLineRecord[] = [];
  readonly allergens = new Map<string, AllergenRecord>();
  readonly allergenDeclarations: NewRecipeAllergenRecord[] = [];
  readonly subRecipeEdges: RecipeSubRecipeEdge[] = [];
  readonly conversions: ConversionEdge[] = [];
  readonly supplierPrices = new Map<string, SupplierPriceCandidate[]>();
  readonly observations = new Map<string, RawCostObservation[]>();
  readonly audits: AuditInput[] = [];

  private sequence = 0;

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }

  addConversion(edge: ConversionEdge): void {
    this.conversions.push(edge);
  }

  async withTransaction<T>(fn: (store: RecipeStore) => Promise<T>): Promise<T> {
    return fn(this);
  }

  findUnit(unitId: string): Promise<RecipeUnit | undefined> {
    return Promise.resolve(this.units.get(unitId));
  }

  findItem(itemId: string): Promise<ReturnType<FakeRecipeStore["items"]["get"]>> {
    return Promise.resolve(this.items.get(itemId));
  }

  findRecipe(recipeId: string): Promise<RecipeRecord | undefined> {
    return Promise.resolve(this.recipes.get(recipeId));
  }

  findRecipeByCode(organizationId: string, code: string): Promise<RecipeRecord | undefined> {
    return Promise.resolve(
      [...this.recipes.values()].find(
        (recipe) => recipe.organizationId === organizationId && recipe.code === code,
      ),
    );
  }

  createRecipe(input: NewRecipeRecord): Promise<RecipeRecord> {
    const record: RecipeRecord = { id: this.nextId("recipe"), ...input };
    this.recipes.set(record.id, record);
    return Promise.resolve(record);
  }

  findRecipeVersion(recipeVersionId: string): Promise<RecipeVersionRecord | undefined> {
    return Promise.resolve(this.versions.find((version) => version.id === recipeVersionId));
  }

  listRecipeVersions(recipeId: string): Promise<readonly RecipeVersionRecord[]> {
    return Promise.resolve(this.versions.filter((version) => version.recipeId === recipeId));
  }

  createRecipeVersion(input: NewRecipeVersionRecord): Promise<RecipeVersionRecord> {
    const record: RecipeVersionRecord = { id: this.nextId("recipe-version"), ...input };
    this.versions.push(record);
    return Promise.resolve(record);
  }

  listRecipeLines(recipeVersionId: string): Promise<readonly RecipeLineRecord[]> {
    return Promise.resolve(this.lines.filter((line) => line.recipeVersionId === recipeVersionId));
  }

  createRecipeLine(input: NewRecipeLineRecord): Promise<RecipeLineRecord> {
    const record: RecipeLineRecord = { id: this.nextId("recipe-line"), ...input };
    this.lines.push(record);
    if (record.componentKind === "sub_recipe" && record.subRecipeId !== null) {
      const parentVersion = this.versions.find((version) => version.id === record.recipeVersionId);
      if (parentVersion !== undefined) {
        this.subRecipeEdges.push({
          parentRecipeId: parentVersion.recipeId,
          childRecipeId: record.subRecipeId,
        });
      }
    }
    return Promise.resolve(record);
  }

  listSubRecipeEdges(): Promise<readonly RecipeSubRecipeEdge[]> {
    return Promise.resolve(this.subRecipeEdges);
  }

  listEffectiveConversions(
    _organizationId: string,
    asOf: Date,
    itemId: string | null,
  ): Promise<readonly ConversionEdge[]> {
    return Promise.resolve(
      this.conversions.filter((edge) => {
        const effective =
          edge.effectiveFrom.getTime() <= asOf.getTime() &&
          (edge.effectiveTo === null || asOf.getTime() < edge.effectiveTo.getTime());
        if (!effective) {
          return false;
        }
        return itemId === null
          ? edge.itemId === null
          : edge.itemId === null || edge.itemId === itemId;
      }),
    );
  }

  listEffectiveSupplierPrices(
    _organizationId: string,
    itemId: string,
  ): Promise<readonly SupplierPriceCandidate[]> {
    return Promise.resolve(this.supplierPrices.get(itemId) ?? []);
  }

  listCostObservations(
    _organizationId: string,
    itemId: string,
  ): Promise<readonly RawCostObservation[]> {
    return Promise.resolve(this.observations.get(itemId) ?? []);
  }

  listAllergens(): Promise<readonly AllergenRecord[]> {
    return Promise.resolve([...this.allergens.values()]);
  }

  findAllergen(allergenId: string): Promise<AllergenRecord | undefined> {
    return Promise.resolve(this.allergens.get(allergenId));
  }

  findAllergenByCode(organizationId: string, code: string): Promise<AllergenRecord | undefined> {
    return Promise.resolve(
      [...this.allergens.values()].find(
        (allergen) => allergen.organizationId === organizationId && allergen.code === code,
      ),
    );
  }

  createAllergen(input: NewAllergenRecord): Promise<AllergenRecord> {
    const record: AllergenRecord = { id: this.nextId("allergen"), ...input };
    this.allergens.set(record.id, record);
    return Promise.resolve(record);
  }

  listRecipeAllergens(recipeVersionId: string): Promise<readonly RecipeAllergenRecordView[]> {
    return Promise.resolve(
      this.allergenDeclarations
        .filter((declaration) => declaration.recipeVersionId === recipeVersionId)
        .map((declaration) => {
          const master = this.allergens.get(declaration.allergenId);
          return {
            allergenId: declaration.allergenId,
            code: master?.code ?? "",
            name: master?.name ?? "",
            isDerived: master?.isDerived ?? false,
            source: declaration.source,
            verifiedBy: declaration.verifiedBy,
          };
        }),
    );
  }

  createRecipeAllergen(input: NewRecipeAllergenRecord): Promise<void> {
    this.allergenDeclarations.push(input);
    return Promise.resolve();
  }

  writeAudit(input: AuditInput): Promise<void> {
    this.audits.push(input);
    return Promise.resolve();
  }
}
