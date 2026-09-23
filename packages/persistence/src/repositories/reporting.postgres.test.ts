import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient } from "../client";
import { location, organization, salesLine, salesTransaction } from "../schema";
import { sumSalesVolume } from "./reporting";
import {
  createTestLocation,
  createTestOrganization,
  createTestSalesLine,
  createTestSalesTransaction,
  inRollback,
  uniqueSuffix,
} from "./test-support";

const databaseUrl = process.env.DATABASE_URL;
const suffix = uniqueSuffix();

const at = (iso: string): Date => new Date(iso);

const FROM = "2026-03-01T00:00:00.000Z";
const TO = "2026-04-01T00:00:00.000Z";

describe.skipIf(!databaseUrl)("reporting sales volume (DEC-114)", () => {
  let client: DbClient;
  let orgId: string;
  let locationId: string;
  let otherLocationId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    orgId = await createTestOrganization(client.db, suffix);
    locationId = (await createTestLocation(client.db, orgId)).id;
    otherLocationId = (await createTestLocation(client.db, orgId)).id;
  });

  afterAll(async () => {
    if (client) {
      await client.db.delete(salesLine).where(eq(salesLine.organizationId, orgId));
      await client.db.delete(salesTransaction).where(eq(salesTransaction.organizationId, orgId));
      await client.db.delete(location).where(eq(location.organizationId, orgId));
      await client.db.delete(organization).where(eq(organization.id, orgId));
      await client.close();
    }
  });

  it("sums revenue, distinct transactions and units per location over a half-open window", async () => {
    await inRollback(client.db, async (tx) => {
      // Location A: a standalone sale, an included add-on (excluded), a reversal
      // (negative quantity nets), an unmapped line (no variant — still counted),
      // a row exactly at `from` (included) and one exactly at `to` (excluded).
      const txA1 = await createTestSalesTransaction(tx, orgId, {
        locationId,
        occurredAt: at("2026-03-15T12:00:00.000Z"),
      });
      const standalone = await createTestSalesLine(tx, orgId, txA1.id, {
        quantity: "2",
        netAmount: "20.0000",
      });
      await createTestSalesLine(tx, orgId, txA1.id, {
        quantity: "5",
        netAmount: "0.0000",
        optionKind: "included",
        parentLineId: standalone.id,
      });
      await createTestSalesLine(tx, orgId, txA1.id, {
        quantity: "-1",
        netAmount: "-10.0000",
      });

      const txA2 = await createTestSalesTransaction(tx, orgId, {
        locationId,
        occurredAt: at("2026-03-20T12:00:00.000Z"),
      });
      await createTestSalesLine(tx, orgId, txA2.id, {
        quantity: "3",
        netAmount: "30.0000",
      });

      const txAtFrom = await createTestSalesTransaction(tx, orgId, {
        locationId,
        occurredAt: at(FROM),
      });
      await createTestSalesLine(tx, orgId, txAtFrom.id, {
        quantity: "1",
        netAmount: "5.0000",
      });

      const txAtTo = await createTestSalesTransaction(tx, orgId, {
        locationId,
        occurredAt: at(TO),
      });
      await createTestSalesLine(tx, orgId, txAtTo.id, {
        quantity: "1",
        netAmount: "5.0000",
      });

      // Location B: one transaction.
      const txB = await createTestSalesTransaction(tx, orgId, {
        locationId: otherLocationId,
        occurredAt: at("2026-03-10T12:00:00.000Z"),
      });
      await createTestSalesLine(tx, orgId, txB.id, {
        quantity: "4",
        netAmount: "40.0000",
      });

      const a = await sumSalesVolume(tx, {
        organizationId: orgId,
        from: FROM,
        to: TO,
        locationIds: [locationId],
      });
      // 20 − 10 + 30 + 5 (included line and the `to` row excluded); units
      // 2 − 1 + 3 + 1; transactions T1 + T2 + the `from` transaction.
      expect(a).toEqual({ revenue: "45.0000", transactions: "3", units: "5.000000" });

      const b = await sumSalesVolume(tx, {
        organizationId: orgId,
        from: FROM,
        to: TO,
        locationIds: [otherLocationId],
      });
      expect(b).toEqual({ revenue: "40.0000", transactions: "1", units: "4.000000" });

      const all = await sumSalesVolume(tx, { organizationId: orgId, from: FROM, to: TO });
      expect(all).toEqual({ revenue: "85.0000", transactions: "4", units: "9.000000" });
    });
  });

  it("returns zeros for an empty window", async () => {
    await inRollback(client.db, async (tx) => {
      const empty = await sumSalesVolume(tx, {
        organizationId: orgId,
        from: "2027-01-01T00:00:00.000Z",
        to: "2027-02-01T00:00:00.000Z",
      });
      expect(empty).toEqual({ revenue: "0.0000", transactions: "0", units: "0.000000" });
    });
  });

  it("scopes the window to the organization", async () => {
    await inRollback(client.db, async (tx) => {
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherLocation = await createTestLocation(tx, otherOrgId);
      const otherTx = await createTestSalesTransaction(tx, otherOrgId, {
        locationId: otherLocation.id,
        occurredAt: at("2026-03-15T12:00:00.000Z"),
      });
      await createTestSalesLine(tx, otherOrgId, otherTx.id, {
        quantity: "9",
        netAmount: "90.0000",
      });

      const own = await sumSalesVolume(tx, { organizationId: orgId, from: FROM, to: TO });
      expect(own).toEqual({ revenue: "0.0000", transactions: "0", units: "0.000000" });
    });
  });
});
