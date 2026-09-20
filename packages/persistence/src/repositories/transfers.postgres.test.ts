import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient } from "../client";
import { item, location, organization, stockTransfer, unit } from "../schema";
import type { StockMovement } from "./inventory";
import {
  createStockTransfer,
  findStockTransfer,
  listStockMovementsByTransferId,
  listStockTransfers,
} from "./transfers";
import {
  createTestItem,
  createTestLocation,
  createTestOrganization,
  createTestStockMovement,
  createTestStockTransfer,
  createTestStorageArea,
  createTestUnit,
  inRollback,
  rejectionCause,
  uniqueSuffix,
} from "./test-support";

const databaseUrl = process.env.DATABASE_URL;
const suffix = uniqueSuffix();

const at = (iso: string): Date => new Date(iso);

describe.skipIf(!databaseUrl)("transfers repository", () => {
  let client: DbClient;
  let orgId: string;
  let fromLocationId: string;
  let toLocationId: string;
  let unitId: string;
  let itemId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    orgId = await createTestOrganization(client.db, suffix);
    const from = await createTestLocation(client.db, orgId);
    fromLocationId = from.id;
    const to = await createTestLocation(client.db, orgId);
    toLocationId = to.id;
    const baseUnit = await createTestUnit(client.db, orgId);
    unitId = baseUnit.id;
    const testItem = await createTestItem(client.db, orgId, baseUnit.id);
    itemId = testItem.id;
  });

  afterAll(async () => {
    if (client) {
      await client.db.delete(item).where(eq(item.id, itemId));
      await client.db.delete(unit).where(eq(unit.id, unitId));
      await client.db.delete(location).where(eq(location.id, fromLocationId));
      await client.db.delete(location).where(eq(location.id, toLocationId));
      await client.db.delete(organization).where(eq(organization.id, orgId));
      await client.close();
    }
  });

  it("creates a transfer and finds it organization-scoped", async () => {
    await inRollback(client.db, async (tx) => {
      const fromArea = await createTestStorageArea(tx, orgId, fromLocationId);
      const toArea = await createTestStorageArea(tx, orgId, toLocationId);
      const created = await createStockTransfer(tx, {
        organizationId: orgId,
        fromLocationId,
        fromStorageAreaId: fromArea.id,
        toLocationId,
        toStorageAreaId: toArea.id,
      });
      expect(created.status).toBe("draft");

      const found = await findStockTransfer(tx, {
        organizationId: orgId,
        transferId: created.id,
      });
      expect(found?.id).toBe(created.id);

      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherFrom = await createTestLocation(tx, otherOrgId);
      const otherTo = await createTestLocation(tx, otherOrgId);
      const otherFromArea = await createTestStorageArea(tx, otherOrgId, otherFrom.id);
      const otherToArea = await createTestStorageArea(tx, otherOrgId, otherTo.id);
      const other = await createTestStockTransfer(tx, otherOrgId, {
        fromLocationId: otherFrom.id,
        fromStorageAreaId: otherFromArea.id,
        toLocationId: otherTo.id,
        toStorageAreaId: otherToArea.id,
      });
      expect(
        await findStockTransfer(tx, { organizationId: orgId, transferId: other.id }),
      ).toBeUndefined();
    });
  });

  it("lists transfers with status and location filters", async () => {
    await inRollback(client.db, async (tx) => {
      const fromArea = await createTestStorageArea(tx, orgId, fromLocationId);
      const toArea = await createTestStorageArea(tx, orgId, toLocationId);
      const refs = {
        fromLocationId,
        fromStorageAreaId: fromArea.id,
        toLocationId,
        toStorageAreaId: toArea.id,
      };
      const draft = await createTestStockTransfer(tx, orgId, refs);
      const dispatched = await createTestStockTransfer(tx, orgId, refs, {
        status: "dispatched",
        dispatchedAt: at("2026-03-01T00:00:00.000Z"),
      });

      const all = await listStockTransfers(tx, { organizationId: orgId });
      expect(all.map((row) => row.id).sort()).toEqual([draft.id, dispatched.id].sort());

      const onlyDispatched = await listStockTransfers(tx, {
        organizationId: orgId,
        status: "dispatched",
      });
      expect(onlyDispatched.map((row) => row.id)).toEqual([dispatched.id]);

      const byFrom = await listStockTransfers(tx, { organizationId: orgId, fromLocationId });
      expect(byFrom).toHaveLength(2);

      const otherLocation = await createTestLocation(tx, orgId);
      const otherArea = await createTestStorageArea(tx, orgId, otherLocation.id);
      const elsewhere = await createTestStockTransfer(tx, orgId, {
        fromLocationId: otherLocation.id,
        fromStorageAreaId: otherArea.id,
        toLocationId,
        toStorageAreaId: toArea.id,
      });
      const fromHere = await listStockTransfers(tx, { organizationId: orgId, fromLocationId });
      expect(fromHere.map((row) => row.id)).not.toContain(elsewhere.id);
    });
  });

  it("pairs the dispatch and receipt movements via transfer_id", async () => {
    await inRollback(client.db, async (tx) => {
      const fromArea = await createTestStorageArea(tx, orgId, fromLocationId);
      const toArea = await createTestStorageArea(tx, orgId, toLocationId);
      const transfer = await createTestStockTransfer(
        tx,
        orgId,
        {
          fromLocationId,
          fromStorageAreaId: fromArea.id,
          toLocationId,
          toStorageAreaId: toArea.id,
        },
        { status: "dispatched", dispatchedAt: at("2026-03-01T00:00:00.000Z") },
      );

      const dispatch = await createTestStockMovement(
        tx,
        orgId,
        { itemId, locationId: fromLocationId, storageAreaId: fromArea.id, unitId },
        {
          movementType: "transfer_dispatch",
          quantityDelta: "-3",
          sourceType: "transfer",
          sourceId: transfer.id,
          transferId: transfer.id,
          occurredAt: at("2026-03-01T00:00:00.000Z"),
        },
      );
      const receipt = await createTestStockMovement(
        tx,
        orgId,
        { itemId, locationId: toLocationId, storageAreaId: toArea.id, unitId },
        {
          movementType: "transfer_receipt",
          quantityDelta: "3",
          sourceType: "transfer",
          sourceId: transfer.id,
          transferId: transfer.id,
          occurredAt: at("2026-03-02T00:00:00.000Z"),
        },
      );

      const legs = await listStockMovementsByTransferId(tx, {
        organizationId: orgId,
        transferId: transfer.id,
      });
      expect(legs.map((row: StockMovement) => row.id)).toEqual([dispatch.id, receipt.id]);

      // A movement in another transfer is not returned.
      const otherTransfer = await createTestStockTransfer(tx, orgId, {
        fromLocationId,
        fromStorageAreaId: fromArea.id,
        toLocationId,
        toStorageAreaId: toArea.id,
      });
      const otherLeg = await createTestStockMovement(
        tx,
        orgId,
        { itemId, locationId: fromLocationId, storageAreaId: fromArea.id, unitId },
        {
          movementType: "transfer_dispatch",
          quantityDelta: "-1",
          sourceType: "transfer",
          sourceId: otherTransfer.id,
          transferId: otherTransfer.id,
        },
      );
      const onlyTransfer = await listStockMovementsByTransferId(tx, {
        organizationId: orgId,
        transferId: transfer.id,
      });
      expect(onlyTransfer.map((row) => row.id)).not.toContain(otherLeg.id);
    });
  });

  it("rejects a dispatched transfer without a dispatch timestamp", async () => {
    await inRollback(client.db, async (tx) => {
      const fromArea = await createTestStorageArea(tx, orgId, fromLocationId);
      const toArea = await createTestStorageArea(tx, orgId, toLocationId);
      const cause = await rejectionCause(
        createTestStockTransfer(
          tx,
          orgId,
          {
            fromLocationId,
            fromStorageAreaId: fromArea.id,
            toLocationId,
            toStorageAreaId: toArea.id,
          },
          { status: "dispatched" },
        ),
      );
      expect(cause.message).toMatch(/stock_transfer_dispatched_check/);
    });
  });

  it("rejects a received transfer without receipt metadata", async () => {
    await inRollback(client.db, async (tx) => {
      const fromArea = await createTestStorageArea(tx, orgId, fromLocationId);
      const toArea = await createTestStorageArea(tx, orgId, toLocationId);
      const cause = await rejectionCause(
        createTestStockTransfer(
          tx,
          orgId,
          {
            fromLocationId,
            fromStorageAreaId: fromArea.id,
            toLocationId,
            toStorageAreaId: toArea.id,
          },
          {
            status: "received",
            dispatchedAt: at("2026-03-01T00:00:00.000Z"),
          },
        ),
      );
      expect(cause.message).toMatch(/stock_transfer_received_check/);
    });
  });

  it("accepts a received transfer with both timestamps", async () => {
    await inRollback(client.db, async (tx) => {
      const fromArea = await createTestStorageArea(tx, orgId, fromLocationId);
      const toArea = await createTestStorageArea(tx, orgId, toLocationId);
      const received = await createTestStockTransfer(
        tx,
        orgId,
        {
          fromLocationId,
          fromStorageAreaId: fromArea.id,
          toLocationId,
          toStorageAreaId: toArea.id,
        },
        {
          status: "received",
          dispatchedAt: at("2026-03-01T00:00:00.000Z"),
          receivedAt: at("2026-03-02T00:00:00.000Z"),
        },
      );
      expect(received.status).toBe("received");
    });
  });

  it("validates a transfer source and rejects an orphan source_id", async () => {
    await inRollback(client.db, async (tx) => {
      const fromArea = await createTestStorageArea(tx, orgId, fromLocationId);
      const toArea = await createTestStorageArea(tx, orgId, toLocationId);
      const transfer = await createTestStockTransfer(tx, orgId, {
        fromLocationId,
        fromStorageAreaId: fromArea.id,
        toLocationId,
        toStorageAreaId: toArea.id,
      });

      const posted = await createTestStockMovement(
        tx,
        orgId,
        { itemId, locationId: fromLocationId, storageAreaId: fromArea.id, unitId },
        {
          movementType: "transfer_dispatch",
          quantityDelta: "-2",
          sourceType: "transfer",
          sourceId: transfer.id,
          transferId: transfer.id,
        },
      );
      expect(posted.transferId).toBe(transfer.id);

      const cause = await rejectionCause(
        createTestStockMovement(
          tx,
          orgId,
          { itemId, locationId: fromLocationId, storageAreaId: fromArea.id, unitId },
          {
            movementType: "transfer_dispatch",
            quantityDelta: "-2",
            sourceType: "transfer",
            sourceId: "00000000-0000-0000-0000-000000000000",
            transferId: transfer.id,
          },
        ),
      );
      expect(cause.message).toMatch(/stock_movement\.source_id/);
    });
  });

  it("rejects a transfer_id that does not name a transfer", async () => {
    await inRollback(client.db, async (tx) => {
      const fromArea = await createTestStorageArea(tx, orgId, fromLocationId);
      const toArea = await createTestStorageArea(tx, orgId, toLocationId);
      // A valid source_id so the BEFORE INSERT source guard passes; the bad
      // transfer_id is then caught by the FK at constraint-check time.
      const transfer = await createTestStockTransfer(tx, orgId, {
        fromLocationId,
        fromStorageAreaId: fromArea.id,
        toLocationId,
        toStorageAreaId: toArea.id,
      });
      const cause = await rejectionCause(
        createTestStockMovement(
          tx,
          orgId,
          { itemId, locationId: fromLocationId, storageAreaId: fromArea.id, unitId },
          {
            movementType: "transfer_dispatch",
            quantityDelta: "-1",
            sourceType: "transfer",
            sourceId: transfer.id,
            transferId: "00000000-0000-0000-0000-0000000000ff",
          },
        ),
      );
      expect(cause.message).toMatch(/stock_movement_transfer_id_stock_transfer_id_fk/);
    });
  });

  it("exposes the stock_transfer table", () => {
    expect(stockTransfer).toBeDefined();
  });
});
