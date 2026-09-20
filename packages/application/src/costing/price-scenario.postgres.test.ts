import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createDb,
  findCalculationSnapshot,
  findPriceScenario,
  location,
  product,
  productVariant,
  type DatabaseTransaction,
  type DbClient,
  type NodeDatabase,
} from "@aquarela/persistence";

import { approvePriceScenario, calculatePriceScenario } from "./price-scenario";
import { createPostgresPriceScenarioStore } from "./price-scenario-postgres-store";

const databaseUrl = process.env.DATABASE_URL;
const suffix = randomUUID().replace(/-/g, "").slice(0, 12);

const AS_OF = new Date("2026-06-01T00:00:00Z");

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

/** Awaits a rejection and returns the PostgreSQL error behind drizzle's wrapper. */
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

async function insertProduct(
  tx: DatabaseTransaction,
  organizationId: string,
  code: string,
): Promise<string> {
  const rows = await tx.insert(product).values({ organizationId, code, name: code }).returning();
  return rows[0]!.id;
}

async function insertProductVariant(
  tx: DatabaseTransaction,
  organizationId: string,
  productId: string,
  code: string,
): Promise<string> {
  const rows = await tx
    .insert(productVariant)
    .values({ organizationId, productId, code, sku: `${code}_sku`, name: code })
    .returning();
  return rows[0]!.id;
}

describe.skipIf(!databaseUrl)("price scenario against PostgreSQL", () => {
  let client: DbClient;
  let orgId: string;
  let otherOrgId: string;
  let foreignLocationId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    const org = await client.pool.query<{ id: string }>(
      "insert into organization (legal_name) values ($1) returning id",
      [`Price Scenario IT ${suffix}`],
    );
    orgId = org.rows[0]!.id;

    const otherOrg = await client.pool.query<{ id: string }>(
      "insert into organization (legal_name) values ($1) returning id",
      [`Price Scenario foreign IT ${suffix}`],
    );
    otherOrgId = otherOrg.rows[0]!.id;
    const foreignLocationRows = await client.db
      .insert(location)
      .values({
        organizationId: otherOrgId,
        code: `loc_other_${suffix}`,
        name: "Foreign Location",
      })
      .returning();
    foreignLocationId = foreignLocationRows[0]!.id;
  });

  afterAll(async () => {
    if (client) {
      // Every integration test rolls back, so only the seeded orgs persist.
      await client.pool.query("delete from location where organization_id = $1", [otherOrgId]);
      await client.pool.query("delete from organization where id = $1", [orgId]);
      await client.pool.query("delete from organization where id = $1", [otherOrgId]);
      await client.close();
    }
  });

  async function seedVariant(tx: DatabaseTransaction): Promise<string> {
    const productId = await insertProduct(tx, orgId, `prod_${suffix}`);
    return insertProductVariant(tx, orgId, productId, `var_${suffix}`);
  }

  it("calculates a draft scenario with a snapshot, then approves it", async () => {
    await inRollback(client.db, async (tx) => {
      const variantId = await seedVariant(tx);
      const store = createPostgresPriceScenarioStore(tx);
      const actorId = randomUUID();

      const result = await calculatePriceScenario(store, {
        organizationId: orgId,
        actorId,
        productVariantId: variantId,
        asOf: AS_OF,
        ruleVersion: "2026-1",
        costSelectionPolicy: "latest_approved_price",
        grossPrice: "39.00",
        targetContributionRate: "0.500000",
        taxBasis: "inclusive",
        taxRate: "0.150000",
        unitVariableCost: "9.3348",
        volumeAssumption: "100",
      });

      expect(result.outcome.netPrice).toBe("33.9130");
      expect(result.outcome.unitContribution).toBe("24.5782");
      expect(result.outcome.requiredNetPrice).toBe("18.6696");

      const scenario = await findPriceScenario(tx, result.priceScenarioId);
      // The four slice-7 pricing columns round-trip through numeric columns.
      expect(scenario?.grossPrice).toBe("39.0000");
      expect(scenario?.netPrice).toBe("33.9130");
      expect(scenario?.targetContributionPct).toBe("0.500000");
      expect(scenario?.volumeAssumption).toBe("100.000000");
      expect(scenario?.state).toBe("draft");
      expect(scenario?.outcome).toEqual(result.outcome);

      const snapshot = await findCalculationSnapshot(tx, result.snapshotId);
      expect(snapshot?.priceScenarioId).toBe(result.priceScenarioId);
      expect(snapshot?.costCardId).toBeNull();
      expect(snapshot?.totals).toEqual(result.outcome);

      const approved = await approvePriceScenario(store, {
        organizationId: orgId,
        actorId,
        priceScenarioId: result.priceScenarioId,
      });
      expect(approved.state).toBe("approved");
      expect((await findPriceScenario(tx, result.priceScenarioId))?.state).toBe("approved");
    });
  });

  it("rejects a calculation snapshot UPDATE (append-only)", async () => {
    await inRollback(client.db, async (tx) => {
      const variantId = await seedVariant(tx);
      const store = createPostgresPriceScenarioStore(tx);

      const result = await calculatePriceScenario(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        productVariantId: variantId,
        asOf: AS_OF,
        ruleVersion: "2026-1",
        costSelectionPolicy: "latest_approved_price",
        grossPrice: "39.00",
        taxBasis: "inclusive",
        taxRate: "0.150000",
        unitVariableCost: "9.3348",
      });

      // The snapshot id is a database-generated UUID (not request input), so it
      // is safe to inline; `execute` takes no bind parameters.
      const cause = await rejectionCause(
        tx.execute(
          `update calculation_snapshot set rule_version = 'tampered' where id = '${result.snapshotId}'`,
        ),
      );
      expect(cause.message).toMatch(/append-only/);
    });
  });

  it("rejects a location that belongs to another organization", async () => {
    await inRollback(client.db, async (tx) => {
      const variantId = await seedVariant(tx);
      const store = createPostgresPriceScenarioStore(tx);

      await expect(
        calculatePriceScenario(store, {
          organizationId: orgId,
          actorId: randomUUID(),
          productVariantId: variantId,
          locationId: foreignLocationId,
          asOf: AS_OF,
          ruleVersion: "2026-1",
          costSelectionPolicy: "latest_approved_price",
          grossPrice: "39.00",
          taxBasis: "inclusive",
          taxRate: "0.150000",
          unitVariableCost: "9.3348",
        }),
      ).rejects.toThrow(/location belongs to another organization/);
    });
  });
});
