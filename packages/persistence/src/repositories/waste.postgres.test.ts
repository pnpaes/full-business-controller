import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient } from "../client";
import { item, location, organization, unit, wasteEvent } from "../schema";
import {
  createTestItem,
  createTestLocation,
  createTestOrganization,
  createTestProduct,
  createTestProductVariant,
  createTestStockMovement,
  createTestStorageArea,
  createTestUnit,
  createTestWasteEvent,
  inRollback,
  rejectionCause,
  uniqueSuffix,
} from "./test-support";
import { createWasteEvent, findWasteEvent, listWasteEvents } from "./waste";

const databaseUrl = process.env.DATABASE_URL;
const suffix = uniqueSuffix();

const at = (iso: string): Date => new Date(iso);

describe.skipIf(!databaseUrl)("waste repository", () => {
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

  it("creates a waste event and finds it organization-scoped", async () => {
    await inRollback(client.db, async (tx) => {
      const area = await createTestStorageArea(tx, orgId, locationId);
      const created = await createWasteEvent(tx, {
        organizationId: orgId,
        locationId,
        storageAreaId: area.id,
        itemId,
        quantity: "2.5",
        unitId,
        stage: "storage_expiry",
        reasonCode: "expired",
        valueMethod: "moving_average",
        occurredAt: at("2026-03-01T00:00:00.000Z"),
        actorId: "00000000-0000-0000-0000-0000000000aa",
      });
      expect(created.quantity).toBe("2.500000");
      expect(created.currency).toBeNull();

      expect(
        (await findWasteEvent(tx, { organizationId: orgId, wasteEventId: created.id }))?.id,
      ).toBe(created.id);

      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherLocation = await createTestLocation(tx, otherOrgId);
      const otherArea = await createTestStorageArea(tx, otherOrgId, otherLocation.id);
      const otherUnit = await createTestUnit(tx, otherOrgId);
      const otherItem = await createTestItem(tx, otherOrgId, otherUnit.id);
      const other = await createTestWasteEvent(tx, otherOrgId, {
        locationId: otherLocation.id,
        storageAreaId: otherArea.id,
        itemId: otherItem.id,
        unitId: otherUnit.id,
      });
      expect(
        await findWasteEvent(tx, { organizationId: orgId, wasteEventId: other.id }),
      ).toBeUndefined();
    });
  });

  it("lists waste events with location, stage and occurred_at filters", async () => {
    await inRollback(client.db, async (tx) => {
      const area = await createTestStorageArea(tx, orgId, locationId);
      const refs = { locationId, storageAreaId: area.id, itemId, unitId };
      const january = await createTestWasteEvent(tx, orgId, refs, {
        stage: "preparation",
        occurredAt: at("2026-01-01T00:00:00.000Z"),
      });
      const march = await createTestWasteEvent(tx, orgId, refs, {
        stage: "display",
        occurredAt: at("2026-03-01T00:00:00.000Z"),
      });

      const all = await listWasteEvents(tx, { organizationId: orgId });
      expect(all.map((row) => row.id)).toEqual([march.id, january.id]);

      const display = await listWasteEvents(tx, { organizationId: orgId, stage: "display" });
      expect(display.map((row) => row.id)).toEqual([march.id]);

      const byLocation = await listWasteEvents(tx, { organizationId: orgId, locationId });
      expect(byLocation).toHaveLength(2);

      const windowed = await listWasteEvents(tx, {
        organizationId: orgId,
        occurredFrom: at("2026-02-01T00:00:00.000Z"),
        occurredTo: at("2026-04-01T00:00:00.000Z"),
      });
      expect(windowed.map((row) => row.id)).toEqual([march.id]);
    });
  });

  it("accepts a product-variant waste event without an item", async () => {
    await inRollback(client.db, async (tx) => {
      const area = await createTestStorageArea(tx, orgId, locationId);
      const product = await createTestProduct(tx, orgId);
      const variant = await createTestProductVariant(tx, orgId, product.id);
      const created = await createTestWasteEvent(
        tx,
        orgId,
        { locationId, storageAreaId: area.id, itemId, unitId },
        { itemId: null, productVariantId: variant.id, stage: "unsold_finished_goods" },
      );
      expect(created.itemId).toBeNull();
      expect(created.productVariantId).toBe(variant.id);
    });
  });

  it("rejects a waste event with neither an item nor a variant", async () => {
    await inRollback(client.db, async (tx) => {
      const area = await createTestStorageArea(tx, orgId, locationId);
      const cause = await rejectionCause(
        createTestWasteEvent(
          tx,
          orgId,
          { locationId, storageAreaId: area.id, itemId, unitId },
          { itemId: null },
        ),
      );
      expect(cause.message).toMatch(/waste_event_item_or_variant_check/);
    });
  });

  it("rejects a non-positive quantity and a negative value", async () => {
    await inRollback(client.db, async (tx) => {
      const area = await createTestStorageArea(tx, orgId, locationId);
      const refs = { locationId, storageAreaId: area.id, itemId, unitId };

      const zeroQuantity = await rejectionCause(
        createTestWasteEvent(tx, orgId, refs, { quantity: "0" }),
      );
      expect(zeroQuantity.message).toMatch(/waste_event_quantity_check/);
    });

    await inRollback(client.db, async (tx) => {
      const area = await createTestStorageArea(tx, orgId, locationId);
      const refs = { locationId, storageAreaId: area.id, itemId, unitId };
      const negativeValue = await rejectionCause(
        createTestWasteEvent(tx, orgId, refs, { value: "-1" }),
      );
      expect(negativeValue.message).toMatch(/waste_event_value_check/);
    });
  });

  it("validates a waste_event source and rejects an orphan source_id", async () => {
    await inRollback(client.db, async (tx) => {
      const area = await createTestStorageArea(tx, orgId, locationId);
      const event = await createTestWasteEvent(tx, orgId, {
        locationId,
        storageAreaId: area.id,
        itemId,
        unitId,
      });

      const posted = await createTestStockMovement(
        tx,
        orgId,
        { itemId, locationId, storageAreaId: area.id, unitId },
        {
          movementType: "waste",
          quantityDelta: "-1",
          sourceType: "waste_event",
          sourceId: event.id,
        },
      );
      expect(posted.sourceId).toBe(event.id);

      const cause = await rejectionCause(
        createTestStockMovement(
          tx,
          orgId,
          { itemId, locationId, storageAreaId: area.id, unitId },
          {
            movementType: "waste",
            quantityDelta: "-1",
            sourceType: "waste_event",
            sourceId: "00000000-0000-0000-0000-000000000000",
          },
        ),
      );
      expect(cause.message).toMatch(/stock_movement\.source_id/);
    });
  });

  it("exposes the waste_event table", () => {
    expect(wasteEvent).toBeDefined();
  });
});
