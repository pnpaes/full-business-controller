import {
  channel,
  createDb,
  findReconciliation,
  location,
  organization,
  salesLine,
  salesTransaction,
  settlement,
  type DatabaseTransaction,
  type DbClient,
  type NodeDatabase,
} from "@aquarela/persistence";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { correctSalesLine, createPostgresCorrectSalesLineStore } from "../sales";
import { createPostgresReconciliationStore } from "./postgres-store";
import { reconcileSettlement } from "./reconcile-settlement";

const databaseUrl = process.env.DATABASE_URL;
const suffix = randomUUID().replace(/-/g, "").slice(0, 12);

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

interface Fixture {
  readonly orgId: string;
  readonly settlementId: string;
  readonly targetLineId: string;
}

/**
 * Seeds an org, a location, a channel, one transaction on 2026-03-15 (inside the
 * settlement window), two billable lines and a paid settlement of `10000.0000`
 * on the 2026-03-01…2026-03-31 window. `baseAmount`/`targetAmount` are the two
 * line gross amounts; the `target` line is the reversal target.
 */
async function seedFixture(
  tx: DatabaseTransaction,
  baseAmount: string,
  targetAmount: string,
): Promise<Fixture> {
  const org = await tx
    .insert(organization)
    .values({ legalName: `Settlement reversal IT ${suffix} ${randomUUID()}` })
    .returning();
  const orgId = org[0]!.id;
  const loc = await tx
    .insert(location)
    .values({ organizationId: orgId, code: `rec_${suffix}`, name: "Reconciliation IT" })
    .returning();
  const chan = await tx
    .insert(channel)
    .values({ organizationId: orgId, code: `rec_chan_${suffix}`, name: "Wolt" })
    .returning();
  const txn = await tx
    .insert(salesTransaction)
    .values({
      organizationId: orgId,
      locationId: loc[0]!.id,
      channelId: chan[0]!.id,
      sourceSystem: "frontline",
      externalTransactionId: `txn-${randomUUID()}`,
      occurredAt: new Date("2026-03-15T12:00:00.000Z"),
      currency: "NOK",
    })
    .returning();
  await tx.insert(salesLine).values({
    organizationId: orgId,
    salesTransactionId: txn[0]!.id,
    quantity: "1",
    grossAmount: baseAmount,
  });
  const target = await tx
    .insert(salesLine)
    .values({
      organizationId: orgId,
      salesTransactionId: txn[0]!.id,
      quantity: "1",
      grossAmount: targetAmount,
    })
    .returning();
  const settle = await tx
    .insert(settlement)
    .values({
      organizationId: orgId,
      provider: "wolt",
      channelId: chan[0]!.id,
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
      paidAmount: "10000.0000",
      feeAmount: "0.0000",
      refundAmount: "0.0000",
      currency: "NOK",
      status: "paid",
    })
    .returning();
  return {
    orgId,
    settlementId: settle[0]!.id,
    targetLineId: target[0]!.id,
  };
}

describe.skipIf(!databaseUrl)("reconcileSettlement against PostgreSQL (DEC-118)", () => {
  let client: DbClient;

  beforeAll(() => {
    client = createDb(databaseUrl!);
  });

  afterAll(async () => {
    if (client) {
      await client.close();
    }
  });

  it("nets the line-level reversal into the actual and flips within_tolerance to exception", async () => {
    await inRollback(client.db, async (tx) => {
      // Pre-reversal actual = 9880 + 150 = 10030 (difference +30, within 100);
      // the reversal nets the 150-line to zero, so actual = 9880
      // (difference -120, beyond the 100 tolerance).
      const fixture = await seedFixture(tx, "9880.0000", "150.0000");

      const reversal = await correctSalesLine(createPostgresCorrectSalesLineStore(tx), {
        organizationId: fixture.orgId,
        actorId: randomUUID(),
        salesLineId: fixture.targetLineId,
        reasonCode: "customer-refund",
      });
      expect(reversal.reversalSalesLineId).toBeTruthy();

      const store = createPostgresReconciliationStore(tx);
      const result = await reconcileSettlement(store, {
        organizationId: fixture.orgId,
        actorId: randomUUID(),
        settlementId: fixture.settlementId,
        tolerance: "100.0000",
      });

      expect(result).toMatchObject({
        status: "exception",
        expected: "10000.0000",
        actual: "9880.0000",
        tolerance: "100.0000",
        difference: "-120.0000",
        created: true,
      });

      const stored = await store.findReconciliation({
        organizationId: fixture.orgId,
        reconciliationId: result.reconciliationId,
      });
      expect(stored).toMatchObject({
        status: "exception",
        expectedAmount: "10000.0000",
        actualAmount: "9880.0000",
        tolerance: "100.0000",
        difference: "-120.0000",
      });
    });
  });

  it("re-derives the amounts on a re-run and preserves resolution_note", async () => {
    await inRollback(client.db, async (tx) => {
      // line set sums to 10000 + 300 = 10300: the first run is an exception at
      // the 100 tolerance (difference +300), so the reversal gate does not block
      // the subsequent correction (`exception` is not a blocking status).
      const fixture = await seedFixture(tx, "10000.0000", "300.0000");
      const store = createPostgresReconciliationStore(tx);
      const input = {
        organizationId: fixture.orgId,
        actorId: randomUUID(),
        settlementId: fixture.settlementId,
        tolerance: "100.0000",
      } as const;

      const first = await reconcileSettlement(store, input);
      expect(first).toMatchObject({
        status: "exception",
        actual: "10300.0000",
        difference: "300.0000",
      });
      await store.updateReconciliation(
        { organizationId: fixture.orgId, reconciliationId: first.reconciliationId },
        { resolutionNote: "operator note" },
      );

      await correctSalesLine(createPostgresCorrectSalesLineStore(tx), {
        organizationId: fixture.orgId,
        actorId: randomUUID(),
        salesLineId: fixture.targetLineId,
        reasonCode: "customer-refund",
      });

      const second = await reconcileSettlement(store, input);
      expect(second).toMatchObject({
        reconciliationId: first.reconciliationId,
        created: false,
        status: "within_tolerance",
        actual: "10000.0000",
        difference: "0.0000",
      });

      const stored = await store.findReconciliation({
        organizationId: fixture.orgId,
        reconciliationId: first.reconciliationId,
      });
      expect(stored).toMatchObject({
        actualAmount: "10000.0000",
        difference: "0.0000",
        status: "within_tolerance",
        // A patch without `resolutionNote` leaves it untouched.
        resolutionNote: "operator note",
      });
    });
  });

  it("persists the patch's updated_by so the audit trail records the operator", async () => {
    await inRollback(client.db, async (tx) => {
      const fixture = await seedFixture(tx, "10000.0000", "0.0000");
      const store = createPostgresReconciliationStore(tx);
      const firstActor = randomUUID();
      const secondActor = randomUUID();

      const first = await reconcileSettlement(store, {
        organizationId: fixture.orgId,
        actorId: firstActor,
        settlementId: fixture.settlementId,
        tolerance: "100.0000",
      });
      // A created row records `created_by`, not `updated_by`.
      const created = await findReconciliation(tx, {
        organizationId: fixture.orgId,
        reconciliationId: first.reconciliationId,
      });
      expect(created?.updatedBy).toBeNull();

      // The re-run takes the update branch and carries `updatedBy` (the
      // mapping used to drop it, so `updated_by` was never persisted).
      await reconcileSettlement(store, {
        organizationId: fixture.orgId,
        actorId: secondActor,
        settlementId: fixture.settlementId,
        tolerance: "100.0000",
      });
      const updated = await findReconciliation(tx, {
        organizationId: fixture.orgId,
        reconciliationId: first.reconciliationId,
      });
      expect(updated?.updatedBy).toBe(secondActor);
    });
  });
});
