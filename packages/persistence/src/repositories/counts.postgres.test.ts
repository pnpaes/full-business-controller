import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient } from "../client";
import { item, location, organization, stockCount, stockCountLine, unit } from "../schema";
import {
  createStockCount,
  findOrCreateStockCountLine,
  findStockCount,
  findStockCountLine,
  listStockCountLines,
  listStockCounts,
} from "./counts";
import {
  createTestItem,
  createTestLocation,
  createTestOrganization,
  createTestStockCount,
  createTestStockMovement,
  createTestStorageArea,
  createTestUnit,
  inRollback,
  rejectionCause,
  uniqueSuffix,
} from "./test-support";

const databaseUrl = process.env.DATABASE_URL;
const suffix = uniqueSuffix();

const at = (iso: string): Date => new Date(iso);

describe.skipIf(!databaseUrl)("counts repository", () => {
  let client: DbClient;
  let orgId: string;
  let locationId: string;
  let unitId: string;
  let itemId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    orgId = await createTestOrganization(client.db, suffix);
    const loc = await createTestLocation(client.db, orgId);
    locationId = loc.id;
    const baseUnit = await createTestUnit(client.db, orgId);
    unitId = baseUnit.id;
    const testItem = await createTestItem(client.db, orgId, baseUnit.id);
    itemId = testItem.id;
  });

  afterAll(async () => {
    if (client) {
      await client.db.delete(item).where(eq(item.id, itemId));
      await client.db.delete(unit).where(eq(unit.id, unitId));
      await client.db.delete(location).where(eq(location.id, locationId));
      await client.db.delete(organization).where(eq(organization.id, orgId));
      await client.close();
    }
  });

  it("creates a count and finds it organization-scoped", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createStockCount(tx, {
        organizationId: orgId,
        locationId,
        cutoff: at("2026-03-01T00:00:00.000Z"),
      });
      expect(created.status).toBe("draft");
      expect(created.blind).toBe(false);
      expect(created.scope).toEqual({});

      expect(
        (await findStockCount(tx, { organizationId: orgId, stockCountId: created.id }))?.id,
      ).toBe(created.id);

      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherLocation = await createTestLocation(tx, otherOrgId);
      const other = await createTestStockCount(tx, otherOrgId, otherLocation.id);
      expect(
        await findStockCount(tx, { organizationId: orgId, stockCountId: other.id }),
      ).toBeUndefined();
    });
  });

  it("lists counts newest cutoff first with location and status filters", async () => {
    await inRollback(client.db, async (tx) => {
      const january = await createTestStockCount(tx, orgId, locationId, {
        cutoff: at("2026-01-01T00:00:00.000Z"),
      });
      const march = await createTestStockCount(tx, orgId, locationId, {
        cutoff: at("2026-03-01T00:00:00.000Z"),
        status: "counting",
      });

      const all = await listStockCounts(tx, { organizationId: orgId });
      expect(all.map((row) => row.id)).toEqual([march.id, january.id]);

      const counting = await listStockCounts(tx, { organizationId: orgId, status: "counting" });
      expect(counting.map((row) => row.id)).toEqual([march.id]);

      const otherLocation = await createTestLocation(tx, orgId);
      const elsewhere = await createTestStockCount(tx, orgId, otherLocation.id, {
        cutoff: at("2026-04-01T00:00:00.000Z"),
      });
      const atLocation = await listStockCounts(tx, { organizationId: orgId, locationId });
      expect(atLocation.map((row) => row.id)).not.toContain(elsewhere.id);
      expect(atLocation.map((row) => row.id)).toEqual([march.id, january.id]);

      const paged = await listStockCounts(tx, {
        organizationId: orgId,
        locationId,
        limit: 1,
        offset: 1,
      });
      expect(paged.map((row) => row.id)).toEqual([january.id]);
    });
  });

  it("create-or-finds a count line on its natural key, including the lot-less bucket", async () => {
    await inRollback(client.db, async (tx) => {
      const count = await createTestStockCount(tx, orgId, locationId);
      const area = await createTestStorageArea(tx, orgId, locationId);
      const input = {
        stockCountId: count.id,
        itemId,
        storageAreaId: area.id,
        expectedQty: "10",
        countedQty: "8",
        varianceQty: "-2",
      };

      const first = await findOrCreateStockCountLine(tx, input);
      expect(first.countedQty).toBe("8.000000");
      expect(first.lotId).toBeNull();

      const second = await findOrCreateStockCountLine(tx, input);
      expect(second.id).toBe(first.id);

      const rows = await tx
        .select()
        .from(stockCountLine)
        .where(eq(stockCountLine.stockCountId, count.id));
      expect(rows).toHaveLength(1);

      // The org-scoped find/lists resolve through the parent count.
      const found = await findStockCountLine(tx, {
        organizationId: orgId,
        stockCountId: count.id,
        itemId,
        storageAreaId: area.id,
        lotId: null,
      });
      expect(found?.id).toBe(first.id);
      const lines = await listStockCountLines(tx, {
        organizationId: orgId,
        stockCountId: count.id,
      });
      expect(lines.map((row) => row.id)).toEqual([first.id]);

      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherLocation = await createTestLocation(tx, otherOrgId);
      const otherCount = await createTestStockCount(tx, otherOrgId, otherLocation.id);
      expect(
        await findStockCountLine(tx, {
          organizationId: orgId,
          stockCountId: otherCount.id,
          itemId,
          storageAreaId: area.id,
          lotId: null,
        }),
      ).toBeUndefined();
    });
  });

  it("rejects an approved count without approver metadata", async () => {
    await inRollback(client.db, async (tx) => {
      const cause = await rejectionCause(
        createStockCount(tx, {
          organizationId: orgId,
          locationId,
          cutoff: at("2026-03-01T00:00:00.000Z"),
          status: "approved",
        }),
      );
      expect(cause.message).toMatch(/stock_count_approved_check/);
    });
  });

  it("accepts an approved count with approved_by and approved_at", async () => {
    await inRollback(client.db, async (tx) => {
      const approved = await createStockCount(tx, {
        organizationId: orgId,
        locationId,
        cutoff: at("2026-03-01T00:00:00.000Z"),
        status: "approved",
        approvedBy: "00000000-0000-0000-0000-0000000000aa",
        approvedAt: at("2026-03-02T00:00:00.000Z"),
      });
      expect(approved.status).toBe("approved");
    });
  });

  it("validates a stock_count source and rejects an orphan source_id", async () => {
    await inRollback(client.db, async (tx) => {
      const area = await createTestStorageArea(tx, orgId, locationId);
      const count = await createTestStockCount(tx, orgId, locationId);

      const posted = await createTestStockMovement(
        tx,
        orgId,
        { itemId, locationId, storageAreaId: area.id, unitId },
        {
          movementType: "count_adjustment",
          sourceType: "stock_count",
          sourceId: count.id,
        },
      );
      expect(posted.sourceId).toBe(count.id);

      const cause = await rejectionCause(
        createTestStockMovement(
          tx,
          orgId,
          { itemId, locationId, storageAreaId: area.id, unitId },
          {
            movementType: "count_adjustment",
            sourceType: "stock_count",
            sourceId: "00000000-0000-0000-0000-000000000000",
          },
        ),
      );
      expect(cause.message).toMatch(/stock_movement\.source_id/);
    });
  });

  it("exposes the stock_count and stock_count_line tables", () => {
    expect(stockCount).toBeDefined();
    expect(stockCountLine).toBeDefined();
  });
});
