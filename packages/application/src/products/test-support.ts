import type { AuditInput } from "../auth";
import type {
  AddonApplicabilityRecord,
  ApprovedRecipeVersionOption,
  ItemScopeRecord,
  LocationOption,
  NewAddonApplicabilityRecord,
  NewProductRecord,
  NewProductVariantRecord,
  NewRecipeAssignmentRecord,
  OrgScopedRecord,
  ProductRecord,
  ProductStore,
  ProductVariantRecord,
  RecipeAssignmentRecord,
  RecipeVersionScopeRecord,
  UpdateProductVariantRecord,
} from "./types";

/**
 * In-memory `ProductStore` for the unit suite. It mirrors the observable
 * contract closely enough to exercise the commands and read services without a
 * database; `products.postgres.test.ts` covers the real adapter. The `add*`
 * methods seed fixtures directly.
 */
export class FakeProductStore implements ProductStore {
  readonly products = new Map<string, ProductRecord>();
  readonly variants = new Map<string, ProductVariantRecord>();
  readonly assignments: RecipeAssignmentRecord[] = [];
  readonly addons: AddonApplicabilityRecord[] = [];
  readonly locations = new Map<string, LocationOption>();
  readonly items = new Map<string, ItemScopeRecord>();
  readonly recipeVersions = new Map<string, RecipeVersionScopeRecord>();
  readonly approvedVersions: ApprovedRecipeVersionOption[] = [];
  readonly audits: AuditInput[] = [];

  private productSequence = 0;
  private variantSequence = 0;
  private assignmentSequence = 0;
  private addonSequence = 0;

  addProduct(
    record: Partial<ProductRecord> & { organizationId: string; code: string },
  ): ProductRecord {
    this.productSequence += 1;
    const product: ProductRecord = {
      id: record.id ?? `product-${this.productSequence}`,
      organizationId: record.organizationId,
      code: record.code,
      name: record.name ?? record.code,
      category: record.category ?? null,
      productKind: record.productKind ?? "base",
      activeFrom: record.activeFrom ?? "2026-01-01",
      activeTo: record.activeTo ?? null,
    };
    this.products.set(product.id, product);
    return product;
  }

  addVariant(
    record: Partial<ProductVariantRecord> & {
      organizationId: string;
      productId: string;
      code: string;
      sku: string;
    },
  ): ProductVariantRecord {
    this.variantSequence += 1;
    const variant: ProductVariantRecord = {
      id: record.id ?? `variant-${this.variantSequence}`,
      organizationId: record.organizationId,
      productId: record.productId,
      code: record.code,
      sku: record.sku,
      name: record.name ?? record.code,
      size: record.size ?? null,
      finishedGoodItemId: record.finishedGoodItemId ?? null,
      activeFrom: record.activeFrom ?? "2026-01-01",
      activeTo: record.activeTo ?? null,
    };
    this.variants.set(variant.id, variant);
    return variant;
  }

  addLocation(record: LocationOption): void {
    this.locations.set(record.id, record);
  }

  /**
   * Seeds a stocked item for the finished-good link. `DEC-150`: `purpose`
   * defaults to `for_sale` (the value the existing fixtures rely on); pass
   * `for_use` to exercise the guard.
   */
  addItem(record: OrgScopedRecord & { readonly purpose?: string }): void {
    this.items.set(record.id, {
      id: record.id,
      organizationId: record.organizationId,
      purpose: record.purpose ?? "for_sale",
    });
  }

  addRecipeVersion(record: RecipeVersionScopeRecord): void {
    this.recipeVersions.set(record.id, record);
    if (record.state === "approved") {
      this.approvedVersions.push({
        id: record.id,
        recipeId: record.recipeId,
        recipeCode: `R-${record.versionNo}`,
        recipeName: `Recipe ${record.versionNo}`,
        versionNo: record.versionNo,
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        effectiveTo: null,
      });
    }
  }

  withTransaction<T>(fn: (store: ProductStore) => Promise<T>): Promise<T> {
    return fn(this);
  }

  findProduct(productId: string): Promise<ProductRecord | undefined> {
    return Promise.resolve(this.products.get(productId));
  }

  findProductByCode(organizationId: string, code: string): Promise<ProductRecord | undefined> {
    return Promise.resolve(
      [...this.products.values()].find(
        (row) => row.organizationId === organizationId && row.code === code,
      ),
    );
  }

  createProduct(input: NewProductRecord): Promise<ProductRecord> {
    const product = this.addProduct({
      organizationId: input.organizationId,
      code: input.code,
      name: input.name,
      category: input.category,
      productKind: input.productKind,
    });
    return Promise.resolve(product);
  }

  listProducts(organizationId: string): Promise<readonly ProductRecord[]> {
    return Promise.resolve(
      [...this.products.values()]
        .filter((row) => row.organizationId === organizationId)
        .sort((a, b) => a.code.localeCompare(b.code)),
    );
  }

  findVariant(productVariantId: string): Promise<ProductVariantRecord | undefined> {
    return Promise.resolve(this.variants.get(productVariantId));
  }

  findVariantByCode(productId: string, code: string): Promise<ProductVariantRecord | undefined> {
    return Promise.resolve(
      [...this.variants.values()].find((row) => row.productId === productId && row.code === code),
    );
  }

  findVariantBySku(organizationId: string, sku: string): Promise<ProductVariantRecord | undefined> {
    return Promise.resolve(
      [...this.variants.values()].find(
        (row) => row.organizationId === organizationId && row.sku === sku,
      ),
    );
  }

  listVariants(productId: string): Promise<readonly ProductVariantRecord[]> {
    return Promise.resolve(
      [...this.variants.values()]
        .filter((row) => row.productId === productId)
        .sort((a, b) => a.code.localeCompare(b.code)),
    );
  }

  createVariant(input: NewProductVariantRecord): Promise<ProductVariantRecord> {
    const variant = this.addVariant({
      organizationId: input.organizationId,
      productId: input.productId,
      code: input.code,
      sku: input.sku,
      name: input.name,
      size: input.size,
      finishedGoodItemId: input.finishedGoodItemId,
    });
    return Promise.resolve(variant);
  }

  updateVariant(input: UpdateProductVariantRecord): Promise<void> {
    const existing = this.variants.get(input.productVariantId);
    if (existing !== undefined) {
      this.variants.set(input.productVariantId, {
        ...existing,
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.size === undefined ? {} : { size: input.size }),
        ...(input.finishedGoodItemId === undefined
          ? {}
          : { finishedGoodItemId: input.finishedGoodItemId }),
      });
    }
    return Promise.resolve();
  }

  findItemScope(itemId: string): Promise<ItemScopeRecord | undefined> {
    return Promise.resolve(this.items.get(itemId));
  }

  findLocationScope(locationId: string): Promise<LocationOption | undefined> {
    return Promise.resolve(this.locations.get(locationId));
  }

  listLocations(organizationId: string): Promise<readonly LocationOption[]> {
    return Promise.resolve(
      [...this.locations.values()].filter((row) => row.organizationId === organizationId),
    );
  }

  findRecipeVersionScope(recipeVersionId: string): Promise<RecipeVersionScopeRecord | undefined> {
    return Promise.resolve(this.recipeVersions.get(recipeVersionId));
  }

  listApprovedRecipeVersions(
    organizationId: string,
  ): Promise<readonly ApprovedRecipeVersionOption[]> {
    const ids = new Set(
      [...this.recipeVersions.values()]
        .filter((row) => row.organizationId === organizationId)
        .map((row) => row.id),
    );
    return Promise.resolve(this.approvedVersions.filter((row) => ids.has(row.id)));
  }

  createRecipeAssignment(input: NewRecipeAssignmentRecord): Promise<{ id: string }> {
    this.assignmentSequence += 1;
    const id = `assignment-${this.assignmentSequence}`;
    this.assignments.push({ id, ...input });
    return Promise.resolve({ id });
  }

  listRecipeAssignmentsForVariant(
    productVariantId: string,
  ): Promise<readonly RecipeAssignmentRecord[]> {
    return Promise.resolve(
      this.assignments.filter((row) => row.productVariantId === productVariantId),
    );
  }

  findAddonApplicability(
    addonProductId: string,
    baseProductId: string,
  ): Promise<AddonApplicabilityRecord | undefined> {
    return Promise.resolve(
      this.addons.find(
        (row) => row.addonProductId === addonProductId && row.baseProductId === baseProductId,
      ),
    );
  }

  createAddonApplicability(input: NewAddonApplicabilityRecord): Promise<AddonApplicabilityRecord> {
    this.addonSequence += 1;
    const record: AddonApplicabilityRecord = {
      id: `addon-${this.addonSequence}`,
      organizationId: input.organizationId,
      addonProductId: input.addonProductId,
      baseProductId: input.baseProductId,
      priceEffect: input.priceEffect,
      activeFrom: "2026-01-01",
      activeTo: null,
    };
    this.addons.push(record);
    return Promise.resolve(record);
  }

  listAddonApplicabilityForProduct(
    productId: string,
  ): Promise<readonly AddonApplicabilityRecord[]> {
    return Promise.resolve(
      this.addons.filter(
        (row) => row.addonProductId === productId || row.baseProductId === productId,
      ),
    );
  }

  writeAudit(input: AuditInput): Promise<void> {
    this.audits.push(input);
    return Promise.resolve();
  }
}
