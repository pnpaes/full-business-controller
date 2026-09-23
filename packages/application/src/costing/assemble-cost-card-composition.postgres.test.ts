import {
  costCenter,
  createDb,
  createPriceVersion,
  item,
  location,
  priceScenario,
  product,
  productRecipeAssignment,
  productVariant,
  salesLine,
  salesTransaction,
  unit,
  type DatabaseTransaction,
  type DbClient,
  type NodeDatabase,
} from "@aquarela/persistence";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { registerRecipe } from "../recipes/register-recipe";
import { registerRecipeVersion } from "../recipes/register-recipe-version";
import { calculateCostCard } from "./cost-card";
import { createPostgresCostCardStore } from "./cost-card-postgres-store";
import { createPostgresCostCardCompositionStore } from "./cost-card-composition-postgres-store";
import { assembleCostCardComposition } from "./assemble-cost-card-composition";
import { createPostgresCostingStore } from "./postgres-store";
import { registerAllocationRule } from "./register-allocation-rule";
import { registerCostPool } from "./register-cost-pool";
import { registerOperatingCost } from "./register-operating-cost";

const databaseUrl = process.env.DATABASE_URL;
const suffix = randomUUID().replace(/-/g, "").slice(0, 12);

const EARLY = new Date("2025-01-01T00:00:00Z");
const AS_OF = new Date("2026-06-01T00:00:00Z");

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

describe.skipIf(!databaseUrl)("cost-card composition assembler against PostgreSQL", () => {
  let client: DbClient;
  let orgId: string;
  let locationId: string;
  let variantId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    const org = await client.pool.query<{ id: string }>(
      "insert into organization (legal_name) values ($1) returning id",
      [`Composition IT ${suffix}`],
    );
    orgId = org.rows[0]!.id;

    const locationRows = await client.db
      .insert(location)
      .values({ organizationId: orgId, code: `loc_${suffix}`, name: "Composition Location" })
      .returning();
    locationId = locationRows[0]!.id;

    const productRows = await client.db
      .insert(product)
      .values({ organizationId: orgId, code: `prod_${suffix}`, name: "Composition Product" })
      .returning();
    const variantRows = await client.db
      .insert(productVariant)
      .values({
        organizationId: orgId,
        productId: productRows[0]!.id,
        code: `var_${suffix}`,
        sku: `sku_${suffix}`,
        name: "Composition Variant",
      })
      .returning();
    variantId = variantRows[0]!.id;
  });

  afterAll(async () => {
    if (client) {
      await client.pool.query("delete from product_variant where organization_id = $1", [orgId]);
      await client.pool.query("delete from product where organization_id = $1", [orgId]);
      await client.pool.query("delete from location where organization_id = $1", [orgId]);
      await client.pool.query("delete from organization where id = $1", [orgId]);
      await client.close();
    }
  });

  async function insertItem(
    tx: DatabaseTransaction,
    code: string,
    baseUnitId: string,
    currentCost: string,
  ): Promise<string> {
    const rows = await tx
      .insert(item)
      .values({
        organizationId: orgId,
        code: `${code}_${suffix}`,
        sku: `${code}_${suffix}`,
        name: code,
        itemType: "ingredient",
        baseUnitId,
        currentCost,
      })
      .returning();
    return rows[0]!.id;
  }

  /** Seeds unit, items, an approved recipe version, the assignment and a price version. */
  async function seed(tx: DatabaseTransaction): Promise<{ recipeVersionId: string }> {
    const g = await tx
      .insert(unit)
      .values({ organizationId: orgId, code: `g_${suffix}`, dimension: "mass", isBase: true })
      .returning();
    const flour = await insertItem(tx, "flour", g[0]!.id, "0.0100");
    const carton = await insertItem(tx, "carton", g[0]!.id, "0.2000");

    const store = createPostgresCostCardCompositionStore(tx);
    const { recipeId } = await registerRecipe(store, {
      organizationId: orgId,
      actorId: randomUUID(),
      code: `DISH_${suffix}`,
      name: "Dish",
      outputItemId: null,
    });
    const version = await registerRecipeVersion(store, {
      organizationId: orgId,
      actorId: randomUUID(),
      recipeId,
      versionNo: 1,
      state: "approved",
      plannedInputQty: "1000",
      plannedOutputQty: "1000",
      approvedUsableOutput: "1000",
      effectiveFrom: EARLY,
      approvedBy: randomUUID(),
      lines: [
        { componentKind: "ingredient", itemId: flour, quantity: "500", unitId: g[0]!.id },
        { componentKind: "packaging", itemId: carton, quantity: "1", unitId: g[0]!.id },
      ],
    });

    await tx.insert(productRecipeAssignment).values({
      productVariantId: variantId,
      locationId,
      recipeVersionId: version.recipeVersionId,
      effectiveFrom: EARLY,
      effectiveTo: null,
    });

    const scenario = await tx
      .insert(priceScenario)
      .values({ organizationId: orgId, productVariantId: variantId, state: "approved" })
      .returning();
    await createPriceVersion(tx, {
      organizationId: orgId,
      productVariantId: variantId,
      locationId,
      channelId: null,
      grossPrice: "42.3900",
      netPrice: "33.9130",
      effectiveFrom: EARLY,
      effectiveTo: null,
      approvedBy: randomUUID(),
      approvedAt: EARLY,
      sourceScenarioId: scenario[0]!.id,
    });

    return { recipeVersionId: version.recipeVersionId };
  }

  it("resolves the assignment, recipe cost and price version, then writes a cost card", async () => {
    await inRollback(client.db, async (tx) => {
      const { recipeVersionId } = await seed(tx);
      const store = createPostgresCostCardCompositionStore(tx);

      const assembled = await assembleCostCardComposition(store, {
        organizationId: orgId,
        productVariantId: variantId,
        locationId,
        asOf: AS_OF,
        directLaborCost: "2.5548",
      });

      expect(assembled.recipeVersionId).toBe(recipeVersionId);
      expect(assembled.composition).toMatchObject({
        currency: "NOK",
        ingredientCost: "0.0050",
        packagingCost: "0.0002",
        unitNetSales: "33.9130",
        directLaborCost: "2.5548",
        channelVariableCost: "0.0000",
      });
      expect(assembled.components.map((component) => component.componentKind).sort()).toEqual([
        "direct_labor",
        "ingredient",
        "packaging",
      ]);

      const writeStore = createPostgresCostCardStore(tx);
      const card = await calculateCostCard(writeStore, {
        organizationId: orgId,
        actorId: randomUUID(),
        productVariantId: variantId,
        locationId,
        channelId: null,
        recipeVersionId: assembled.recipeVersionId,
        costSelectionPolicy: "latest_approved_price",
        asOf: AS_OF,
        ruleVersion: "calc-v1",
        composition: assembled.composition,
        components: assembled.components,
      });

      const stored = await writeStore.findCostCard(card.costCardId);
      expect(stored).toMatchObject({
        recipeVersionId,
        state: "draft",
        snapshotId: card.snapshotId,
      });
      expect(card.totals.unitVariableCost).toBe("2.5600");
    });
  });

  it("returns undefined for an assignment outside its effective window", async () => {
    await inRollback(client.db, async (tx) => {
      await seed(tx);
      const store = createPostgresCostCardCompositionStore(tx);

      // The assignment is effective from EARLY with no end; an instant before it
      // must not resolve, so the assembler rejects rather than defaulting.
      await expect(
        assembleCostCardComposition(store, {
          organizationId: orgId,
          productVariantId: variantId,
          locationId,
          asOf: new Date("2024-01-01T00:00:00Z"),
        }),
      ).rejects.toThrow(/no product recipe assignment is effective/);
    });
  });

  it("allocates an operating-cost pool by the period revenue (DEC-114)", async () => {
    await inRollback(client.db, async (tx) => {
      await seed(tx);
      const actorId = randomUUID();

      const costCenterRows = await tx
        .insert(costCenter)
        .values({ organizationId: orgId, code: `cc_${suffix}`, name: "Kitchen", kind: "kitchen" })
        .returning();
      const costCenterId = costCenterRows[0]!.id;

      const costing = createPostgresCostingStore(tx);
      const { costPoolId } = await registerCostPool(costing, {
        organizationId: orgId,
        actorId,
        code: `POOL_${suffix}`,
        name: "Shared Overhead",
        effectiveFrom: "2026-01-01",
      });
      await registerAllocationRule(costing, {
        organizationId: orgId,
        actorId,
        costPoolId,
        driver: "production_hours",
        scopeType: "location",
        denominatorSource: "revenue",
        effectiveFrom: "2026-01-01",
      });
      await registerOperatingCost(costing, {
        organizationId: orgId,
        actorId,
        costCenterId,
        locationId,
        costPoolId,
        amount: "500",
        recurrence: "monthly",
        behavior: "fixed",
        taxBasis: "exclusive",
        effectiveFrom: "2026-01-01",
      });

      // Two June-2026 transactions whose net sales total 1000.0000.
      for (const [occurredAt, netAmount] of [
        ["2026-06-10T12:00:00Z", "600.0000"],
        ["2026-06-20T12:00:00Z", "400.0000"],
      ] as const) {
        const txn = await tx
          .insert(salesTransaction)
          .values({
            organizationId: orgId,
            locationId,
            sourceSystem: "frontline",
            externalTransactionId: `txn_${randomUUID()}`,
            occurredAt: new Date(occurredAt),
            currency: "NOK",
          })
          .returning();
        await tx.insert(salesLine).values({
          organizationId: orgId,
          salesTransactionId: txn[0]!.id,
          quantity: "1",
          grossAmount: netAmount,
          netAmount,
        });
      }

      const store = createPostgresCostCardCompositionStore(tx);
      const assembled = await assembleCostCardComposition(store, {
        organizationId: orgId,
        productVariantId: variantId,
        locationId,
        asOf: AS_OF,
        costPoolId,
      });

      // pool 500.0000 / revenue 1000.0000 = 0.5000
      expect(assembled.composition.allocatedUnitOverhead).toBe("0.5000");
      expect(assembled.provenance.resolved.allocatedUnitOverhead).toBe(true);
      const overheadComponent = assembled.components.find(
        (component) => component.componentKind === "allocated_overhead",
      );
      expect(overheadComponent?.provenance?.sourceType).toBe("operating_cost_pool");
    });
  });
});
