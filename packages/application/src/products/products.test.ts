import { DomainError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { assignRecipeToVariant } from "./assign-recipe-to-variant";
import { findProduct, findProductVariant, listProducts, listProductVariants } from "./reads";
import { registerProduct } from "./register-product";
import { registerProductVariant } from "./register-product-variant";
import { setAddonApplicability } from "./set-addon-applicability";
import { updateProductVariant } from "./update-product-variant";
import { FakeProductStore } from "./test-support";

const ORG = "org-1";
const OTHER_ORG = "org-2";
const ACTOR = "user-1";

function seeded(): FakeProductStore {
  const store = new FakeProductStore();
  store.addProduct({
    id: "p-base",
    organizationId: ORG,
    code: "CAKE",
    name: "Cake",
    productKind: "base",
  });
  store.addProduct({
    id: "p-foreign",
    organizationId: OTHER_ORG,
    code: "FOREIGN",
    name: "Foreign",
  });
  store.addLocation({ id: "loc-1", organizationId: ORG, code: "OSL", name: "Oslo" });
  store.addLocation({ id: "loc-foreign", organizationId: OTHER_ORG, code: "BER", name: "Bergen" });
  store.addItem({ id: "item-1", organizationId: ORG });
  store.addItem({ id: "item-for-use", organizationId: ORG, purpose: "for_use" });
  store.addItem({ id: "item-foreign", organizationId: OTHER_ORG });
  store.addRecipeVersion({
    id: "rv-approved",
    organizationId: ORG,
    recipeId: "r-1",
    state: "approved",
    versionNo: 1,
  });
  store.addRecipeVersion({
    id: "rv-draft",
    organizationId: ORG,
    recipeId: "r-1",
    state: "draft",
    versionNo: 2,
  });
  store.addRecipeVersion({
    id: "rv-foreign",
    organizationId: OTHER_ORG,
    recipeId: "r-2",
    state: "approved",
    versionNo: 1,
  });
  return store;
}

async function assertDomainError(run: () => Promise<unknown>, message: RegExp): Promise<void> {
  await expect(run()).rejects.toBeInstanceOf(DomainError);
  await expect(run()).rejects.toThrow(message);
}

describe("registerProduct", () => {
  it("creates a product and is idempotent on code", async () => {
    const store = seeded();
    const first = await registerProduct(store, {
      organizationId: ORG,
      actorId: ACTOR,
      code: "  PIZZA  ",
      name: "Pizza",
      productKind: "base",
    });
    const second = await registerProduct(store, {
      organizationId: ORG,
      actorId: ACTOR,
      code: "PIZZA",
      name: "Ignored",
    });

    expect(first.created).toBe(true);
    expect(second).toEqual({ productId: first.productId, created: false });
    expect(store.products.size).toBe(3);
    expect(store.audits.filter((a) => a.action === "products.product.registered")).toHaveLength(1);
  });

  it("rejects a blank code, a blank name and an unknown kind", async () => {
    const store = seeded();
    await assertDomainError(
      () => registerProduct(store, { organizationId: ORG, actorId: ACTOR, code: "  ", name: "X" }),
      /code must not be empty/,
    );
    await assertDomainError(
      () => registerProduct(store, { organizationId: ORG, actorId: ACTOR, code: "X", name: " " }),
      /name must not be empty/,
    );
    await assertDomainError(
      () =>
        registerProduct(store, {
          organizationId: ORG,
          actorId: ACTOR,
          code: "X",
          name: "X",
          productKind: "bundle",
        }),
      /product kind must be one of/,
    );
  });
});

describe("registerProductVariant", () => {
  it("registers a variant with a null finished-good item (made to order)", async () => {
    const store = seeded();
    const { productVariantId, created } = await registerProductVariant(store, {
      organizationId: ORG,
      actorId: ACTOR,
      productId: "p-base",
      code: "SMALL",
      sku: "CAKE-S",
      name: "Cake small",
      size: "8 slices",
    });

    expect(created).toBe(true);
    expect(store.variants.get(productVariantId)?.finishedGoodItemId).toBeNull();
    // Idempotent re-run on (product_id, code).
    const repeat = await registerProductVariant(store, {
      organizationId: ORG,
      actorId: ACTOR,
      productId: "p-base",
      code: "SMALL",
      sku: "DIFFERENT-SKU",
      name: "Ignored",
    });
    expect(repeat).toEqual({ productVariantId, created: false });
  });

  it("rejects a foreign product and a foreign finished-good item", async () => {
    const store = seeded();
    await assertDomainError(
      () =>
        registerProductVariant(store, {
          organizationId: ORG,
          actorId: ACTOR,
          productId: "p-foreign",
          code: "X",
          sku: "SKU-X",
          name: "X",
        }),
      /product not found in this organization/,
    );
    await assertDomainError(
      () =>
        registerProductVariant(store, {
          organizationId: ORG,
          actorId: ACTOR,
          productId: "p-base",
          code: "X",
          sku: "SKU-X",
          name: "X",
          finishedGoodItemId: "item-foreign",
        }),
      /finished-good item not found in this organization/,
    );
  });

  it("rejects a SKU collision with a different variant", async () => {
    const store = seeded();
    await registerProductVariant(store, {
      organizationId: ORG,
      actorId: ACTOR,
      productId: "p-base",
      code: "A",
      sku: "DUP",
      name: "A",
    });
    await assertDomainError(
      () =>
        registerProductVariant(store, {
          organizationId: ORG,
          actorId: ACTOR,
          productId: "p-base",
          code: "B",
          sku: "DUP",
          name: "B",
        }),
      /SKU already registered for this organization/,
    );
  });

  it("accepts an in-organization finished-good item", async () => {
    const store = seeded();
    const result = await registerProductVariant(store, {
      organizationId: ORG,
      actorId: ACTOR,
      productId: "p-base",
      code: "STOCKED",
      sku: "STOCKED-1",
      name: "Stocked",
      finishedGoodItemId: "item-1",
    });
    expect(store.variants.get(result.productVariantId)?.finishedGoodItemId).toBe("item-1");
  });

  it("rejects a for-use item as the finished good (DEC-150)", async () => {
    const store = seeded();
    await assertDomainError(
      () =>
        registerProductVariant(store, {
          organizationId: ORG,
          actorId: ACTOR,
          productId: "p-base",
          code: "USE",
          sku: "USE-1",
          name: "Use",
          finishedGoodItemId: "item-for-use",
        }),
      /must be for sale/,
    );
  });
});

describe("assignRecipeToVariant", () => {
  const window = {
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveTo: new Date("2026-02-01T00:00:00.000Z"),
  };

  async function withVariant(): Promise<{ store: FakeProductStore; productVariantId: string }> {
    const store = seeded();
    const { productVariantId } = await registerProductVariant(store, {
      organizationId: ORG,
      actorId: ACTOR,
      productId: "p-base",
      code: "V1",
      sku: "V1-SKU",
      name: "V1",
    });
    return { store, productVariantId };
  }

  it("assigns an approved version in an empty window", async () => {
    const { store, productVariantId } = await withVariant();
    const { assignmentId } = await assignRecipeToVariant(store, {
      organizationId: ORG,
      actorId: ACTOR,
      productVariantId,
      locationId: "loc-1",
      recipeVersionId: "rv-approved",
      ...window,
    });
    expect(assignmentId).toBeTruthy();
    expect(store.assignments).toHaveLength(1);
  });

  it("rejects a draft version", async () => {
    const { store, productVariantId } = await withVariant();
    await assertDomainError(
      () =>
        assignRecipeToVariant(store, {
          organizationId: ORG,
          actorId: ACTOR,
          productVariantId,
          locationId: "loc-1",
          recipeVersionId: "rv-draft",
          ...window,
        }),
      /must be approved/,
    );
  });

  it("rejects a foreign location and a foreign version", async () => {
    const { store, productVariantId } = await withVariant();
    await assertDomainError(
      () =>
        assignRecipeToVariant(store, {
          organizationId: ORG,
          actorId: ACTOR,
          productVariantId,
          locationId: "loc-foreign",
          recipeVersionId: "rv-approved",
          ...window,
        }),
      /location not found in this organization/,
    );
    await assertDomainError(
      () =>
        assignRecipeToVariant(store, {
          organizationId: ORG,
          actorId: ACTOR,
          productVariantId,
          locationId: "loc-1",
          recipeVersionId: "rv-foreign",
          ...window,
        }),
      /recipe version not found in this organization/,
    );
  });

  it("rejects an overlapping window for the same variant and location, but a later window is fine", async () => {
    const { store, productVariantId } = await withVariant();
    await assignRecipeToVariant(store, {
      organizationId: ORG,
      actorId: ACTOR,
      productVariantId,
      locationId: "loc-1",
      recipeVersionId: "rv-approved",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      effectiveTo: new Date("2026-02-01T00:00:00.000Z"),
    });

    await assertDomainError(
      () =>
        assignRecipeToVariant(store, {
          organizationId: ORG,
          actorId: ACTOR,
          productVariantId,
          locationId: "loc-1",
          recipeVersionId: "rv-approved",
          effectiveFrom: new Date("2026-01-15T00:00:00.000Z"),
          effectiveTo: new Date("2026-02-15T00:00:00.000Z"),
        }),
      /already effective in this window/,
    );

    // A different location is never an overlap.
    const other = await assignRecipeToVariant(store, {
      organizationId: ORG,
      actorId: ACTOR,
      productVariantId,
      locationId: "loc-1",
      recipeVersionId: "rv-approved",
      effectiveFrom: new Date("2026-02-01T00:00:00.000Z"),
      effectiveTo: null,
    });
    expect(other.assignmentId).toBeTruthy();
  });

  it("rejects a bounded window whose end is not after its start", async () => {
    const { store, productVariantId } = await withVariant();
    await assertDomainError(
      () =>
        assignRecipeToVariant(store, {
          organizationId: ORG,
          actorId: ACTOR,
          productVariantId,
          locationId: "loc-1",
          recipeVersionId: "rv-approved",
          effectiveFrom: new Date("2026-02-01T00:00:00.000Z"),
          effectiveTo: new Date("2026-02-01T00:00:00.000Z"),
        }),
      /effectiveTo must be after effectiveFrom/,
    );
  });
});

describe("setAddonApplicability", () => {
  async function withProducts(): Promise<{
    store: FakeProductStore;
    addonId: string;
    baseId: string;
  }> {
    const store = seeded();
    const addon = await registerProduct(store, {
      organizationId: ORG,
      actorId: ACTOR,
      code: "SPRINKLES",
      name: "Sprinkles",
      productKind: "add_on",
    });
    return { store, addonId: addon.productId, baseId: "p-base" };
  }

  it("registers the pair, is idempotent, and validates the price effect", async () => {
    const { store, addonId, baseId } = await withProducts();
    const first = await setAddonApplicability(store, {
      organizationId: ORG,
      actorId: ACTOR,
      addonProductId: addonId,
      baseProductId: baseId,
      priceEffect: "5.5",
    });
    expect(first.created).toBe(true);

    const repeat = await setAddonApplicability(store, {
      organizationId: ORG,
      actorId: ACTOR,
      addonProductId: addonId,
      baseProductId: baseId,
    });
    expect(repeat).toEqual({ addonApplicabilityId: first.addonApplicabilityId, created: false });
    expect(store.addons).toHaveLength(1);

    await assertDomainError(
      () =>
        setAddonApplicability(store, {
          organizationId: ORG,
          actorId: ACTOR,
          addonProductId: addonId,
          baseProductId: baseId,
          priceEffect: "1e3",
        }),
      /not a valid decimal/,
    );
  });

  it("rejects a product as its own add-on and a foreign product", async () => {
    const { store, addonId } = await withProducts();
    await assertDomainError(
      () =>
        setAddonApplicability(store, {
          organizationId: ORG,
          actorId: ACTOR,
          addonProductId: addonId,
          baseProductId: addonId,
        }),
      /cannot be its own add-on/,
    );
    await assertDomainError(
      () =>
        setAddonApplicability(store, {
          organizationId: ORG,
          actorId: ACTOR,
          addonProductId: addonId,
          baseProductId: "p-foreign",
        }),
      /base product not found in this organization/,
    );
  });
});

describe("reads", () => {
  it("lists products with their variants and resolves a variant detail", async () => {
    const store = seeded();
    const { productVariantId } = await registerProductVariant(store, {
      organizationId: ORG,
      actorId: ACTOR,
      productId: "p-base",
      code: "V1",
      sku: "V1-SKU",
      name: "V1",
    });
    await assignRecipeToVariant(store, {
      organizationId: ORG,
      actorId: ACTOR,
      productVariantId,
      locationId: "loc-1",
      recipeVersionId: "rv-approved",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    });
    const addon = await registerProduct(store, {
      organizationId: ORG,
      actorId: ACTOR,
      code: "SPRINKLES",
      name: "Sprinkles",
      productKind: "add_on",
    });
    await setAddonApplicability(store, {
      organizationId: ORG,
      actorId: ACTOR,
      addonProductId: addon.productId,
      baseProductId: "p-base",
    });

    const listed = await listProducts(store, { organizationId: ORG });
    expect(listed.map((row) => row.product.code)).toEqual(["CAKE", "SPRINKLES"]);
    expect(listed[0]?.variants.map((v) => v.code)).toEqual(["V1"]);

    const detail = await findProductVariant(store, { organizationId: ORG, productVariantId });
    expect(detail.product.code).toBe("CAKE");
    expect(detail.recipeAssignments).toHaveLength(1);
    expect(detail.recipeAssignments[0]).toMatchObject({
      locationCode: "OSL",
      recipeVersionNo: 1,
    });
    expect(detail.addonApplicability).toHaveLength(1);
    expect(detail.addonApplicability[0]?.addon.code).toBe("SPRINKLES");

    const product = await findProduct(store, { organizationId: ORG, productId: "p-base" });
    expect(product.variants).toHaveLength(1);
    const variants = await listProductVariants(store, {
      organizationId: ORG,
      productId: "p-base",
    });
    expect(variants).toHaveLength(1);

    await assertDomainError(
      () => findProduct(store, { organizationId: ORG, productId: "p-foreign" }),
      /product not found in organization/,
    );
    await assertDomainError(
      () => findProductVariant(store, { organizationId: ORG, productVariantId: "nope" }),
      /variant not found in organization/,
    );
  });

  it("updates only the mutable variant fields and clears the size", async () => {
    const store = seeded();
    const { productVariantId } = await registerProductVariant(store, {
      organizationId: ORG,
      actorId: ACTOR,
      productId: "p-base",
      code: "V1",
      sku: "V1-SKU",
      name: "V1",
      size: "8 slices",
    });

    await updateProductVariant(store, {
      organizationId: ORG,
      actorId: ACTOR,
      productVariantId,
      name: "Renamed",
      size: null,
      finishedGoodItemId: "item-1",
    });
    const updated = store.variants.get(productVariantId);
    expect(updated).toMatchObject({
      name: "Renamed",
      size: null,
      finishedGoodItemId: "item-1",
      code: "V1",
      sku: "V1-SKU",
    });

    await assertDomainError(
      () =>
        updateProductVariant(store, {
          organizationId: ORG,
          actorId: ACTOR,
          productVariantId,
          finishedGoodItemId: "item-foreign",
        }),
      /finished-good item not found in this organization/,
    );

    await assertDomainError(
      () =>
        updateProductVariant(store, {
          organizationId: ORG,
          actorId: ACTOR,
          productVariantId,
          finishedGoodItemId: "item-for-use",
        }),
      /must be for sale/,
    );
  });
});
