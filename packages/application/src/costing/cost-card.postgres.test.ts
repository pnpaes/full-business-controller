import {
  calculationSnapshot,
  createDb,
  findCalculationSnapshot,
  location,
  product,
  productVariant,
  type DatabaseTransaction,
  type DbClient,
  type NodeDatabase,
} from "@aquarela/persistence";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { approveCostCard, calculateCostCard } from "./cost-card";
import { createPostgresCostCardStore } from "./cost-card-postgres-store";

const databaseUrl = process.env.DATABASE_URL;
const suffix = randomUUID().replace(/-/g, "").slice(0, 12);

const AS_OF = new Date("2026-06-01T00:00:00Z");

/** The `cheese_bun` golden fixture's per-portion composition (illustrative figures). */
const CHEESE_BUN = {
  currency: "NOK",
  ingredientCost: "5.8800",
  packagingCost: "0.9000",
  directLaborCost: "2.5548",
  channelVariableCost: "0.0000",
  otherVariableCost: "0.0000",
  unitNetSales: "33.9130",
  allocatedUnitOverhead: "0.0000",
} as const;

class RollbackSignal extends Error {}

/** Runs `fn` in a transaction and always rolls it back (append-only audits stay clean). */
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

/**
 * Awaits `operation` expecting it to reject, then returns the underlying error
 * (drizzle wraps driver errors, so the trigger message lives on `.cause`).
 */
async function rejectionCause(operation: Promise<unknown>): Promise<Error> {
  const caught = await operation.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(caught instanceof Error)) {
    throw new Error("expected the operation to reject with an Error");
  }
  return caught.cause instanceof Error ? caught.cause : caught;
}

describe.skipIf(!databaseUrl)("cost card against PostgreSQL", () => {
  let client: DbClient;
  let orgId: string;
  let locationId: string;
  let variantId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    const org = await client.pool.query<{ id: string }>(
      "insert into organization (legal_name) values ($1) returning id",
      [`Cost card IT ${suffix}`],
    );
    orgId = org.rows[0]!.id;

    const locationRows = await client.db
      .insert(location)
      .values({ organizationId: orgId, code: `loc_${suffix}`, name: "Cost Card Location" })
      .returning();
    locationId = locationRows[0]!.id;

    const productRows = await client.db
      .insert(product)
      .values({ organizationId: orgId, code: `prod_${suffix}`, name: "Cost Card Product" })
      .returning();
    const variantRows = await client.db
      .insert(productVariant)
      .values({
        organizationId: orgId,
        productId: productRows[0]!.id,
        code: `var_${suffix}`,
        sku: `sku_${suffix}`,
        name: "Cost Card Variant",
      })
      .returning();
    variantId = variantRows[0]!.id;
  });

  afterAll(async () => {
    if (client) {
      // Every integration test rolls back, so only the seeded master data persists.
      // Raw SQL keeps `drizzle-orm` out of this package (it is not a dependency).
      await client.pool.query("delete from product_variant where organization_id = $1", [orgId]);
      await client.pool.query("delete from product where organization_id = $1", [orgId]);
      await client.pool.query("delete from location where organization_id = $1", [orgId]);
      await client.pool.query("delete from organization where id = $1", [orgId]);
      await client.close();
    }
  });

  const scope = () => ({
    organizationId: orgId,
    actorId: randomUUID(),
    productVariantId: variantId,
    locationId,
    costSelectionPolicy: "latest_approved_price",
    asOf: AS_OF,
    ruleVersion: "calc-v1",
    composition: CHEESE_BUN,
    components: [
      { componentKind: "ingredient", amount: "5.8800", roundingBoundary: "B3" },
      { componentKind: "packaging", amount: "0.9000" },
      { componentKind: "direct_labor", amount: "2.5548" },
    ],
  });

  it("calculates a cost card, persists the snapshot and components, and sets snapshot_id", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresCostCardStore(tx);
      const result = await calculateCostCard(store, scope());

      expect(result.totals.contributionAfterDirectLabor).toBe("24.5782");

      const card = await store.findCostCard(result.costCardId);
      expect(card).toMatchObject({
        state: "draft",
        snapshotId: result.snapshotId,
        channelId: null,
        recipeVersionId: null,
      });

      const snapshot = await findCalculationSnapshot(tx, result.snapshotId);
      expect(snapshot?.costCardId).toBe(result.costCardId);
      expect(snapshot?.totals).toMatchObject({ contributionAfterDirectLabor: "24.5782" });
      expect(snapshot?.roundingMethod).toBe("HALF_UP");

      const components = await store.listSnapshotComponents(result.snapshotId);
      expect(components.map((component) => component.componentKind).sort()).toEqual([
        "direct_labor",
        "ingredient",
        "packaging",
      ]);
      expect(components.find((c) => c.componentKind === "ingredient")?.roundingBoundary).toBe("B3");
    });
  });

  it("approves a card and supersedes the prior approved card in scope", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresCostCardStore(tx);
      const approvedBy = randomUUID();

      const first = await calculateCostCard(store, scope());
      const second = await calculateCostCard(store, scope());

      await approveCostCard(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        costCardId: first.costCardId,
        approvedBy,
      });
      const approval = await approveCostCard(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        costCardId: second.costCardId,
        approvedBy,
      });

      expect(approval).toEqual({
        costCardId: second.costCardId,
        state: "approved",
        supersededCostCardIds: [first.costCardId],
      });
      expect((await store.findCostCard(first.costCardId))?.state).toBe("superseded");
      expect((await store.findCostCard(second.costCardId))?.state).toBe("approved");
    });
  });

  it("rejects an update to the immutable calculation snapshot", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresCostCardStore(tx);
      await calculateCostCard(store, scope());

      // No WHERE: the BEFORE UPDATE trigger fires on the first row regardless, and
      // only this transaction's row exists. Avoids importing `eq` from drizzle-orm.
      const cause = await rejectionCause(
        tx.update(calculationSnapshot).set({ ruleVersion: "calc-v2" }),
      );
      expect(cause.message).toMatch(/append-only/);
    });
  });
});
