import {
  channel,
  costCenter,
  createDb,
  item,
  location,
  operatingCost,
  product,
  productVariant,
  unit,
  type DatabaseTransaction,
  type DbClient,
  type NodeDatabase,
} from "@aquarela/persistence";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { calculateCostCard } from "./cost-card";
import { createPostgresCostCardStore } from "./cost-card-postgres-store";
import { calculatePriceScenario } from "./price-scenario";
import { createPostgresPriceScenarioStore } from "./price-scenario-postgres-store";
import { createPostgresCostingStore } from "./postgres-store";
import {
  getCostCardDetail,
  getPriceScenarioDetail,
  listAllocationRules,
  listCostCards,
  listCostPools,
  listLaborRates,
  listOperatingCosts,
  listPriceScenarios,
} from "./read";
import { createPostgresCostingReadStore } from "./read-postgres-store";
import { registerAllocationRule } from "./register-allocation-rule";
import { registerCostPool } from "./register-cost-pool";
import { registerLaborRate } from "./register-labor-rate";
import { registerOperatingCost } from "./register-operating-cost";

const databaseUrl = process.env.DATABASE_URL;
const suffix = randomUUID().replace(/-/g, "").slice(0, 12);

const AS_OF = new Date("2026-06-01T00:00:00Z");
const FROM = "2026-01-01";

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

describe.skipIf(!databaseUrl)("costing reads against PostgreSQL", () => {
  let client: DbClient;
  let orgId: string;
  let otherOrgId: string;
  let locationId: string;
  let otherLocationId: string;
  let variantId: string;
  let channelId: string;
  let costCenterId: string;
  let itemId: string;
  let unitId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    const org = await client.pool.query<{ id: string }>(
      "insert into organization (legal_name) values ($1) returning id",
      [`Costing read IT ${suffix}`],
    );
    orgId = org.rows[0]!.id;
    const other = await client.pool.query<{ id: string }>(
      "insert into organization (legal_name) values ($1) returning id",
      [`Costing read foreign IT ${suffix}`],
    );
    otherOrgId = other.rows[0]!.id;

    const locationRows = await client.db
      .insert(location)
      .values({ organizationId: orgId, code: `loc_${suffix}`, name: "Read Location" })
      .returning();
    locationId = locationRows[0]!.id;
    const otherLocationRows = await client.db
      .insert(location)
      .values({ organizationId: orgId, code: `loc2_${suffix}`, name: "Other Location" })
      .returning();
    otherLocationId = otherLocationRows[0]!.id;

    const channelRows = await client.db
      .insert(channel)
      .values({ organizationId: orgId, code: `chan_${suffix}`, name: "Read Channel" })
      .returning();
    channelId = channelRows[0]!.id;

    const costCenterRows = await client.db
      .insert(costCenter)
      .values({
        organizationId: orgId,
        code: `cc_${suffix}`,
        name: "Read Cost Center",
        kind: "kitchen",
      })
      .returning();
    costCenterId = costCenterRows[0]!.id;

    const unitRows = await client.db
      .insert(unit)
      .values({ organizationId: orgId, code: `unit_${suffix}`, dimension: "mass", isBase: true })
      .returning();
    unitId = unitRows[0]!.id;

    const itemRows = await client.db
      .insert(item)
      .values({
        organizationId: orgId,
        code: `item_${suffix}`,
        sku: `sku_${suffix}`,
        name: "Read Item",
        itemType: "ingredient",
        baseUnitId: unitId,
      })
      .returning();
    itemId = itemRows[0]!.id;

    const productRows = await client.db
      .insert(product)
      .values({ organizationId: orgId, code: `prod_${suffix}`, name: "Read Product" })
      .returning();
    const variantRows = await client.db
      .insert(productVariant)
      .values({
        organizationId: orgId,
        productId: productRows[0]!.id,
        code: `var_${suffix}`,
        sku: `vsku_${suffix}`,
        name: "Read Variant",
      })
      .returning();
    variantId = variantRows[0]!.id;
  });

  afterAll(async () => {
    if (client) {
      // Every integration test rolls back, so only the seeded master data persists.
      await client.pool.query("delete from product_variant where organization_id = $1", [orgId]);
      await client.pool.query("delete from product where organization_id = $1", [orgId]);
      await client.pool.query("delete from item where organization_id = $1", [orgId]);
      await client.pool.query("delete from unit where organization_id = $1", [orgId]);
      await client.pool.query("delete from cost_center where organization_id = $1", [orgId]);
      await client.pool.query("delete from channel where organization_id = $1", [orgId]);
      await client.pool.query("delete from location where organization_id = $1", [orgId]);
      await client.pool.query("delete from organization where id = $1", [orgId]);
      await client.pool.query("delete from organization where id = $1", [otherOrgId]);
      await client.close();
    }
  });

  it("lists the slice-6 facts scoped to the organization", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresCostingStore(tx);
      const reads = createPostgresCostingReadStore(tx);
      const actorId = randomUUID();

      const { laborRateId } = await registerLaborRate(store, {
        organizationId: orgId,
        actorId,
        costCenterId,
        roleCode: "kitchen",
        baseHourlyRate: "240",
        productiveHoursPct: "0.8500",
        effectiveFrom: FROM,
      });
      const { costPoolId } = await registerCostPool(store, {
        organizationId: orgId,
        actorId,
        code: `POOL_${suffix}`,
        name: "Read Overhead",
        effectiveFrom: FROM,
      });
      const { allocationRuleId } = await registerAllocationRule(store, {
        organizationId: orgId,
        actorId,
        costPoolId,
        driver: "eligible_products",
        scopeType: "location",
        denominatorSource: "eligible_products",
        effectiveFrom: FROM,
      });
      const { operatingCostId } = await registerOperatingCost(store, {
        organizationId: orgId,
        actorId,
        costCenterId,
        locationId,
        amount: "10000",
        recurrence: "monthly",
        behavior: "fixed",
        taxBasis: "exclusive",
        effectiveFrom: FROM,
        vendor: "Read Landlord",
      });

      // A foreign-org cost so the read scope is exercised, not assumed.
      const foreignCenter = await tx
        .insert(costCenter)
        .values({
          organizationId: otherOrgId,
          code: `ccf_${suffix}`,
          name: "Foreign",
          kind: "kitchen",
        })
        .returning();
      await tx.insert(operatingCost).values({
        organizationId: otherOrgId,
        costCenterId: foreignCenter[0]!.id,
        amount: "1",
        currency: "NOK",
        recurrence: "monthly",
        behavior: "fixed",
        taxBasis: "exclusive",
        effectiveFrom: FROM,
      });

      expect((await listLaborRates(reads, { organizationId: orgId })).map((r) => r.id)).toEqual([
        laborRateId,
      ]);
      expect((await listCostPools(reads, { organizationId: orgId })).map((r) => r.id)).toEqual([
        costPoolId,
      ]);
      expect(
        (await listAllocationRules(reads, { organizationId: orgId })).map((r) => r.id),
      ).toEqual([allocationRuleId]);
      const costs = await listOperatingCosts(reads, { organizationId: orgId });
      expect(costs.map((r) => r.id)).toEqual([operatingCostId]);
      expect(costs[0]).toMatchObject({ amount: "10000.0000", currency: "NOK" });
    });
  });

  it("lists cost cards and assembles the detail with snapshot, components and history", async () => {
    await inRollback(client.db, async (tx) => {
      const writes = createPostgresCostCardStore(tx);
      const reads = createPostgresCostingReadStore(tx);
      const scope = {
        organizationId: orgId,
        actorId: randomUUID(),
        productVariantId: variantId,
        locationId,
        costSelectionPolicy: "latest_approved_price",
        asOf: AS_OF,
        ruleVersion: "calc-v1",
        composition: CHEESE_BUN,
        components: [
          {
            componentKind: "ingredient" as const,
            itemId,
            quantity: "0.018000",
            unitId,
            unitCost: "326.6667",
            amount: "5.8800",
          },
          { componentKind: "direct_labor" as const, amount: "2.5548" },
        ],
      };

      const first = await calculateCostCard(writes, scope);
      const second = await calculateCostCard(writes, scope);
      // A different location is a different scope: it must not appear in history.
      await calculateCostCard(writes, { ...scope, locationId: otherLocationId });

      const cards = await listCostCards(reads, { organizationId: orgId });
      expect(cards.map((c) => c.id)).toContain(first.costCardId);
      expect(cards.map((c) => c.id)).toContain(second.costCardId);

      const detail = await getCostCardDetail(reads, {
        organizationId: orgId,
        costCardId: second.costCardId,
      });
      expect(detail?.snapshot?.id).toBe(second.snapshotId);
      expect(detail?.components.map((c) => c.componentKind).sort()).toEqual([
        "direct_labor",
        "ingredient",
      ]);
      expect(detail?.history.map((entry) => entry.card.id)).toEqual([first.costCardId]);
      expect(detail?.history[0]?.totals).toMatchObject({
        contributionAfterDirectLabor: "24.5782",
      });
    });
  });

  it("lists price scenarios and reads one detail, scoping foreign ids out", async () => {
    await inRollback(client.db, async (tx) => {
      const writes = createPostgresPriceScenarioStore(tx);
      const reads = createPostgresCostingReadStore(tx);

      const created = await calculatePriceScenario(writes, {
        organizationId: orgId,
        actorId: randomUUID(),
        productVariantId: variantId,
        locationId,
        channelId,
        asOf: AS_OF,
        ruleVersion: "calc-v1",
        costSelectionPolicy: "latest_approved_price",
        grossPrice: "49",
        taxBasis: "inclusive",
        taxRate: "0.25",
        unitVariableCost: "6.78",
      });

      const scenarios = await listPriceScenarios(reads, { organizationId: orgId });
      expect(scenarios.map((s) => s.id)).toEqual([created.priceScenarioId]);

      const detail = await getPriceScenarioDetail(reads, {
        organizationId: orgId,
        priceScenarioId: created.priceScenarioId,
      });
      expect(detail?.outcome).toMatchObject({ presentedGrossPrice: "49.00" });

      expect(
        await getPriceScenarioDetail(reads, {
          organizationId: otherOrgId,
          priceScenarioId: created.priceScenarioId,
        }),
      ).toBeUndefined();
    });
  });
});
