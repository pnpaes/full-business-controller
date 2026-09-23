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
  sumSalesLineGrossForChannelPeriod,
} from "./sales";
import {
  createTestChannel,
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

  it("accepts the conflict line mapping state (DEC-074)", async () => {
    await inRollback(client.db, async (tx) => {
      const txn = await createTestSalesTransaction(tx, orgId);
      const line = await createTestSalesLine(tx, orgId, txn.id, { mappingState: "conflict" });
      expect(line.mappingState).toBe("conflict");
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

  it("allows many unreversed lines and rejects a second reversal of one line", async () => {
    await inRollback(client.db, async (tx) => {
      const txn = await createTestSalesTransaction(tx, orgId);
      const original = await createTestSalesLine(tx, orgId, txn.id, { externalLineId: "orig" });
      const other = await createTestSalesLine(tx, orgId, txn.id, { externalLineId: "other" });

      // Ordinary lines carry `reversal_of_id IS NULL`; the partial index does not
      // constrain them, so many may coexist.
      expect(original.reversalOfId).toBeNull();
      expect(other.reversalOfId).toBeNull();

      const reversal = await createTestSalesLine(tx, orgId, txn.id, {
        reversalOfId: original.id,
        quantity: "-1",
      });
      expect(reversal.reversalOfId).toBe(original.id);

      // A second reversal of the same line is rejected at the database by the
      // partial unique index (`DEC-073`) — the backstop for `reverseSalesLine`.
      const cause = await rejectionCause(
        createTestSalesLine(tx, orgId, txn.id, {
          reversalOfId: original.id,
          quantity: "-1",
        }),
      );
      expect(cause.message).toMatch(/sales_line_reversal_of_id_key/);
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

  describe("sumSalesLineGrossForChannelPeriod (DEC-118)", () => {
    it("sums gross lines over the inclusive UTC-day window, nets a reversal and excludes included", async () => {
      await inRollback(client.db, async (tx) => {
        const chan = await createTestChannel(tx, orgId);
        const txn = await createTestSalesTransaction(tx, orgId, {
          channelId: chan.id,
          occurredAt: at("2026-03-15T12:00:00.000Z"),
          currency: "NOK",
        });
        const original = await createTestSalesLine(tx, orgId, txn.id, { grossAmount: "100.0000" });
        // An included option is retained for consumption but is not a sale
        // (SALE-011), so it is excluded from the total; it needs a parent line.
        await createTestSalesLine(tx, orgId, txn.id, {
          grossAmount: "500.0000",
          optionKind: "included",
          parentLineId: original.id,
        });
        // A `DEC-073` reversal is a negated line in the same transaction.
        await createTestSalesLine(tx, orgId, txn.id, {
          grossAmount: "-40.0000",
          reversalOfId: original.id,
        });

        const total = await sumSalesLineGrossForChannelPeriod(tx, {
          organizationId: orgId,
          channelId: chan.id,
          periodStart: "2026-03-01",
          periodEnd: "2026-03-31",
          currency: "NOK",
        });
        // 100.0000 - 40.0000; the included 500.0000 does not contribute.
        expect(total).toBe("60.0000");
      });
    });

    it("includes both boundary UTC days and excludes the adjacent days", async () => {
      await inRollback(client.db, async (tx) => {
        const chan = await createTestChannel(tx, orgId);
        const seedAt = async (occurredAt: string, grossAmount: string): Promise<void> => {
          const txn = await createTestSalesTransaction(tx, orgId, {
            channelId: chan.id,
            occurredAt: at(occurredAt),
            currency: "NOK",
          });
          await createTestSalesLine(tx, orgId, txn.id, { grossAmount });
        };
        await seedAt("2026-03-01T00:00:00.000Z", "10.0000"); // first boundary day
        await seedAt("2026-03-31T23:59:59.000Z", "20.0000"); // last boundary day
        await seedAt("2026-02-28T23:59:59.000Z", "100.0000"); // the day before
        await seedAt("2026-04-01T00:00:00.000Z", "200.0000"); // the day after

        const total = await sumSalesLineGrossForChannelPeriod(tx, {
          organizationId: orgId,
          channelId: chan.id,
          periodStart: "2026-03-01",
          periodEnd: "2026-03-31",
          currency: "NOK",
        });
        expect(total).toBe("30.0000");
      });
    });

    it("filters by the transaction channel and currency, and is organization-scoped", async () => {
      await inRollback(client.db, async (tx) => {
        const chanA = await createTestChannel(tx, orgId);
        const chanB = await createTestChannel(tx, orgId);
        const seedAt = async (
          channelId: string,
          currency: string,
          grossAmount: string,
        ): Promise<void> => {
          const txn = await createTestSalesTransaction(tx, orgId, {
            channelId,
            occurredAt: at("2026-03-15T12:00:00.000Z"),
            currency,
          });
          await createTestSalesLine(tx, orgId, txn.id, { grossAmount });
        };
        await seedAt(chanA.id, "NOK", "100.0000");
        await seedAt(chanB.id, "NOK", "500.0000");
        await seedAt(chanA.id, "USD", "900.0000");

        const sum = (channelId: string | null, currency: string): Promise<string> =>
          sumSalesLineGrossForChannelPeriod(tx, {
            organizationId: orgId,
            channelId,
            periodStart: "2026-03-01",
            periodEnd: "2026-03-31",
            currency,
          });

        expect(await sum(chanA.id, "NOK")).toBe("100.0000");
        // `null` channel sums every channel (the settlement carries no channel).
        expect(await sum(null, "NOK")).toBe("600.0000");
        expect(await sum(chanA.id, "USD")).toBe("900.0000");
        expect(await sum("00000000-0000-0000-0000-000000000000", "NOK")).toBe("0.0000");

        // A line in another organization is invisible to the org-scoped read.
        const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
        const otherTxn = await createTestSalesTransaction(tx, otherOrgId, {
          channelId: chanA.id,
          occurredAt: at("2026-03-15T12:00:00.000Z"),
          currency: "NOK",
        });
        await createTestSalesLine(tx, otherOrgId, otherTxn.id, { grossAmount: "777.0000" });
        expect(await sum(chanA.id, "NOK")).toBe("100.0000");
      });
    });
  });
});
