import {
  createDb,
  item,
  location,
  product,
  productRecipeAssignment,
  productVariant,
  recipe,
  recipeVersion,
  unit,
  type DatabaseTransaction,
  type DbClient,
  type NodeDatabase,
} from "@aquarela/persistence";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DomainError } from "@aquarela/domain";

import { assignRecipeToVariant } from "./assign-recipe-to-variant";
import { createPostgresProductStore } from "./postgres-store";
import { registerProduct } from "./register-product";
import { registerProductVariant } from "./register-product-variant";
import { setAddonApplicability } from "./set-addon-applicability";

const databaseUrl = process.env.DATABASE_URL;
const suffix = randomUUID().replace(/-/g, "").slice(0, 12);

class RollbackSignal extends Error {}

async function inRollback(
  db: NodeDatabase,
  fn: (tx: DatabaseTransaction) => Promise<void>,
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await fn(tx);
      throw new RollbackSignal();
    });
  } catch (error) {
    if (!(error instanceof RollbackSignal)) {
      throw error;
    }
  }
}

/** The driver SQLSTATE, unwrapping drizzle's `DrizzleQueryError` wrapper. */
function pgCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const direct = (error as { code?: string }).code;
  if (direct !== undefined) {
    return direct;
  }
  const cause = (error as { cause?: unknown }).cause;
  return typeof cause === "object" && cause !== null
    ? (cause as { code?: string }).code
    : undefined;
}

describe.skipIf(!databaseUrl)("product commands against PostgreSQL", () => {
  let client: DbClient;
  let orgId: string;
  let otherOrgId: string;
  let locationId: string;
  let otherLocationId: string;
  let itemId: string;
  let approvedVersionId: string;
  let draftVersionId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    const org = await client.pool.query<{ id: string }>(
      "insert into organization (legal_name) values ($1) returning id",
      [`Products IT ${suffix}`],
    );
    orgId = org.rows[0]!.id;
    const other = await client.pool.query<{ id: string }>(
      "insert into organization (legal_name) values ($1) returning id",
      [`Products IT other ${suffix}`],
    );
    otherOrgId = other.rows[0]!.id;

    // Committed fixtures shared by the tests (cleanup runs in `afterAll`).
    const base = await client.db
      .insert(unit)
      .values({ organizationId: orgId, code: `u_${suffix}`, dimension: "mass", isBase: true })
      .returning();
    const created = await client.db
      .insert(item)
      .values({
        organizationId: orgId,
        code: `it_${suffix}`,
        sku: `IT_${suffix}`,
        name: "Finished good",
        itemType: "finished_good",
        baseUnitId: base[0]!.id,
      })
      .returning();
    const loc = await client.db
      .insert(location)
      .values({ organizationId: orgId, code: `loc_${suffix}`, name: "Oslo" })
      .returning();
    const otherLoc = await client.db
      .insert(location)
      .values({ organizationId: otherOrgId, code: `oloc_${suffix}`, name: "Bergen" })
      .returning();
    const r = await client.db
      .insert(recipe)
      .values({ organizationId: orgId, code: `rec_${suffix}`, name: "Recipe" })
      .returning();
    const approved = await client.db
      .insert(recipeVersion)
      .values({
        recipeId: r[0]!.id,
        versionNo: 1,
        state: "approved",
        plannedInputQty: "1",
        plannedOutputQty: "1",
        approvedUsableOutput: "1",
        yieldRate: "1",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        approvedBy: randomUUID(),
        approvedAt: new Date("2026-01-01T00:00:00.000Z"),
      })
      .returning();
    const draft = await client.db
      .insert(recipeVersion)
      .values({
        recipeId: r[0]!.id,
        versionNo: 2,
        state: "draft",
        plannedInputQty: "1",
        plannedOutputQty: "1",
        approvedUsableOutput: "1",
        yieldRate: "1",
        effectiveFrom: new Date("2026-02-01T00:00:00.000Z"),
      })
      .returning();

    locationId = loc[0]!.id;
    otherLocationId = otherLoc[0]!.id;
    itemId = created[0]!.id;
    approvedVersionId = approved[0]!.id;
    draftVersionId = draft[0]!.id;
  });

  afterAll(async () => {
    if (client) {
      await client.pool.query(
        `delete from product_recipe_assignment where product_variant_id in (
           select pv.id from product_variant pv
           join product p on p.id = pv.product_id
           where p.organization_id in ($1, $2)
         )`,
        [orgId, otherOrgId],
      );
      await client.pool.query("delete from addon_applicability where organization_id in ($1, $2)", [
        orgId,
        otherOrgId,
      ]);
      await client.pool.query("delete from product_variant where organization_id in ($1, $2)", [
        orgId,
        otherOrgId,
      ]);
      await client.pool.query("delete from product where organization_id in ($1, $2)", [
        orgId,
        otherOrgId,
      ]);
      await client.pool.query(
        "delete from recipe_version where recipe_id in (select id from recipe where organization_id in ($1, $2))",
        [orgId, otherOrgId],
      );
      await client.pool.query("delete from recipe where organization_id in ($1, $2)", [
        orgId,
        otherOrgId,
      ]);
      await client.pool.query("delete from item where organization_id in ($1, $2)", [
        orgId,
        otherOrgId,
      ]);
      await client.pool.query("delete from location where organization_id in ($1, $2)", [
        orgId,
        otherOrgId,
      ]);
      await client.pool.query("delete from unit where organization_id in ($1, $2)", [
        orgId,
        otherOrgId,
      ]);
      await client.pool.query("delete from organization where id in ($1, $2)", [orgId, otherOrgId]);
      await client.close();
    }
  });

  it("registers a product idempotently through the real port", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresProductStore(tx);
      const code = `prod_${suffix}`;
      const first = await registerProduct(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        code,
        name: "Product",
        productKind: "base",
      });
      const second = await registerProduct(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        code,
        name: "Ignored",
      });
      expect(first.created).toBe(true);
      expect(second).toEqual({ productId: first.productId, created: false });
    });
  });

  it("enforces the variant SKU unique key end to end", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresProductStore(tx);
      const product1 = await tx
        .insert(product)
        .values({ organizationId: orgId, code: `p1_${suffix}`, name: "P1" })
        .returning();
      const product2 = await tx
        .insert(product)
        .values({ organizationId: orgId, code: `p2_${suffix}`, name: "P2" })
        .returning();
      await registerProductVariant(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        productId: product1[0]!.id,
        code: "A",
        sku: `SKU_${suffix}`,
        name: "A",
      });

      // The command's own check rejects the collision (read against real SQL).
      await expect(
        registerProductVariant(store, {
          organizationId: orgId,
          actorId: randomUUID(),
          productId: product2[0]!.id,
          code: "B",
          sku: `SKU_${suffix}`,
          name: "B",
        }),
      ).rejects.toBeInstanceOf(DomainError);

      // The SQL unique key is the backstop: a raw duplicate is rejected by 23505.
      await expect(
        tx
          .insert(productVariant)
          .values({
            organizationId: orgId,
            productId: product2[0]!.id,
            code: "C",
            sku: `SKU_${suffix}`,
            name: "C",
          })
          .returning(),
      ).rejects.toSatisfy((error: unknown) => pgCode(error) === "23505");
    });
  });

  it("rejects a draft recipe version, a foreign location and an overlap, and accepts a later window", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresProductStore(tx);
      const p = await tx
        .insert(product)
        .values({ organizationId: orgId, code: `pa_${suffix}`, name: "PA" })
        .returning();
      const variant = await registerProductVariant(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        productId: p[0]!.id,
        code: "V",
        sku: `VSKU_${suffix}`,
        name: "V",
      });

      await expect(
        assignRecipeToVariant(store, {
          organizationId: orgId,
          actorId: randomUUID(),
          productVariantId: variant.productVariantId,
          locationId,
          recipeVersionId: draftVersionId,
          effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        }),
      ).rejects.toThrow(/must be approved/);

      await expect(
        assignRecipeToVariant(store, {
          organizationId: orgId,
          actorId: randomUUID(),
          productVariantId: variant.productVariantId,
          locationId: otherLocationId,
          recipeVersionId: approvedVersionId,
          effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        }),
      ).rejects.toThrow(/location not found/);

      await assignRecipeToVariant(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        productVariantId: variant.productVariantId,
        locationId,
        recipeVersionId: approvedVersionId,
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        effectiveTo: new Date("2026-02-01T00:00:00.000Z"),
      });

      // The command's overlap check reads the real assignment.
      await expect(
        assignRecipeToVariant(store, {
          organizationId: orgId,
          actorId: randomUUID(),
          productVariantId: variant.productVariantId,
          locationId,
          recipeVersionId: approvedVersionId,
          effectiveFrom: new Date("2026-01-15T00:00:00.000Z"),
          effectiveTo: new Date("2026-03-01T00:00:00.000Z"),
        }),
      ).rejects.toThrow(/already effective/);

      // A non-overlapping later window is accepted.
      const later = await assignRecipeToVariant(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        productVariantId: variant.productVariantId,
        locationId,
        recipeVersionId: approvedVersionId,
        effectiveFrom: new Date("2026-02-01T00:00:00.000Z"),
        effectiveTo: null,
      });
      expect(later.assignmentId).toBeTruthy();
    });
  });

  it("enforces the pra_no_overlap exclusion constraint as the backstop", async () => {
    // A raw duplicate window: the SQL constraint itself rejects it (23P01).
    await inRollback(client.db, async (tx) => {
      const p = await tx
        .insert(product)
        .values({ organizationId: orgId, code: `raw_${suffix}`, name: "Raw" })
        .returning();
      const variant = await tx
        .insert(productVariant)
        .values({
          organizationId: orgId,
          productId: p[0]!.id,
          code: "V",
          sku: `RAWSKU_${suffix}`,
          name: "V",
        })
        .returning();
      await tx.insert(productRecipeAssignment).values({
        productVariantId: variant[0]!.id,
        locationId,
        recipeVersionId: approvedVersionId,
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        effectiveTo: new Date("2026-02-01T00:00:00.000Z"),
      });
      await expect(
        tx
          .insert(productRecipeAssignment)
          .values({
            productVariantId: variant[0]!.id,
            locationId,
            recipeVersionId: approvedVersionId,
            effectiveFrom: new Date("2026-01-20T00:00:00.000Z"),
            effectiveTo: new Date("2026-02-20T00:00:00.000Z"),
          })
          .returning(),
      ).rejects.toSatisfy((error: unknown) => pgCode(error) === "23P01");
    });

    // The adapter translates the same violation into the command's domain failure.
    await inRollback(client.db, async (tx) => {
      const store = createPostgresProductStore(tx);
      const p = await tx
        .insert(product)
        .values({ organizationId: orgId, code: `raw2_${suffix}`, name: "Raw 2" })
        .returning();
      const variant = await tx
        .insert(productVariant)
        .values({
          organizationId: orgId,
          productId: p[0]!.id,
          code: "V",
          sku: `RAWSKU2_${suffix}`,
          name: "V",
        })
        .returning();
      await store.createRecipeAssignment({
        productVariantId: variant[0]!.id,
        locationId,
        recipeVersionId: approvedVersionId,
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        effectiveTo: new Date("2026-02-01T00:00:00.000Z"),
      });
      await expect(
        store.createRecipeAssignment({
          productVariantId: variant[0]!.id,
          locationId,
          recipeVersionId: approvedVersionId,
          effectiveFrom: new Date("2026-01-20T00:00:00.000Z"),
          effectiveTo: new Date("2026-02-20T00:00:00.000Z"),
        }),
      ).rejects.toBeInstanceOf(DomainError);
    });
  });

  it("is idempotent on the add-on pair and rejects a self-add-on", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresProductStore(tx);
      const addon = await tx
        .insert(product)
        .values({
          organizationId: orgId,
          code: `add_${suffix}`,
          name: "Add-on",
          productKind: "add_on",
        })
        .returning();
      const base = await tx
        .insert(product)
        .values({ organizationId: orgId, code: `base_${suffix}`, name: "Base" })
        .returning();

      const first = await setAddonApplicability(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        addonProductId: addon[0]!.id,
        baseProductId: base[0]!.id,
        priceEffect: "2.5",
      });
      expect(first.created).toBe(true);
      const repeat = await setAddonApplicability(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        addonProductId: addon[0]!.id,
        baseProductId: base[0]!.id,
      });
      expect(repeat).toEqual({ addonApplicabilityId: first.addonApplicabilityId, created: false });

      await expect(
        setAddonApplicability(store, {
          organizationId: orgId,
          actorId: randomUUID(),
          addonProductId: base[0]!.id,
          baseProductId: base[0]!.id,
        }),
      ).rejects.toThrow(/its own add-on/);
    });
  });

  it("scopes reads to the organization", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresProductStore(tx);
      const p = await tx
        .insert(product)
        .values({ organizationId: orgId, code: `scoped_${suffix}`, name: "Scoped" })
        .returning();
      const variant = await registerProductVariant(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        productId: p[0]!.id,
        code: "V",
        sku: `SCOPED_${suffix}`,
        name: "V",
      });

      expect(await store.findVariantBySku(otherOrgId, `SCOPED_${suffix}`)).toBeUndefined();
      expect(await store.findProductByCode(otherOrgId, `scoped_${suffix}`)).toBeUndefined();
      expect(await store.findProduct(p[0]!.id)).toMatchObject({ organizationId: orgId });
      expect(await store.findVariant(variant.productVariantId)).toMatchObject({
        organizationId: orgId,
      });
      expect(await store.findItemScope(itemId)).toMatchObject({ organizationId: orgId });
      expect(await store.listLocations(orgId)).not.toHaveLength(0);
    });
  });
});
