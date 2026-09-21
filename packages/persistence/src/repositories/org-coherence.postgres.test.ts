import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient, type DatabaseTransaction } from "../client";
import {
  allergen,
  goodsReceipt,
  goodsReceiptLine,
  recipeAllergen,
  recipeLine,
  supplier,
  supplierItem,
} from "../schema";
import {
  createTestItem,
  createTestLocation,
  createTestOrganization,
  createTestRecipe,
  createTestRecipeVersion,
  createTestUnit,
  inRollback,
  rejectionCause,
  uniqueName,
  uniqueSuffix,
} from "./test-support";

const databaseUrl = process.env.DATABASE_URL;

/**
 * `DEC-079` org-coherence guards (migration `0029`).
 *
 * Every test seeds both organizations inside the transaction under test, so the
 * guard's cross-organization comparisons run against rows that exist only in
 * that rollback. The guard is a `BEFORE INSERT OR UPDATE` trigger: it rejects a
 * foreign-organization reference and lets a matching one through, while the new
 * `goods_receipt_line.supplier_item_id` FK owns existence.
 */
describe.skipIf(!databaseUrl)("DEC-079 org coherence guards", () => {
  let client: DbClient;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
  });

  afterAll(async () => {
    if (client) {
      await client.close();
    }
  });

  type OrgSeed = {
    readonly orgId: string;
    readonly unitId: string;
    readonly itemId: string;
    readonly recipeId: string;
    readonly versionId: string;
    readonly allergenId: string;
  };

  async function seedOrg(tx: DatabaseTransaction, label: string): Promise<OrgSeed> {
    const orgId = await createTestOrganization(tx, uniqueSuffix());
    const unit = await createTestUnit(tx, orgId);
    const item = await createTestItem(tx, orgId, unit.id);
    const recipe = await createTestRecipe(tx, orgId);
    const version = await createTestRecipeVersion(tx, recipe.id);
    const allergens = await tx
      .insert(allergen)
      .values({ organizationId: orgId, code: uniqueName("allergen"), name: `Allergen ${label}` })
      .returning({ id: allergen.id });
    return {
      orgId,
      unitId: unit.id,
      itemId: item.id,
      recipeId: recipe.id,
      versionId: version.id,
      allergenId: allergens[0]!.id,
    };
  }

  type ReceiptSeed = OrgSeed & {
    readonly supplierId: string;
    readonly supplierItemId: string;
    readonly receiptId: string;
  };

  async function seedReceipt(
    tx: DatabaseTransaction,
    label: string,
    seed: OrgSeed,
  ): Promise<ReceiptSeed> {
    const location = await createTestLocation(tx, seed.orgId);
    const suppliers = await tx
      .insert(supplier)
      .values({
        organizationId: seed.orgId,
        code: uniqueName("sup"),
        name: `Supplier ${label}`,
        currency: "NOK",
      })
      .returning({ id: supplier.id });
    const supplierItems = await tx
      .insert(supplierItem)
      .values({
        organizationId: seed.orgId,
        supplierId: suppliers[0]!.id,
        itemId: seed.itemId,
        supplierSku: uniqueName("ssku"),
        packUnitId: seed.unitId,
        packToBaseUnitFactor: "1",
      })
      .returning({ id: supplierItem.id });
    const receipts = await tx
      .insert(goodsReceipt)
      .values({
        organizationId: seed.orgId,
        supplierId: suppliers[0]!.id,
        locationId: location.id,
        receivedAt: new Date("2026-03-01T00:00:00.000Z"),
      })
      .returning({ id: goodsReceipt.id });
    return {
      ...seed,
      supplierId: suppliers[0]!.id,
      supplierItemId: supplierItems[0]!.id,
      receiptId: receipts[0]!.id,
    };
  }

  function receiptLine(
    receipt: Pick<ReceiptSeed, "receiptId" | "itemId" | "unitId">,
    overrides: {
      readonly itemId?: string;
      readonly supplierItemId?: string | null;
      readonly unitId?: string;
    } = {},
  ) {
    return {
      goodsReceiptId: receipt.receiptId,
      itemId: overrides.itemId ?? receipt.itemId,
      supplierItemId: overrides.supplierItemId ?? null,
      receivedPackQty: "1",
      acceptedPackQty: "1",
      unitId: overrides.unitId ?? receipt.unitId,
      packToBaseFactor: "1",
      price: "10.0000",
      taxBasis: "exclusive",
      baseQtyAccepted: "1",
      landedBaseUnitCost: "10.0000",
    };
  }

  describe("recipe_allergen", () => {
    it("rejects an allergen from another organization", async () => {
      await inRollback(client.db, async (tx) => {
        const a = await seedOrg(tx, "a");
        const b = await seedOrg(tx, "b");

        const cause = await rejectionCause(
          tx.insert(recipeAllergen).values({
            recipeVersionId: a.versionId,
            allergenId: b.allergenId,
            source: "derived",
          }),
        );
        expect(cause.message).toMatch(/recipe_allergen\.allergen_id .* belongs to organization/);
      });
    });

    it("accepts an allergen from the same organization", async () => {
      await inRollback(client.db, async (tx) => {
        const a = await seedOrg(tx, "a");

        const rows = await tx
          .insert(recipeAllergen)
          .values({
            recipeVersionId: a.versionId,
            allergenId: a.allergenId,
            source: "derived",
          })
          .returning({ allergenId: recipeAllergen.allergenId });
        expect(rows[0]!.allergenId).toBe(a.allergenId);
      });
    });

    it("rejects an UPDATE that repoints the declaration at a foreign recipe version", async () => {
      await inRollback(client.db, async (tx) => {
        const a = await seedOrg(tx, "a");
        const b = await seedOrg(tx, "b");

        const inserted = await tx
          .insert(recipeAllergen)
          .values({
            recipeVersionId: a.versionId,
            allergenId: a.allergenId,
            source: "derived",
          })
          .returning({
            recipeVersionId: recipeAllergen.recipeVersionId,
            allergenId: recipeAllergen.allergenId,
          });

        const cause = await rejectionCause(
          tx
            .update(recipeAllergen)
            .set({ recipeVersionId: b.versionId })
            .where(
              and(
                eq(recipeAllergen.recipeVersionId, inserted[0]!.recipeVersionId),
                eq(recipeAllergen.allergenId, inserted[0]!.allergenId),
              ),
            ),
        );
        expect(cause.message).toMatch(/recipe_allergen\.allergen_id .* belongs to organization/);
      });
    });
  });

  describe("recipe_line", () => {
    it("rejects an item from another organization on INSERT", async () => {
      await inRollback(client.db, async (tx) => {
        const a = await seedOrg(tx, "a");
        const b = await seedOrg(tx, "b");

        const cause = await rejectionCause(
          tx.insert(recipeLine).values({
            recipeVersionId: a.versionId,
            componentKind: "ingredient",
            itemId: b.itemId,
            quantity: "1",
            unitId: a.unitId,
          }),
        );
        expect(cause.message).toMatch(/recipe_line\.item_id .* belongs to organization/);
      });
    });

    it("accepts an item from the same organization", async () => {
      await inRollback(client.db, async (tx) => {
        const a = await seedOrg(tx, "a");

        const rows = await tx
          .insert(recipeLine)
          .values({
            recipeVersionId: a.versionId,
            componentKind: "ingredient",
            itemId: a.itemId,
            quantity: "1",
            unitId: a.unitId,
          })
          .returning({ itemId: recipeLine.itemId });
        expect(rows[0]!.itemId).toBe(a.itemId);
      });
    });

    it("rejects a sub-recipe from another organization", async () => {
      await inRollback(client.db, async (tx) => {
        const a = await seedOrg(tx, "a");
        const b = await seedOrg(tx, "b");

        const cause = await rejectionCause(
          tx.insert(recipeLine).values({
            recipeVersionId: a.versionId,
            componentKind: "sub_recipe",
            subRecipeId: b.recipeId,
            quantity: "1",
            unitId: a.unitId,
          }),
        );
        expect(cause.message).toMatch(/recipe_line\.sub_recipe_id .* belongs to organization/);
      });
    });

    it("rejects an UPDATE that repoints the line at a foreign item", async () => {
      await inRollback(client.db, async (tx) => {
        const a = await seedOrg(tx, "a");
        const b = await seedOrg(tx, "b");

        const inserted = await tx
          .insert(recipeLine)
          .values({
            recipeVersionId: a.versionId,
            componentKind: "ingredient",
            itemId: a.itemId,
            quantity: "1",
            unitId: a.unitId,
          })
          .returning({ id: recipeLine.id });

        const cause = await rejectionCause(
          tx.update(recipeLine).set({ itemId: b.itemId }).where(eq(recipeLine.id, inserted[0]!.id)),
        );
        expect(cause.message).toMatch(/recipe_line\.item_id .* belongs to organization/);
      });
    });

    it("rejects an UPDATE that repoints the line at a foreign recipe version", async () => {
      await inRollback(client.db, async (tx) => {
        const a = await seedOrg(tx, "a");
        const b = await seedOrg(tx, "b");

        const inserted = await tx
          .insert(recipeLine)
          .values({
            recipeVersionId: a.versionId,
            componentKind: "ingredient",
            itemId: a.itemId,
            quantity: "1",
            unitId: a.unitId,
          })
          .returning({ id: recipeLine.id });

        const cause = await rejectionCause(
          tx
            .update(recipeLine)
            .set({ recipeVersionId: b.versionId })
            .where(eq(recipeLine.id, inserted[0]!.id)),
        );
        expect(cause.message).toMatch(/recipe_line\.item_id .* belongs to organization/);
      });
    });
  });

  describe("goods_receipt_line", () => {
    it("rejects an item from another organization", async () => {
      await inRollback(client.db, async (tx) => {
        const a = await seedReceipt(tx, "a", await seedOrg(tx, "a"));
        const b = await seedOrg(tx, "b");

        const cause = await rejectionCause(
          tx.insert(goodsReceiptLine).values(receiptLine(a, { itemId: b.itemId })),
        );
        expect(cause.message).toMatch(/goods_receipt_line\.item_id .* belongs to organization/);
      });
    });

    it("accepts a line whose supplier item, supplier and item all match", async () => {
      await inRollback(client.db, async (tx) => {
        const a = await seedReceipt(tx, "a", await seedOrg(tx, "a"));

        const rows = await tx
          .insert(goodsReceiptLine)
          .values(receiptLine(a, { supplierItemId: a.supplierItemId }))
          .returning({ supplierItemId: goodsReceiptLine.supplierItemId });
        expect(rows[0]!.supplierItemId).toBe(a.supplierItemId);
      });
    });

    it("rejects a supplier item from another organization", async () => {
      await inRollback(client.db, async (tx) => {
        const a = await seedReceipt(tx, "a", await seedOrg(tx, "a"));
        const b = await seedReceipt(tx, "b", await seedOrg(tx, "b"));

        const cause = await rejectionCause(
          tx.insert(goodsReceiptLine).values(receiptLine(a, { supplierItemId: b.supplierItemId })),
        );
        expect(cause.message).toMatch(/goods_receipt_line\.supplier_item_id .* does not match/);
      });
    });

    it("rejects a supplier item belonging to another supplier", async () => {
      await inRollback(client.db, async (tx) => {
        const a = await seedReceipt(tx, "a", await seedOrg(tx, "a"));
        const suppliers = await tx
          .insert(supplier)
          .values({
            organizationId: a.orgId,
            code: uniqueName("sup"),
            name: "Other Supplier",
            currency: "NOK",
          })
          .returning({ id: supplier.id });
        const supplierItems = await tx
          .insert(supplierItem)
          .values({
            organizationId: a.orgId,
            supplierId: suppliers[0]!.id,
            itemId: a.itemId,
            supplierSku: uniqueName("ssku"),
            packUnitId: a.unitId,
            packToBaseUnitFactor: "1",
          })
          .returning({ id: supplierItem.id });

        const cause = await rejectionCause(
          tx
            .insert(goodsReceiptLine)
            .values(receiptLine(a, { supplierItemId: supplierItems[0]!.id })),
        );
        expect(cause.message).toMatch(/goods_receipt_line\.supplier_item_id .* does not match/);
      });
    });

    it("rejects a supplier item that packs a different item", async () => {
      await inRollback(client.db, async (tx) => {
        const a = await seedReceipt(tx, "a", await seedOrg(tx, "a"));
        const otherItem = await createTestItem(tx, a.orgId, a.unitId);
        const supplierItems = await tx
          .insert(supplierItem)
          .values({
            organizationId: a.orgId,
            supplierId: a.supplierId,
            itemId: otherItem.id,
            supplierSku: uniqueName("ssku"),
            packUnitId: a.unitId,
            packToBaseUnitFactor: "1",
          })
          .returning({ id: supplierItem.id });

        const cause = await rejectionCause(
          tx
            .insert(goodsReceiptLine)
            .values(receiptLine(a, { supplierItemId: supplierItems[0]!.id })),
        );
        expect(cause.message).toMatch(/goods_receipt_line\.supplier_item_id .* does not match/);
      });
    });

    it("rejects an UPDATE that repoints the line at a foreign item", async () => {
      await inRollback(client.db, async (tx) => {
        const a = await seedReceipt(tx, "a", await seedOrg(tx, "a"));
        const b = await seedOrg(tx, "b");

        const inserted = await tx
          .insert(goodsReceiptLine)
          .values(receiptLine(a))
          .returning({ id: goodsReceiptLine.id });

        const cause = await rejectionCause(
          tx
            .update(goodsReceiptLine)
            .set({ itemId: b.itemId })
            .where(eq(goodsReceiptLine.id, inserted[0]!.id)),
        );
        expect(cause.message).toMatch(/goods_receipt_line\.item_id .* belongs to organization/);
      });
    });

    it("rejects an UPDATE that repoints the line at a foreign receipt", async () => {
      await inRollback(client.db, async (tx) => {
        const a = await seedReceipt(tx, "a", await seedOrg(tx, "a"));
        const b = await seedReceipt(tx, "b", await seedOrg(tx, "b"));

        const inserted = await tx
          .insert(goodsReceiptLine)
          .values(receiptLine(a))
          .returning({ id: goodsReceiptLine.id });

        const cause = await rejectionCause(
          tx
            .update(goodsReceiptLine)
            .set({ goodsReceiptId: b.receiptId })
            .where(eq(goodsReceiptLine.id, inserted[0]!.id)),
        );
        expect(cause.message).toMatch(/goods_receipt_line\.item_id .* belongs to organization/);
      });
    });

    it("rejects an orphan supplier_item_id at the FK", async () => {
      await inRollback(client.db, async (tx) => {
        const a = await seedReceipt(tx, "a", await seedOrg(tx, "a"));

        const cause = await rejectionCause(
          tx.insert(goodsReceiptLine).values(receiptLine(a, { supplierItemId: randomUUID() })),
        );
        expect(cause.message).toMatch(/goods_receipt_line_supplier_item_id_supplier_item_id_fk/);
      });
    });

    it("accepts a store-bought line with no supplier or supplier item (DEC-047)", async () => {
      await inRollback(client.db, async (tx) => {
        const a = await seedOrg(tx, "a");
        const location = await createTestLocation(tx, a.orgId);
        const receipts = await tx
          .insert(goodsReceipt)
          .values({
            organizationId: a.orgId,
            supplierId: null,
            storeName: "Corner Shop",
            locationId: location.id,
            receivedAt: new Date("2026-03-01T00:00:00.000Z"),
          })
          .returning({ id: goodsReceipt.id });

        const rows = await tx
          .insert(goodsReceiptLine)
          .values(
            receiptLine({
              receiptId: receipts[0]!.id,
              itemId: a.itemId,
              unitId: a.unitId,
            }),
          )
          .returning({ supplierItemId: goodsReceiptLine.supplierItemId });
        expect(rows[0]!.supplierItemId).toBeNull();
      });
    });

    it("accepts a line whose unit differs from the supplier item's pack unit", async () => {
      await inRollback(client.db, async (tx) => {
        const a = await seedReceipt(tx, "a", await seedOrg(tx, "a"));
        // The guard deliberately checks only organization, supplier and item.
        // Pack-unit-matches-the-supplier-item needs the conversion graph and stays
        // an application guard (DEC-079); this pins that no DB check rejects it,
        // so a future over-eager constraint is caught here.
        const otherUnit = await createTestUnit(tx, a.orgId);

        const rows = await tx
          .insert(goodsReceiptLine)
          .values(receiptLine(a, { supplierItemId: a.supplierItemId, unitId: otherUnit.id }))
          .returning({ unitId: goodsReceiptLine.unitId });
        expect(rows[0]!.unitId).toBe(otherUnit.id);
      });
    });
  });
});
