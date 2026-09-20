import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient } from "../client";
import { costCenter, operatingCost, organization } from "../schema";
import {
  createAllocationRule,
  createCostPool,
  createLaborRate,
  createOperatingCost,
  findEffectiveLaborRate,
  listCostPoolsByCode,
  listEffectiveAllocationRules,
  listEffectiveOperatingCosts,
} from "./costing";
import {
  createTestCostCenter,
  createTestLocation,
  createTestOrganization,
  inRollback,
  rejectionCause,
  uniqueName,
  uniqueSuffix,
} from "./test-support";

const databaseUrl = process.env.DATABASE_URL;
const suffix = uniqueSuffix();

/** `date` inputs are `yyyy-mm-dd` strings, matching the repository convention. */
const d = (iso: string): string => iso;

describe.skipIf(!databaseUrl)("costing repository", () => {
  let client: DbClient;
  let orgId: string;
  let costCenterId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    orgId = await createTestOrganization(client.db, suffix);
    const cc = await createTestCostCenter(client.db, orgId);
    costCenterId = cc.id;
  });

  afterAll(async () => {
    if (client) {
      // Every integration test rolls back, so only the org, its cost centre and
      // anything they reference persist.
      await client.db.delete(costCenter).where(eq(costCenter.id, costCenterId));
      await client.db.delete(organization).where(eq(organization.id, orgId));
      await client.close();
    }
  });

  it("picks the newest effective labor rate and respects the half-open window", async () => {
    await inRollback(client.db, async (tx) => {
      const role = "kitchen";
      await createLaborRate(tx, {
        organizationId: orgId,
        costCenterId,
        roleCode: role,
        loadedHourlyRate: "300",
        effectiveFrom: d("2026-01-01"),
        effectiveTo: d("2026-06-01"),
      });
      const newer = await createLaborRate(tx, {
        organizationId: orgId,
        costCenterId,
        roleCode: role,
        loadedHourlyRate: "350",
        effectiveFrom: d("2026-06-01"),
        effectiveTo: null,
      });

      // 2026-03-01 is inside the first window only.
      const spring = await findEffectiveLaborRate(tx, {
        organizationId: orgId,
        costCenterId,
        roleCode: role,
        asOf: new Date("2026-03-01T00:00:00.000Z"),
      });
      expect(spring?.loadedHourlyRate).toBe("300.0000");

      // 2026-07-01 selects the newest open-ended row.
      const summer = await findEffectiveLaborRate(tx, {
        organizationId: orgId,
        costCenterId,
        roleCode: role,
        asOf: new Date("2026-07-01T00:00:00.000Z"),
      });
      expect(summer?.id).toBe(newer.id);
      expect(summer?.loadedHourlyRate).toBe("350.0000");

      // Half-open [): effective_to equal to as-of is excluded.
      const atBoundary = await findEffectiveLaborRate(tx, {
        organizationId: orgId,
        costCenterId,
        roleCode: role,
        asOf: new Date("2026-06-01T00:00:00.000Z"),
      });
      expect(atBoundary?.id).toBe(newer.id);

      // A role with no rate in window returns undefined.
      expect(
        await findEffectiveLaborRate(tx, {
          organizationId: orgId,
          costCenterId,
          roleCode: "finance",
          asOf: new Date("2026-07-01T00:00:00.000Z"),
        }),
      ).toBeUndefined();
    });
  });

  it("includes effective_from and excludes effective_to in the half-open window", async () => {
    await inRollback(client.db, async (tx) => {
      const rate = await createLaborRate(tx, {
        organizationId: orgId,
        costCenterId,
        roleCode: "kitchen",
        loadedHourlyRate: "300",
        effectiveFrom: d("2026-01-01"),
        effectiveTo: d("2026-06-01"),
      });

      // `asOf === effective_from` is included.
      expect(
        (
          await findEffectiveLaborRate(tx, {
            organizationId: orgId,
            costCenterId,
            roleCode: "kitchen",
            asOf: new Date("2026-01-01T00:00:00.000Z"),
          })
        )?.id,
      ).toBe(rate.id);

      // `asOf === effective_to` is excluded.
      expect(
        await findEffectiveLaborRate(tx, {
          organizationId: orgId,
          costCenterId,
          roleCode: "kitchen",
          asOf: new Date("2026-06-01T00:00:00.000Z"),
        }),
      ).toBeUndefined();
    });
  });

  it("excludes a closed labor rate window before the as-of date", async () => {
    await inRollback(client.db, async (tx) => {
      await createLaborRate(tx, {
        organizationId: orgId,
        costCenterId,
        roleCode: "front_of_house",
        loadedHourlyRate: "200",
        effectiveFrom: d("2026-01-01"),
        effectiveTo: d("2026-02-01"),
      });
      expect(
        await findEffectiveLaborRate(tx, {
          organizationId: orgId,
          costCenterId,
          roleCode: "front_of_house",
          asOf: new Date("2026-03-01T00:00:00.000Z"),
        }),
      ).toBeUndefined();
    });
  });

  it("rejects an overlapping labor rate window for the same role", async () => {
    await inRollback(client.db, async (tx) => {
      await createLaborRate(tx, {
        organizationId: orgId,
        costCenterId,
        roleCode: "admin",
        loadedHourlyRate: "250",
        effectiveFrom: d("2026-01-01"),
        effectiveTo: d("2026-06-01"),
      });

      const cause = await rejectionCause(
        createLaborRate(tx, {
          organizationId: orgId,
          costCenterId,
          roleCode: "admin",
          loadedHourlyRate: "275",
          effectiveFrom: d("2026-03-01"),
          effectiveTo: d("2026-09-01"),
        }),
      );
      expect(cause.message).toMatch(/labor_rate_no_overlap/);
    });
  });

  it("allows a different role to occupy the same window in one cost centre", async () => {
    await inRollback(client.db, async (tx) => {
      await createLaborRate(tx, {
        organizationId: orgId,
        costCenterId,
        roleCode: "admin",
        loadedHourlyRate: "250",
        effectiveFrom: d("2026-01-01"),
        effectiveTo: d("2026-06-01"),
      });
      const other = await createLaborRate(tx, {
        organizationId: orgId,
        costCenterId,
        roleCode: "analyst",
        loadedHourlyRate: "275",
        effectiveFrom: d("2026-03-01"),
        effectiveTo: d("2026-09-01"),
      });
      expect(other.roleCode).toBe("analyst");
    });
  });

  it("creates a cost pool and lists it by code", async () => {
    await inRollback(client.db, async (tx) => {
      const code = uniqueName("pool");
      const created = await createCostPool(tx, {
        organizationId: orgId,
        code,
        name: "Shared Overhead",
        effectiveFrom: d("2026-01-01"),
        effectiveTo: null,
      });
      expect((await listCostPoolsByCode(tx, orgId, code)).map((pool) => pool.id)).toContain(
        created.id,
      );
    });
  });

  it("rejects an overlapping cost pool window for the same code", async () => {
    await inRollback(client.db, async (tx) => {
      const code = uniqueName("pool");
      await createCostPool(tx, {
        organizationId: orgId,
        code,
        name: "Pool v1",
        effectiveFrom: d("2026-01-01"),
        effectiveTo: d("2026-06-01"),
      });
      const cause = await rejectionCause(
        createCostPool(tx, {
          organizationId: orgId,
          code,
          name: "Pool v2",
          effectiveFrom: d("2026-03-01"),
          effectiveTo: d("2026-09-01"),
        }),
      );
      expect(cause.message).toMatch(/cost_pool_no_overlap/);
    });
  });

  it("accepts a non-overlapping successor version and lists versions newest-first", async () => {
    await inRollback(client.db, async (tx) => {
      const code = uniqueName("pool");
      const first = await createCostPool(tx, {
        organizationId: orgId,
        code,
        name: "Pool v1",
        effectiveFrom: d("2026-01-01"),
        effectiveTo: d("2026-06-01"),
      });
      const second = await createCostPool(tx, {
        organizationId: orgId,
        code,
        name: "Pool v2",
        effectiveFrom: d("2026-06-01"),
        effectiveTo: null,
      });
      const versions = await listCostPoolsByCode(tx, orgId, code);
      expect(versions.map((version) => version.id)).toEqual([second.id, first.id]);
    });
  });

  it("accepts a same-day close/open across two versions of one code", async () => {
    await inRollback(client.db, async (tx) => {
      const code = uniqueName("pool");
      await createCostPool(tx, {
        organizationId: orgId,
        code,
        name: "Pool v1",
        effectiveFrom: d("2026-01-01"),
        effectiveTo: d("2026-06-01"),
      });
      const successor = await createCostPool(tx, {
        organizationId: orgId,
        code,
        name: "Pool v2",
        effectiveFrom: d("2026-06-01"),
        effectiveTo: null,
      });
      expect(successor.name).toBe("Pool v2");
    });
  });

  it("rejects a zero-length cost pool window", async () => {
    await inRollback(client.db, async (tx) => {
      const cause = await rejectionCause(
        createCostPool(tx, {
          organizationId: orgId,
          code: uniqueName("pool"),
          name: "Degenerate",
          effectiveFrom: d("2026-06-01"),
          effectiveTo: d("2026-06-01"),
        }),
      );
      expect(cause.message).toMatch(/cost_pool_effective_range_check/);
    });
  });

  it("lists allocation rules scoped to the org through the pool", async () => {
    await inRollback(client.db, async (tx) => {
      const poolCode = uniqueName("pool");
      const pool = await createCostPool(tx, {
        organizationId: orgId,
        code: poolCode,
        name: "Allocated",
        effectiveFrom: d("2026-01-01"),
        effectiveTo: null,
      });
      await createAllocationRule(tx, {
        costPoolId: pool.id,
        driver: "occupied_area",
        scopeType: "location",
        denominatorSource: "location_area_m2",
        fallbackBehavior: "equal_share",
        effectiveFrom: d("2026-01-01"),
        effectiveTo: null,
      });

      // A pool belonging to another organization, with its own rule.
      const otherOrgSuffix = uniqueSuffix();
      const otherOrgId = await createTestOrganization(tx, otherOrgSuffix);
      const otherPool = await createCostPool(tx, {
        organizationId: otherOrgId,
        code: uniqueName("pool"),
        name: "Other",
        effectiveFrom: d("2026-01-01"),
        effectiveTo: null,
      });
      const otherRule = await createAllocationRule(tx, {
        costPoolId: otherPool.id,
        driver: "equal_share",
        scopeType: "company_wide",
        denominatorSource: "headcount",
        fallbackBehavior: "stop",
        effectiveFrom: d("2026-01-01"),
        effectiveTo: null,
      });

      const rules = await listEffectiveAllocationRules(tx, {
        organizationId: orgId,
        asOf: new Date("2026-03-01T00:00:00.000Z"),
      });
      expect(rules.map((rule) => rule.costPoolId)).toContain(pool.id);
      expect(rules.map((rule) => rule.id)).not.toContain(otherRule.id);

      const scoped = await listEffectiveAllocationRules(tx, {
        organizationId: orgId,
        asOf: new Date("2026-03-01T00:00:00.000Z"),
        costPoolId: pool.id,
      });
      expect(scoped).toHaveLength(1);
    });
  });

  it("rejects an overlapping allocation rule for the same pool", async () => {
    await inRollback(client.db, async (tx) => {
      const pool = await createCostPool(tx, {
        organizationId: orgId,
        code: uniqueName("pool"),
        name: "Rule pool",
        effectiveFrom: d("2026-01-01"),
        effectiveTo: null,
      });
      await createAllocationRule(tx, {
        costPoolId: pool.id,
        driver: "production_hours",
        scopeType: "location",
        denominatorSource: "production_hours",
        fallbackBehavior: "stop",
        effectiveFrom: d("2026-01-01"),
        effectiveTo: d("2026-06-01"),
      });
      const cause = await rejectionCause(
        createAllocationRule(tx, {
          costPoolId: pool.id,
          driver: "equal_share",
          scopeType: "company_wide",
          denominatorSource: "headcount",
          fallbackBehavior: "stop",
          effectiveFrom: d("2026-03-01"),
          effectiveTo: d("2026-09-01"),
        }),
      );
      expect(cause.message).toMatch(/allocation_rule_no_overlap/);
    });
  });

  it("filters effective operating costs by location", async () => {
    await inRollback(client.db, async (tx) => {
      const locationA = await createTestLocation(tx, orgId);
      const locationB = await createTestLocation(tx, orgId);
      const shared = {
        organizationId: orgId,
        costCenterId,
        amount: "1000",
        recurrence: "monthly",
        behavior: "fixed",
        taxBasis: "exclusive",
        effectiveFrom: d("2026-01-01"),
        effectiveTo: null,
      };
      await createOperatingCost(tx, { ...shared, locationId: locationA.id });
      await createOperatingCost(tx, { ...shared, locationId: locationB.id });
      await createOperatingCost(tx, { ...shared, locationId: null });

      const scoped = await listEffectiveOperatingCosts(tx, {
        organizationId: orgId,
        asOf: new Date("2026-03-01T00:00:00.000Z"),
        locationId: locationA.id,
      });
      expect(scoped).toHaveLength(1);
      expect(scoped[0]?.locationId).toBe(locationA.id);

      // No location filter returns all three (null location included).
      const all = await listEffectiveOperatingCosts(tx, {
        organizationId: orgId,
        asOf: new Date("2026-03-01T00:00:00.000Z"),
      });
      expect(all).toHaveLength(3);
    });
  });

  it("allows two concurrent operating costs in one window", async () => {
    await inRollback(client.db, async (tx) => {
      const shared = {
        organizationId: orgId,
        costCenterId,
        amount: "500",
        recurrence: "monthly",
        behavior: "fixed",
        taxBasis: "inclusive",
        effectiveFrom: d("2026-01-01"),
        effectiveTo: d("2026-06-01"),
      };
      const rent = await createOperatingCost(tx, { ...shared, vendor: "Landlord" });
      const insurance = await createOperatingCost(tx, { ...shared, vendor: "Insurer" });
      expect(rent.id).not.toBe(insurance.id);

      const effective = await listEffectiveOperatingCosts(tx, {
        organizationId: orgId,
        asOf: new Date("2026-03-01T00:00:00.000Z"),
        costCenterId,
      });
      expect(effective.map((row) => row.id).sort()).toEqual([rent.id, insurance.id].sort());
    });
  });

  it("installs the 0012 cost-allocation exclusion constraints", async () => {
    const { rows } = await client.pool.query<{ conname: string }>(
      "select conname from pg_constraint where conname = any($1::text[])",
      [["cost_pool_no_overlap", "labor_rate_no_overlap", "allocation_rule_no_overlap"]],
    );
    expect(rows.map((row) => row.conname).sort()).toEqual([
      "allocation_rule_no_overlap",
      "cost_pool_no_overlap",
      "labor_rate_no_overlap",
    ]);
  });

  it("uses the expected schema objects", () => {
    // Guard against a silent rename that would leave this file testing nothing.
    expect(costCenter).toBeDefined();
    expect(operatingCost).toBeDefined();
  });
});
