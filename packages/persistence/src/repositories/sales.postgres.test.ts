import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient } from "../client";
import { item, location, organization, salesLine, salesTransaction, unit } from "../schema";
import {
  createSalesTransaction,
  findSalesLine,
  findSalesTransaction,
  listSalesLines,
  listSalesTransactions,
} from "./sales";
import {
  createTestItem,
  createTestLocation,
  createTestOrganization,
  createTestSalesLine,
  createTestSalesTransaction,
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

describe.skipIf(!databaseUrl)("sales repository", () => {
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

  it("creates a transaction and finds it organization-scoped", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createSalesTransaction(tx, {
        organizationId: orgId,
        locationId,
        sourceSystem: "frontline",
        externalTransactionId: "txn-1",
        occurredAt: at("2026-03-01T12:00:00.000Z"),
        grossAmount: "125.0000",
      });
      expect(created.currency).toBe("NOK");
      expect(created.importRunId).toBeNull();

      expect(
        (
          await findSalesTransaction(tx, {
            organizationId: orgId,
            salesTransactionId: created.id,
          })
        )?.id,
      ).toBe(created.id);

      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const other = await createTestSalesTransaction(tx, otherOrgId);
      expect(
        await findSalesTransaction(tx, {
          organizationId: orgId,
          salesTransactionId: other.id,
        }),
      ).toBeUndefined();
    });
  });

  it("lists transactions newest occurred first with filters and paging", async () => {
    await inRollback(client.db, async (tx) => {
      const january = await createTestSalesTransaction(tx, orgId, {
        externalTransactionId: uniqueSuffix(),
        occurredAt: at("2026-01-01T00:00:00.000Z"),
      });
      const march = await createTestSalesTransaction(tx, orgId, {
        externalTransactionId: uniqueSuffix(),
        occurredAt: at("2026-03-01T00:00:00.000Z"),
        locationId,
      });

      const all = await listSalesTransactions(tx, { organizationId: orgId });
      expect(all.map((row) => row.id)).toEqual([march.id, january.id]);

      const atLocation = await listSalesTransactions(tx, { organizationId: orgId, locationId });
      expect(atLocation.map((row) => row.id)).toEqual([march.id]);

      const paged = await listSalesTransactions(tx, {
        organizationId: orgId,
        limit: 1,
        offset: 1,
      });
      expect(paged.map((row) => row.id)).toEqual([january.id]);
    });
  });

  it("rejects a duplicate (source_system, external_transaction_id)", async () => {
    await inRollback(client.db, async (tx) => {
      const externalTransactionId = uniqueSuffix();
      await createTestSalesTransaction(tx, orgId, { externalTransactionId });
      const cause = await rejectionCause(
        createTestSalesTransaction(tx, orgId, { externalTransactionId }),
      );
      expect(cause.message).toMatch(/sales_transaction_external_key/);
    });
  });

  it("creates a sales line and finds/lists it organization-scoped", async () => {
    await inRollback(client.db, async (tx) => {
      const txn = await createTestSalesTransaction(tx, orgId);
      const first = await createTestSalesLine(tx, orgId, txn.id, {
        externalLineId: "L1",
        sku: "SKU-1",
        quantity: "2",
        unitPrice: "50.0000",
      });
      const second = await createTestSalesLine(tx, orgId, txn.id, {
        externalLineId: "L2",
        quantity: "1",
      });

      expect(first.optionKind).toBe("standalone");
      expect(first.mappingState).toBe("unmapped");

      expect((await findSalesLine(tx, { organizationId: orgId, salesLineId: first.id }))?.id).toBe(
        first.id,
      );

      const lines = await listSalesLines(tx, {
        organizationId: orgId,
        salesTransactionId: txn.id,
      });
      expect(lines.map((row) => row.id)).toEqual([first.id, second.id]);

      const paged = await listSalesLines(tx, {
        organizationId: orgId,
        salesTransactionId: txn.id,
        limit: 1,
      });
      expect(paged.map((row) => row.id)).toEqual([first.id]);

      // A line of another organization is invisible through the org-scoped read.
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherTxn = await createTestSalesTransaction(tx, otherOrgId);
      const otherLine = await createTestSalesLine(tx, otherOrgId, otherTxn.id);
      expect(
        await findSalesLine(tx, { organizationId: orgId, salesLineId: otherLine.id }),
      ).toBeUndefined();
    });
  });

  it("rejects an attached option without a parent line", async () => {
    await inRollback(client.db, async (tx) => {
      const txn = await createTestSalesTransaction(tx, orgId);
      const cause = await rejectionCause(
        createTestSalesLine(tx, orgId, txn.id, { optionKind: "attached" }),
      );
      expect(cause.message).toMatch(/sales_line_option_parent_check/);
    });
  });

  it("accepts an attached option with a parent line", async () => {
    await inRollback(client.db, async (tx) => {
      const txn = await createTestSalesTransaction(tx, orgId);
      const parent = await createTestSalesLine(tx, orgId, txn.id);
      const attached = await createTestSalesLine(tx, orgId, txn.id, {
        optionKind: "attached",
        parentLineId: parent.id,
      });
      expect(attached.parentLineId).toBe(parent.id);
    });
  });

  it("rejects an option_kind outside the vocabulary", async () => {
    await inRollback(client.db, async (tx) => {
      const txn = await createTestSalesTransaction(tx, orgId);
      const cause = await rejectionCause(
        createTestSalesLine(tx, orgId, txn.id, { optionKind: "bogus" as never }),
      );
      expect(cause.message).toMatch(/sales_line_option_kind_check/);
    });
  });

  it("rejects a bad mapping_state", async () => {
    await inRollback(client.db, async (tx) => {
      const txn = await createTestSalesTransaction(tx, orgId);
      const cause = await rejectionCause(
        createTestSalesLine(tx, orgId, txn.id, { mappingState: "bogus" as never }),
      );
      expect(cause.message).toMatch(/sales_line_mapping_state_check/);
    });
  });

  it("rejects a negative applied_tax_rate", async () => {
    await inRollback(client.db, async (tx) => {
      const txn = await createTestSalesTransaction(tx, orgId);
      const cause = await rejectionCause(
        createTestSalesLine(tx, orgId, txn.id, { appliedTaxRate: "-0.1" }),
      );
      expect(cause.message).toMatch(/sales_line_applied_tax_rate_check/);
    });
  });

  it("rejects a duplicate (sales_transaction_id, external_line_id)", async () => {
    await inRollback(client.db, async (tx) => {
      const txn = await createTestSalesTransaction(tx, orgId);
      await createTestSalesLine(tx, orgId, txn.id, { externalLineId: "same" });
      const cause = await rejectionCause(
        createTestSalesLine(tx, orgId, txn.id, { externalLineId: "same" }),
      );
      expect(cause.message).toMatch(/sales_line_transaction_line_key/);
    });
  });

  it("validates a sales_line stock-movement source and rejects an orphan source_id", async () => {
    await inRollback(client.db, async (tx) => {
      const txn = await createTestSalesTransaction(tx, orgId);
      const line = await createTestSalesLine(tx, orgId, txn.id);
      const area = await createTestStorageArea(tx, orgId, locationId);

      const posted = await createTestStockMovement(
        tx,
        orgId,
        { itemId, locationId, storageAreaId: area.id, unitId },
        {
          movementType: "sale_consumption",
          sourceType: "sales_line",
          sourceId: line.id,
        },
      );
      expect(posted.sourceId).toBe(line.id);

      const cause = await rejectionCause(
        createTestStockMovement(
          tx,
          orgId,
          { itemId, locationId, storageAreaId: area.id, unitId },
          {
            movementType: "sale_consumption",
            sourceType: "sales_line",
            sourceId: "00000000-0000-0000-0000-000000000000",
          },
        ),
      );
      expect(cause.message).toMatch(/stock_movement\.source_id/);
    });
  });

  it("exposes the sales_transaction and sales_line tables", () => {
    expect(salesTransaction).toBeDefined();
    expect(salesLine).toBeDefined();
  });
});
