import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient } from "../client";
import { location, organization, settlement } from "../schema";
import { createSettlement, findSettlement, listSettlements } from "./settlements";
import {
  createTestLocation,
  createTestOrganization,
  createTestSettlement,
  inRollback,
  rejectionCause,
  uniqueSuffix,
} from "./test-support";

const databaseUrl = process.env.DATABASE_URL;
const suffix = uniqueSuffix();

describe.skipIf(!databaseUrl)("settlements repository", () => {
  let client: DbClient;
  let orgId: string;
  let locationId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    orgId = await createTestOrganization(client.db, suffix);
    const loc = await createTestLocation(client.db, orgId);
    locationId = loc.id;
  });

  afterAll(async () => {
    if (client) {
      await client.db.delete(settlement).where(eq(settlement.organizationId, orgId));
      await client.db.delete(location).where(eq(location.id, locationId));
      await client.db.delete(organization).where(eq(organization.id, orgId));
      await client.close();
    }
  });

  it("creates a settlement and finds it organization-scoped", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createSettlement(tx, {
        organizationId: orgId,
        provider: "wolt",
        periodStart: "2026-03-01",
        periodEnd: "2026-03-31",
        paidAmount: "1000.0000",
        feeAmount: "150.0000",
        status: "received",
      });
      expect(created.currency).toBe("NOK");
      expect(created.sourceFileId).toBeNull();

      expect(
        (await findSettlement(tx, { organizationId: orgId, settlementId: created.id }))?.id,
      ).toBe(created.id);

      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const other = await createTestSettlement(tx, otherOrgId);
      expect(
        await findSettlement(tx, { organizationId: orgId, settlementId: other.id }),
      ).toBeUndefined();
    });
  });

  it("lists settlements newest period first with provider filter and paging", async () => {
    await inRollback(client.db, async (tx) => {
      const february = await createTestSettlement(tx, orgId, {
        provider: "wolt",
        periodStart: "2026-02-01",
        periodEnd: "2026-02-28",
      });
      const march = await createTestSettlement(tx, orgId, {
        provider: "vipps",
        periodStart: "2026-03-01",
        periodEnd: "2026-03-31",
      });

      const all = await listSettlements(tx, { organizationId: orgId });
      expect(all.map((row) => row.id)).toEqual([march.id, february.id]);

      const wolt = await listSettlements(tx, { organizationId: orgId, provider: "wolt" });
      expect(wolt.map((row) => row.id)).toEqual([february.id]);

      const paged = await listSettlements(tx, { organizationId: orgId, limit: 1, offset: 1 });
      expect(paged.map((row) => row.id)).toEqual([february.id]);
    });
  });

  it("rejects a period that ends before it starts", async () => {
    await inRollback(client.db, async (tx) => {
      const cause = await rejectionCause(
        createTestSettlement(tx, orgId, {
          periodStart: "2026-03-31",
          periodEnd: "2026-03-01",
        }),
      );
      expect(cause.message).toMatch(/settlement_period_check/);
    });
  });

  it("exposes the settlement table", () => {
    expect(settlement).toBeDefined();
  });
});
