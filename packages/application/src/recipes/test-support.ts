import type { AuditInput } from "../auth";
import type { ConversionEdge } from "../catalog";
import type {
  AllergenRecord,
  FindVariantRecipeAssignmentQuery,
  ListRecipesQuery,
  ListRecipeTestsQuery,
  NewAllergenRecord,
  NewRecipeAllergenRecord,
  NewRecipeLineRecord,
  NewRecipeRecord,
  NewRecipeTestRecord,
  NewRecipeVersionRecord,
  RawCostObservation,
  RecipeAllergenRecordView,
  RecipeCostCenterRecord,
  RecipeItemRecord,
  RecipeLineRecord,
  RecipeRecord,
  RecipeStore,
  RecipeSubRecipeEdge,
  RecipeTestRecord,
  RecipeTestView,
  RecipeUnit,
  RecipeVersionRecord,
  SupplierPriceCandidate,
  VariantRecipeAssignmentRecord,
} from "./types";

/** An effective-dated assignment row seeded into `FakeRecipeStore`. */
export interface FakeRecipeAssignment {
  readonly organizationId: string;
  readonly productVariantId: string;
  readonly locationId: string;
  readonly recipeVersionId: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
}

/**
 * In-memory `RecipeStore` for the unit suite. It mirrors the observable contract
 * closely enough to exercise the commands without a database;
 * `recipes.postgres.test.ts` covers the real adapter.
 */
export class FakeRecipeStore implements RecipeStore {
  readonly units = new Map<string, RecipeUnit>();
  readonly items = new Map<string, RecipeItemRecord>();
  readonly costCenters = new Map<string, RecipeCostCenterRecord>();
  readonly recipes = new Map<string, RecipeRecord>();
  readonly versions: RecipeVersionRecord[] = [];
  readonly lines: RecipeLineRecord[] = [];
  readonly allergens = new Map<string, AllergenRecord>();
  readonly allergenDeclarations: NewRecipeAllergenRecord[] = [];
  readonly subRecipeEdges: RecipeSubRecipeEdge[] = [];
  readonly conversions: ConversionEdge[] = [];
  readonly variantRecipeAssignments: FakeRecipeAssignment[] = [];
  readonly supplierPrices = new Map<string, SupplierPriceCandidate[]>();
  readonly observations = new Map<string, RawCostObservation[]>();
  /** `DEC-123`: append-only recipe trials, keyed by id. */
  readonly recipeTests = new Map<string, RecipeTestRecord>();
  readonly audits: AuditInput[] = [];

  private sequence = 0;
  /** A strictly increasing clock so trial ordering is deterministic in tests. */
  private testClock = 0;

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

  findItem(itemId: string): Promise<RecipeItemRecord | undefined> {
    return Promise.resolve(this.items.get(itemId));
  }

  findCostCenter(costCenterId: string): Promise<RecipeCostCenterRecord | undefined> {
    return Promise.resolve(this.costCenters.get(costCenterId));
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

  listRecipes(organizationId: string, query: ListRecipesQuery): Promise<readonly RecipeRecord[]> {
    const term = query.search?.trim().toLowerCase();
    const filtered = [...this.recipes.values()]
      .filter((recipe) => recipe.organizationId === organizationId)
      .filter(
        (recipe) =>
          term === undefined ||
          term.length === 0 ||
          recipe.code.toLowerCase().includes(term) ||
          recipe.name.toLowerCase().includes(term),
      )
      .sort((a, b) => a.code.localeCompare(b.code));
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 50;
    return Promise.resolve(filtered.slice(offset, offset + limit));
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

  addVariantRecipeAssignment(input: FakeRecipeAssignment): void {
    this.variantRecipeAssignments.push(input);
  }

  findVariantRecipeAssignment(
    query: FindVariantRecipeAssignmentQuery,
  ): Promise<VariantRecipeAssignmentRecord | undefined> {
    const match = this.variantRecipeAssignments.find(
      (row) =>
        row.organizationId === query.organizationId &&
        row.productVariantId === query.productVariantId &&
        row.locationId === query.locationId &&
        row.effectiveFrom.getTime() <= query.asOf.getTime() &&
        (row.effectiveTo === null || query.asOf.getTime() < row.effectiveTo.getTime()),
    );
    return Promise.resolve(
      match === undefined ? undefined : { recipeVersionId: match.recipeVersionId },
    );
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

  /** Resolves a stored trial to the view shape the reads expose. */
  private recipeTestView(record: RecipeTestRecord): RecipeTestView {
    const tried = this.versions.find((version) => version.id === record.recipeVersionId);
    const resulting =
      record.resultingRecipeVersionId === null
        ? undefined
        : this.versions.find((version) => version.id === record.resultingRecipeVersionId);
    return {
      ...record,
      recipeId: tried?.recipeId ?? "",
      testedVersionNo: tried?.versionNo ?? 0,
      testedVersionState: tried?.state ?? "",
      resultingVersionNo: resulting?.versionNo ?? null,
      resultingVersionState: resulting?.state ?? null,
    };
  }

  createRecipeTest(input: NewRecipeTestRecord): Promise<RecipeTestRecord> {
    this.testClock += 1;
    const record: RecipeTestRecord = {
      id: this.nextId("recipe-test"),
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, this.testClock)),
      resultingRecipeVersionId: null,
      ...input,
    };
    this.recipeTests.set(record.id, record);
    return Promise.resolve(record);
  }

  findRecipeTest(recipeTestId: string): Promise<RecipeTestView | undefined> {
    const record = this.recipeTests.get(recipeTestId);
    return Promise.resolve(record === undefined ? undefined : this.recipeTestView(record));
  }

  listRecipeTests(query: ListRecipeTestsQuery): Promise<readonly RecipeTestView[]> {
    const rows = [...this.recipeTests.values()].filter((record) => {
      if (record.organizationId !== query.organizationId) {
        return false;
      }
      if (query.recipeVersionId !== undefined) {
        return record.recipeVersionId === query.recipeVersionId;
      }
      if (query.recipeId !== undefined) {
        const version = this.versions.find((entry) => entry.id === record.recipeVersionId);
        return version?.recipeId === query.recipeId;
      }
      return false;
    });
    rows.sort(
      (a, b) =>
        b.testedAt.getTime() - a.testedAt.getTime() ||
        b.createdAt.getTime() - a.createdAt.getTime(),
    );
    return Promise.resolve(rows.map((record) => this.recipeTestView(record)));
  }

  linkRecipeTestToVersion(
    recipeTestId: string,
    resultingRecipeVersionId: string,
  ): Promise<RecipeTestRecord | undefined> {
    const record = this.recipeTests.get(recipeTestId);
    if (record === undefined || record.resultingRecipeVersionId !== null) {
      return Promise.resolve(undefined);
    }
    const updated: RecipeTestRecord = { ...record, resultingRecipeVersionId };
    this.recipeTests.set(recipeTestId, updated);
    return Promise.resolve(updated);
  }

  writeAudit(input: AuditInput): Promise<void> {
    this.audits.push(input);
    return Promise.resolve();
  }
}
