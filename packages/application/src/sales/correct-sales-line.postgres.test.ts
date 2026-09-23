import { DomainError } from "@aquarela/domain";
import {
  createDb,
  findSalesLineReversal,
  location,
  organization,
  periodClose,
  reconciliation,
  salesLine,
  salesTransaction,
  type DatabaseTransaction,
  type DbClient,
  type NodeDatabase,
} from "@aquarela/persistence";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { beginPeriodClose, createPostgresPeriodCloseStore, lockPeriodClose } from "../close";

import { correctSalesLine } from "./correct-sales-line";
import { createPostgresCorrectSalesLineStore } from "./postgres-store";

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
  readonly locationId: string;
  readonly transactionId: string;
  readonly lineId: string;
}

/** Seeds an org, a location, one transaction on the day and one line on it. */
async function seedFixture(tx: DatabaseTransaction, occurredAt: string): Promise<Fixture> {
  const org = await tx
    .insert(organization)
    .values({ legalName: `Reversal gate IT ${suffix} ${randomUUID()}` })
    .returning();
  const orgId = org[0]!.id;
  const loc = await tx
    .insert(location)
    .values({ organizationId: orgId, code: `gate_${suffix}`, name: "Reversal gate IT" })
    .returning();
  const locationId = loc[0]!.id;
  const transaction = await tx
    .insert(salesTransaction)
    .values({
      organizationId: orgId,
      locationId,
      sourceSystem: "frontline",
      externalTransactionId: `txn-${randomUUID()}`,
      occurredAt: new Date(occurredAt),
      currency: "NOK",
    })
    .returning();
  const line = await tx
    .insert(salesLine)
    .values({
      organizationId: orgId,
      salesTransactionId: transaction[0]!.id,
      quantity: "1",
    })
    .returning();
  return { orgId, locationId, transactionId: transaction[0]!.id, lineId: line[0]!.id };
}

async function hasReversal(
  tx: DatabaseTransaction,
  organizationId: string,
  lineId: string,
): Promise<boolean> {
  return (await findSalesLineReversal(tx, { organizationId, salesLineId: lineId })) !== undefined;
}

/** Seeds a second location (same organization) with its own transaction + line. */
async function seedLineAtAnotherLocation(
  tx: DatabaseTransaction,
  fixture: Fixture,
  occurredAt: string,
): Promise<string> {
  const loc = await tx
    .insert(location)
    .values({ organizationId: fixture.orgId, code: `gate2_${suffix}`, name: "Reversal gate IT 2" })
    .returning();
  const transaction = await tx
    .insert(salesTransaction)
    .values({
      organizationId: fixture.orgId,
      locationId: loc[0]!.id,
      sourceSystem: "frontline",
      externalTransactionId: `txn-${randomUUID()}`,
      occurredAt: new Date(occurredAt),
      currency: "NOK",
    })
    .returning();
  const line = await tx
    .insert(salesLine)
    .values({
      organizationId: fixture.orgId,
      salesTransactionId: transaction[0]!.id,
      quantity: "1",
    })
    .returning();
  return line[0]!.id;
}

describe.skipIf(!databaseUrl)("correctSalesLine reversal gate against PostgreSQL (DEC-117)", () => {
  let client: DbClient;

  beforeAll(() => {
    client = createDb(databaseUrl!);
  });

  afterAll(async () => {
    if (client) {
      await client.close();
    }
  });

  it("blocks a reversal covered by a reconciled reconciliation and posts nothing", async () => {
    await inRollback(client.db, async (tx) => {
      const fixture = await seedFixture(tx, "2026-03-15T10:00:00.000Z");
      await tx.insert(reconciliation).values({
        organizationId: fixture.orgId,
        scopeType: "sales_source",
        scopeId: randomUUID(),
        periodStart: "2026-03-01",
        periodEnd: "2026-03-31",
        expectedAmount: "100",
        actualAmount: "100",
        tolerance: "5",
        difference: "0",
        status: "within_tolerance",
      });
      const store = createPostgresCorrectSalesLineStore(tx);

      await expect(
        correctSalesLine(store, {
          organizationId: fixture.orgId,
          actorId: randomUUID(),
          salesLineId: fixture.lineId,
          reasonCode: "customer-refund",
        }),
      ).rejects.toThrow(/reconciled period/);

      expect(await hasReversal(tx, fixture.orgId, fixture.lineId)).toBe(false);
    });
  });

  it("allows a reversal when the covering reconciliation is pending", async () => {
    await inRollback(client.db, async (tx) => {
      const fixture = await seedFixture(tx, "2026-03-15T10:00:00.000Z");
      await tx.insert(reconciliation).values({
        organizationId: fixture.orgId,
        scopeType: "sales_source",
        scopeId: randomUUID(),
        periodStart: "2026-03-01",
        periodEnd: "2026-03-31",
        expectedAmount: "100",
        actualAmount: "100",
        tolerance: "5",
        difference: "0",
        status: "pending",
      });
      const store = createPostgresCorrectSalesLineStore(tx);

      const result = await correctSalesLine(store, {
        organizationId: fixture.orgId,
        actorId: randomUUID(),
        salesLineId: fixture.lineId,
        reasonCode: "customer-refund",
      });

      expect(result.reversalSalesLineId).toBeTruthy();
      expect(await hasReversal(tx, fixture.orgId, fixture.lineId)).toBe(true);
    });
  });

  it("blocks a reversal when the day is location-locked", async () => {
    await inRollback(client.db, async (tx) => {
      const fixture = await seedFixture(tx, "2026-03-15T10:00:00.000Z");
      await tx.insert(periodClose).values({
        organizationId: fixture.orgId,
        scopeType: "location",
        scopeId: fixture.locationId,
        periodStart: "2026-03-15",
        periodEnd: "2026-03-15",
        status: "locked",
        checklist: [],
        lockedBy: randomUUID(),
        lockedAt: new Date("2026-03-16T00:00:00.000Z"),
      });
      const store = createPostgresCorrectSalesLineStore(tx);

      await expect(
        correctSalesLine(store, {
          organizationId: fixture.orgId,
          actorId: randomUUID(),
          salesLineId: fixture.lineId,
          reasonCode: "customer-refund",
        }),
      ).rejects.toThrow(/locked for its location/);

      expect(await hasReversal(tx, fixture.orgId, fixture.lineId)).toBe(false);
    });
  });

  it("blocks a reversal covered by a location close created and locked through the real commands (DEC-119)", async () => {
    await inRollback(client.db, async (tx) => {
      const fixture = await seedFixture(tx, "2026-03-15T10:00:00.000Z");
      const actorId = randomUUID();

      // Drive the real two-step close against the harness transaction: begin
      // (creates a `closing` row) then lock. Nothing is hand-seeded.
      const closeStore = createPostgresPeriodCloseStore(tx);
      const opened = await beginPeriodClose(closeStore, {
        organizationId: fixture.orgId,
        actorId,
        scopeType: "location",
        scopeId: fixture.locationId,
        periodStart: "2026-03-15",
        checklist: [],
      });
      expect(opened.status).toBe("closing");
      const locked = await lockPeriodClose(closeStore, {
        organizationId: fixture.orgId,
        actorId,
        periodCloseId: opened.id,
      });
      expect(locked).toMatchObject({
        status: "locked",
        scopeType: "location",
        scopeId: fixture.locationId,
      });

      // A line at a second location on the same day is not covered by the lock.
      const otherLineId = await seedLineAtAnotherLocation(tx, fixture, "2026-03-15T12:00:00.000Z");

      const store = createPostgresCorrectSalesLineStore(tx);
      await expect(
        correctSalesLine(store, {
          organizationId: fixture.orgId,
          actorId: randomUUID(),
          salesLineId: fixture.lineId,
          reasonCode: "customer-refund",
        }),
      ).rejects.toThrow(/locked for its location/);
      expect(await hasReversal(tx, fixture.orgId, fixture.lineId)).toBe(false);

      const allowed = await correctSalesLine(store, {
        organizationId: fixture.orgId,
        actorId: randomUUID(),
        salesLineId: otherLineId,
        reasonCode: "customer-refund",
      });
      expect(allowed.reversalSalesLineId).toBeTruthy();
      expect(await hasReversal(tx, fixture.orgId, otherLineId)).toBe(true);
    });
  });

  it("blocks a reversal when the month is company-locked", async () => {
    await inRollback(client.db, async (tx) => {
      const fixture = await seedFixture(tx, "2026-03-15T10:00:00.000Z");
      await tx.insert(periodClose).values({
        organizationId: fixture.orgId,
        scopeType: "company",
        scopeId: fixture.orgId,
        periodStart: "2026-03-01",
        periodEnd: "2026-03-31",
        status: "locked",
        checklist: [],
        lockedBy: randomUUID(),
        lockedAt: new Date("2026-04-01T00:00:00.000Z"),
      });
      const store = createPostgresCorrectSalesLineStore(tx);

      await expect(
        correctSalesLine(store, {
          organizationId: fixture.orgId,
          actorId: randomUUID(),
          salesLineId: fixture.lineId,
          reasonCode: "customer-refund",
        }),
      ).rejects.toThrow(/locked for the company/);

      expect(await hasReversal(tx, fixture.orgId, fixture.lineId)).toBe(false);
    });
  });

  it("throws a DomainError on a block", async () => {
    await inRollback(client.db, async (tx) => {
      const fixture = await seedFixture(tx, "2026-03-15T10:00:00.000Z");
      await tx.insert(periodClose).values({
        organizationId: fixture.orgId,
        scopeType: "location",
        scopeId: fixture.locationId,
        periodStart: "2026-03-15",
        periodEnd: "2026-03-15",
        status: "locked",
        checklist: [],
        lockedBy: randomUUID(),
        lockedAt: new Date("2026-03-16T00:00:00.000Z"),
      });
      const store = createPostgresCorrectSalesLineStore(tx);

      await expect(
        correctSalesLine(store, {
          organizationId: fixture.orgId,
          actorId: randomUUID(),
          salesLineId: fixture.lineId,
          reasonCode: "customer-refund",
        }),
      ).rejects.toThrow(DomainError);
    });
  });
});
