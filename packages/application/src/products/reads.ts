import { DomainError } from "@aquarela/domain";

import type {
  AddonApplicabilityRecord,
  ApprovedRecipeVersionOption,
  LocationOption,
  ProductRecord,
  ProductStore,
  ProductVariantRecord,
  RecipeAssignmentRecord,
} from "./types";

/* --------------------------------- inputs ---------------------------------- */

export interface ListProductsInput {
  readonly organizationId: string;
}

export interface FindProductInput {
  readonly organizationId: string;
  readonly productId: string;
}

export interface ListProductVariantsInput {
  readonly organizationId: string;
  readonly productId: string;
}

export interface FindProductVariantInput {
  readonly organizationId: string;
  readonly productVariantId: string;
}

/* --------------------------------- views ----------------------------------- */

/** A product with its variants (the list and detail reads share this shape). */
export interface ProductWithVariants {
  readonly product: ProductRecord;
  readonly variants: readonly ProductVariantRecord[];
}

/** A minimal product reference for an add-on row. */
export interface ProductRef {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

/** One effective recipe assignment enriched with its location and version. */
export interface VariantRecipeAssignmentView {
  readonly id: string;
  readonly locationId: string;
  readonly locationCode: string;
  readonly locationName: string;
  readonly recipeVersionId: string;
  readonly recipeVersionNo: number;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
}

/** One add-on applicability row with both product references resolved. */
export interface AddonApplicabilityView {
  readonly id: string;
  readonly addon: ProductRef;
  readonly base: ProductRef;
  readonly priceEffect: string | null;
  readonly activeFrom: string;
  readonly activeTo: string | null;
}

/** The full variant detail: identity, its product, recipe assignments and add-ons. */
export interface ProductVariantDetail {
  readonly variant: ProductVariantRecord;
  readonly product: ProductRef;
  readonly recipeAssignments: readonly VariantRecipeAssignmentView[];
  readonly addonApplicability: readonly AddonApplicabilityView[];
}

/** The pickers the assignment form needs (locations and approved versions). */
export interface AssignmentOptions {
  readonly locations: readonly LocationOption[];
  readonly recipeVersions: readonly ApprovedRecipeVersionOption[];
}

/* -------------------------------- services --------------------------------- */

/** All products for the organization, each with its variants, ordered by code. */
export async function listProducts(
  store: ProductStore,
  input: ListProductsInput,
): Promise<readonly ProductWithVariants[]> {
  const products = await store.listProducts(input.organizationId);
  const withVariants: ProductWithVariants[] = [];
  for (const product of products) {
    withVariants.push({ product, variants: await store.listVariants(product.id) });
  }
  return withVariants;
}

/** One product with its variants; unknown or cross-organization ids fail. */
export async function findProduct(
  store: ProductStore,
  input: FindProductInput,
): Promise<ProductWithVariants> {
  const product = await store.findProduct(input.productId);
  if (product === undefined || product.organizationId !== input.organizationId) {
    throw new DomainError("product not found in organization");
  }
  return { product, variants: await store.listVariants(product.id) };
}

/** The variants of one product; unknown or cross-organization products fail. */
export async function listProductVariants(
  store: ProductStore,
  input: ListProductVariantsInput,
): Promise<readonly ProductVariantRecord[]> {
  const product = await store.findProduct(input.productId);
  if (product === undefined || product.organizationId !== input.organizationId) {
    throw new DomainError("product not found in organization");
  }
  return store.listVariants(product.id);
}

function toProductRef(product: ProductRecord): ProductRef {
  return { id: product.id, code: product.code, name: product.name };
}

async function toAssignmentView(
  store: ProductStore,
  assignment: RecipeAssignmentRecord,
): Promise<VariantRecipeAssignmentView> {
  const [location, version] = await Promise.all([
    store.findLocationScope(assignment.locationId),
    store.findRecipeVersionScope(assignment.recipeVersionId),
  ]);
  return {
    id: assignment.id,
    locationId: assignment.locationId,
    locationCode: location?.code ?? "",
    locationName: location?.name ?? "",
    recipeVersionId: assignment.recipeVersionId,
    recipeVersionNo: version?.versionNo ?? 0,
    effectiveFrom: assignment.effectiveFrom,
    effectiveTo: assignment.effectiveTo,
  };
}

async function toAddonView(
  store: ProductStore,
  row: AddonApplicabilityRecord,
  refs: Map<string, ProductRef>,
): Promise<AddonApplicabilityView | undefined> {
  async function ref(productId: string): Promise<ProductRef | undefined> {
    const cached = refs.get(productId);
    if (cached !== undefined) {
      return cached;
    }
    const product = await store.findProduct(productId);
    if (product === undefined) {
      return undefined;
    }
    const resolved = toProductRef(product);
    refs.set(productId, resolved);
    return resolved;
  }
  const [addon, base] = await Promise.all([ref(row.addonProductId), ref(row.baseProductId)]);
  if (addon === undefined || base === undefined) {
    return undefined;
  }
  return {
    id: row.id,
    addon,
    base,
    priceEffect: row.priceEffect,
    activeFrom: row.activeFrom,
    activeTo: row.activeTo,
  };
}

/**
 * One variant with its product, its effective-dated recipe assignments and the
 * add-on applicability rows naming its product. Org-scoped: an unknown or
 * cross-organization variant is a domain failure.
 */
export async function findProductVariant(
  store: ProductStore,
  input: FindProductVariantInput,
): Promise<ProductVariantDetail> {
  const variant = await store.findVariant(input.productVariantId);
  if (variant === undefined || variant.organizationId !== input.organizationId) {
    throw new DomainError("product variant not found in organization");
  }
  const product = await store.findProduct(variant.productId);
  if (product === undefined) {
    throw new DomainError("product not found in organization");
  }

  const [assignments, addonRows] = await Promise.all([
    store.listRecipeAssignmentsForVariant(variant.id),
    store.listAddonApplicabilityForProduct(product.id),
  ]);
  const refs = new Map<string, ProductRef>();
  const assignmentViews = await Promise.all(
    assignments.map((assignment) => toAssignmentView(store, assignment)),
  );
  const addonViews = (
    await Promise.all(addonRows.map((row) => toAddonView(store, row, refs)))
  ).filter((view): view is AddonApplicabilityView => view !== undefined);

  return {
    variant,
    product: toProductRef(product),
    recipeAssignments: assignmentViews,
    addonApplicability: addonViews,
  };
}

/** The locations and approved recipe versions offered to the assignment form. */
export async function listAssignmentOptions(
  store: ProductStore,
  input: ListProductsInput,
): Promise<AssignmentOptions> {
  const [locations, recipeVersions] = await Promise.all([
    store.listLocations(input.organizationId),
    store.listApprovedRecipeVersions(input.organizationId),
  ]);
  return { locations, recipeVersions };
}
