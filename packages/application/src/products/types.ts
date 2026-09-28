import type { AuditInput } from "../auth";

/**
 * Application-level ports and DTOs for slice-13 product & variant identity
 * (`DEC-128`). `product`, `product_variant`, `product_recipe_assignment` and
 * `addon_applicability` are schema-only today: nothing can create what we sell
 * or attach a recipe to it. The store is a narrow port over
 * `@aquarela/persistence` so the commands can be unit-tested against an
 * in-memory fake; `createPostgresProductStore` is the real adapter.
 *
 * `DEC-030`: the **variant** is the sellable identity — a product groups
 * variants, and the variant carries the SKU, the size and (optionally) the
 * stocked `item` it is fulfilled from. Record types are structural subsets of
 * the persistence rows; `date` columns stay `yyyy-mm-dd` strings, `timestamptz`
 * columns stay `Date` and money stays a numeric(19,4) string.
 */

/** `product` (`PRODUCT_KIND` ∈ {base, variant, add_on}). */
export interface ProductRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly code: string;
  readonly name: string;
  readonly category: string | null;
  readonly productKind: string;
  /** `date` (`yyyy-mm-dd`). */
  readonly activeFrom: string;
  readonly activeTo: string | null;
}

export interface NewProductRecord {
  readonly organizationId: string;
  readonly code: string;
  readonly name: string;
  readonly category: string | null;
  readonly productKind: string;
}

/** `product_variant` — the sellable identity (`DEC-030`). */
export interface ProductVariantRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly productId: string;
  readonly code: string;
  readonly sku: string;
  readonly name: string;
  readonly size: string | null;
  /**
   * The stocked finished-good `item` the variant is fulfilled from. **Nullable
   * on purpose**: a made-to-order variant genuinely has no stocked item, so it
   * must never be required.
   */
  readonly finishedGoodItemId: string | null;
  readonly activeFrom: string;
  readonly activeTo: string | null;
}

export interface NewProductVariantRecord {
  readonly organizationId: string;
  readonly productId: string;
  readonly code: string;
  readonly sku: string;
  readonly name: string;
  readonly size: string | null;
  readonly finishedGoodItemId: string | null;
}

/**
 * The mutable variant fields `updateProductVariant` accepts. `code`, `sku` and
 * `productId` are deliberately absent — they are the identity that external
 * mappings and history resolve against (`DEC-041`), so they are created, never
 * rewritten. The mutable set is the display label `name`, the display `size`
 * and the nullable `finishedGoodItemId` link (attaching or detaching the stocked
 * good; a null value clears it and must stay legal).
 */
export interface UpdateProductVariantRecord {
  readonly productVariantId: string;
  readonly name?: string;
  /** `null` clears the size; absent leaves it unchanged. */
  readonly size?: string | null;
  /** `null` detaches the stocked item; absent leaves it unchanged. */
  readonly finishedGoodItemId?: string | null;
}

/** `product_recipe_assignment` — which recipe version a variant makes at a location. */
export interface RecipeAssignmentRecord {
  readonly id: string;
  readonly productVariantId: string;
  readonly locationId: string;
  readonly recipeVersionId: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
}

export interface NewRecipeAssignmentRecord {
  readonly productVariantId: string;
  readonly locationId: string;
  readonly recipeVersionId: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
}

/** `addon_applicability` — an add-on product may attach to a base product. */
export interface AddonApplicabilityRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly addonProductId: string;
  readonly baseProductId: string;
  /** numeric(19,4); null when the add-on carries no fixed price effect. */
  readonly priceEffect: string | null;
  readonly activeFrom: string;
  readonly activeTo: string | null;
}

export interface NewAddonApplicabilityRecord {
  readonly organizationId: string;
  readonly addonProductId: string;
  readonly baseProductId: string;
  readonly priceEffect: string | null;
}

/** The `(id, organizationId)` scope a foreign reference is validated against. */
export interface OrgScopedRecord {
  readonly id: string;
  readonly organizationId: string;
}

/**
 * `DEC-150`: the scope of a stocked item plus its purpose, so the variant
 * commands can refuse a for-use item as a finished good (the friendly layer over
 * the `product_variant_finished_good_purpose_guard` trigger).
 */
export interface ItemScopeRecord extends OrgScopedRecord {
  readonly purpose: string;
}

/** A `location` option for the recipe-assignment picker. */
export interface LocationOption extends OrgScopedRecord {
  readonly code: string;
  readonly name: string;
}

/** The scope of a `recipe_version` (org comes from its `recipe`), for validation. */
export interface RecipeVersionScopeRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly recipeId: string;
  readonly state: string;
  readonly versionNo: number;
}

/** One approved recipe version offered to the assignment picker. */
export interface ApprovedRecipeVersionOption {
  readonly id: string;
  readonly recipeId: string;
  readonly recipeCode: string;
  readonly recipeName: string;
  readonly versionNo: number;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
}

export interface ProductStore {
  /**
   * Runs `fn` with a store bound to one database transaction, so the duplicate
   * check and the insert in each command commit (or roll back) together. When
   * the store is already bound to a transaction it runs inline.
   */
  withTransaction<T>(fn: (store: ProductStore) => Promise<T>): Promise<T>;
  /** By id; organization-agnostic, so the caller must scope by `organizationId`. */
  findProduct(productId: string): Promise<ProductRecord | undefined>;
  /** `product.code` is unique per organization (`product_organization_id_code_key`). */
  findProductByCode(organizationId: string, code: string): Promise<ProductRecord | undefined>;
  createProduct(input: NewProductRecord): Promise<ProductRecord>;
  /** All products for one organization, ordered by code. */
  listProducts(organizationId: string): Promise<readonly ProductRecord[]>;
  /** By id; organization-agnostic, so the caller must scope by `organizationId`. */
  findVariant(productVariantId: string): Promise<ProductVariantRecord | undefined>;
  /** `product_variant.code` is unique per product (`product_variant_product_id_code_key`). */
  findVariantByCode(productId: string, code: string): Promise<ProductVariantRecord | undefined>;
  /** `product_variant.sku` is unique per organization (`..._organization_id_sku_key`). */
  findVariantBySku(organizationId: string, sku: string): Promise<ProductVariantRecord | undefined>;
  listVariants(productId: string): Promise<readonly ProductVariantRecord[]>;
  createVariant(input: NewProductVariantRecord): Promise<ProductVariantRecord>;
  /** Applies the mutable variant fields to one existing variant. */
  updateVariant(input: UpdateProductVariantRecord): Promise<void>;
  /** The scope + purpose of a stocked `item`, for the nullable finished-good link. */
  findItemScope(itemId: string): Promise<ItemScopeRecord | undefined>;
  findLocationScope(locationId: string): Promise<LocationOption | undefined>;
  listLocations(organizationId: string): Promise<readonly LocationOption[]>;
  /** The scope of a `recipe_version` (its organization comes from the recipe). */
  findRecipeVersionScope(recipeVersionId: string): Promise<RecipeVersionScopeRecord | undefined>;
  /** Approved (`state = 'approved'`) versions for the organization, newest first. */
  listApprovedRecipeVersions(
    organizationId: string,
  ): Promise<readonly ApprovedRecipeVersionOption[]>;
  createRecipeAssignment(input: NewRecipeAssignmentRecord): Promise<{ readonly id: string }>;
  /** Every assignment for one variant (the overlap check and the detail read). */
  listRecipeAssignmentsForVariant(
    productVariantId: string,
  ): Promise<readonly RecipeAssignmentRecord[]>;
  /** Idempotency key for `setAddonApplicability` (the pair is not unique in SQL). */
  findAddonApplicability(
    addonProductId: string,
    baseProductId: string,
  ): Promise<AddonApplicabilityRecord | undefined>;
  createAddonApplicability(input: NewAddonApplicabilityRecord): Promise<AddonApplicabilityRecord>;
  /** Every applicability row naming one product, as add-on or as base. */
  listAddonApplicabilityForProduct(productId: string): Promise<readonly AddonApplicabilityRecord[]>;
  /** Append-only audit fact; the caller must not pass secrets (ADR-0003 convention). */
  writeAudit(input: AuditInput): Promise<void>;
}
