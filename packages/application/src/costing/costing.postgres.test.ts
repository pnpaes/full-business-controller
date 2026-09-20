import {
  costCenter,
  createDb,
  location,
  type DatabaseTransaction,
  type DbClient,
  type NodeDatabase,
} from "@aquarela/persistence";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { allocateCostPool } from "./allocate-cost-pool";
import { computeLabourCost } from "./compute-labour-cost";
import { createPostgresCostingStore } from "./postgres-store";
import { registerAllocationRule } from "./register-allocation-rule";
import { registerCostPool } from "./register-cost-pool";
import { registerLaborRate } from "./register-labor-rate";
import { registerOperatingCost } from "./register-operating-cost";

const databaseUrl = process.env.DATABASE_URL;
const suffix = randomUUID().replace(/-/g, "").slice(0, 12);

const AS_OF = new Date("2026-06-01T00:00:00Z");
const FROM = "2026-01-01";

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

async function insertCostCenter(
  tx: DatabaseTransaction,
  organizationId: string,
  code: string,
): Promise<string> {
  const rows = await tx
    .insert(costCenter)
    .values({ organizationId, code, name: code, kind: "kitchen" })
    .returning();
  return rows[0]!.id;
}

async function insertLocation(
  tx: DatabaseTransaction,
  organizationId: string,
  code: string,
): Promise<string> {
  const rows = await tx.insert(location).values({ organizationId, code, name: code }).returning();
  return rows[0]!.id;
}

describe.skipIf(!databaseUrl)("costing against PostgreSQL", () => {
  let client: DbClient;
  let orgId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    const org = await client.pool.query<{ id: string }>(
      "insert into organization (legal_name) values ($1) returning id",
      [`Costing IT ${suffix}`],
    );
    orgId = org.rows[0]!.id;
  });

  afterAll(async () => {
    if (client) {
      // Every integration test rolls back, so only the org persists.
      await client.pool.query("delete from organization where id = $1", [orgId]);
      await client.close();
    }
  });

  it("registers and reads back a labour rate, cost pool, allocation rule and operating cost", async () => {
    await inRollback(client.db, async (tx) => {
      const costCenterId = await insertCostCenter(tx, orgId, `cc_${suffix}`);
      const locationId = await insertLocation(tx, orgId, `loc_${suffix}`);
      const store = createPostgresCostingStore(tx);
      const actorId = randomUUID();

      const registered = await registerLaborRate(store, {
        organizationId: orgId,
        actorId,
        costCenterId,
        roleCode: "kitchen",
        baseHourlyRate: "240",
        productiveHoursPct: "0.8500",
        effectiveFrom: FROM,
      });
      expect(registered.loadedHourlyRate).toBe("306.57");

      const rate = await store.findEffectiveLaborRate({
        organizationId: orgId,
        costCenterId,
        roleCode: "kitchen",
        asOf: AS_OF,
      });
      // The adapter narrows `numeric(19,4)` to the domain's 2 dp loaded rate.
      expect(rate).toMatchObject({
        id: registered.laborRateId,
        loadedHourlyRate: "306.57",
        productiveHoursPct: "0.8500",
      });

      const { costPoolId } = await registerCostPool(store, {
        organizationId: orgId,
        actorId,
        code: `POOL_${suffix}`,
        name: "Shared Overhead",
        effectiveFrom: FROM,
      });
      expect(await store.findCostPool(costPoolId)).toMatchObject({
        organizationId: orgId,
        code: `POOL_${suffix}`,
      });

      const { allocationRuleId } = await registerAllocationRule(store, {
        organizationId: orgId,
        actorId,
        costPoolId,
        driver: "production_hours",
        scopeType: "location",
        denominatorSource: "production_hours",
        effectiveFrom: FROM,
      });
      expect(
        (await store.listEffectiveAllocationRules({ organizationId: orgId, asOf: AS_OF })).map(
          (rule) => rule.id,
        ),
      ).toContain(allocationRuleId);

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
        vendor: "Landlord",
      });
      const costs = await store.listEffectiveOperatingCosts({
        organizationId: orgId,
        asOf: AS_OF,
        locationId,
      });
      expect(costs).toEqual([
        expect.objectContaining({
          id: operatingCostId,
          amount: "10000.0000",
          currency: "NOK",
          vendor: "Landlord",
        }),
      ]);
    });
  });

  it("computes labour and allocates a pool end to end", async () => {
    await inRollback(client.db, async (tx) => {
      const costCenterId = await insertCostCenter(tx, orgId, `cc2_${suffix}`);
      const store = createPostgresCostingStore(tx);
      const actorId = randomUUID();

      await registerLaborRate(store, {
        organizationId: orgId,
        actorId,
        costCenterId,
        roleCode: "kitchen",
        baseHourlyRate: "240",
        productiveHoursPct: "0.8500",
        effectiveFrom: FROM,
      });

      const labour = await computeLabourCost(store, {
        organizationId: orgId,
        costCenterId,
        roleCode: "kitchen",
        asOf: AS_OF,
        productiveMinutes: "30.000000",
      });
      // 306.57 / 0.85 = 360.67; 30 min at 360.67 = 180.3350.
      expect(labour).toMatchObject({
        loadedHourlyRate: "306.57",
        effectiveLoadedHourlyRate: "360.67",
        directLaborCost: "180.3350",
        imputedOwnerLabor: "0.0000",
        cashView: "180.3350",
        economicView: "180.3350",
      });

      const { costPoolId } = await registerCostPool(store, {
        organizationId: orgId,
        actorId,
        code: `ALLOC_${suffix}`,
        name: "Allocated",
        effectiveFrom: FROM,
      });
      await registerAllocationRule(store, {
        organizationId: orgId,
        actorId,
        costPoolId,
        driver: "production_hours",
        scopeType: "location",
        denominatorSource: "production_hours",
        effectiveFrom: FROM,
      });

      const allocation = await allocateCostPool(store, {
        organizationId: orgId,
        costPoolId,
        asOf: AS_OF,
        periodCostPoolAmount: "1000",
        entityDriverVolume: "50",
        totalDriverVolume: "100",
        eligibleDriverVolume: "25",
      });
      expect(allocation).toEqual({
        driver: "production_hours",
        denominatorSource: "production_hours",
        entityDriverShare: "0.500000",
        allocatedPoolAmount: "500.0000",
        allocatedUnitOverhead: "20.0000",
        fallbackUsed: "stop",
      });
    });
  });
});
