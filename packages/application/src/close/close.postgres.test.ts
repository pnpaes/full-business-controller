import { DomainError, NotFoundError } from "@aquarela/domain";
import {
  createDataQualityException,
  createDb,
  createImportRun,
  createReconciliation,
  createReconciliationTolerance,
  location,
  organization,
  periodClose,
  updatePeriodClose,
  type DatabaseTransaction,
  type DbClient,
  type NodeDatabase,
} from "@aquarela/persistence";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { beginPeriodClose } from "./begin-period-close";
import { isPeriodLocked } from "./is-period-locked";
import { listPeriodCloses } from "./list-period-closes";
import { lockPeriodClose } from "./lock-period-close";
import { createPostgresPeriodCloseStore } from "./postgres-store";
import { reopenPeriodClose } from "./reopen-period-close";

const databaseUrl = process.env.DATABASE_URL;
const suffix = randomUUID().replace(/-/g, "").slice(0, 12);

const DAY = "2026-05-14";
const MONTH_START = "2026-05-01";

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

async function seedLocation(tx: DatabaseTransaction, orgId: string, code: string): Promise<string> {
  const rows = await tx
    .insert(location)
    .values({ organizationId: orgId, code, name: "Close IT location" })
    .returning();
  return rows[0]!.id;
}

async function seedOrganization(tx: DatabaseTransaction, name: string): Promise<string> {
  const rows = await tx.insert(organization).values({ legalName: name }).returning();
  return rows[0]!.id;
}

describe.skipIf(!databaseUrl)("period close against PostgreSQL", () => {
  let client: DbClient;
  let orgId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    const org = await client.pool.query<{ id: string }>(
      "insert into organization (legal_name) values ($1) returning id",
      [`Close IT ${suffix}`],
    );
    orgId = org.rows[0]!.id;
  });

  afterAll(async () => {
    if (client) {
      // Every close and location is created inside a rolled-back transaction, so
      // only the organization is committed.
      await client.pool.query("delete from organization where id = $1", [orgId]);
      await client.close();
    }
  });

  it("runs the begin → lock → isPeriodLocked → reopen → begin lifecycle", async () => {
    await inRollback(client.db, async (tx) => {
      const locationId = await seedLocation(tx, orgId, `close_${suffix}`);
      const store = createPostgresPeriodCloseStore(tx);
      const actorId = randomUUID();

      const opened = await beginPeriodClose(store, {
        organizationId: orgId,
        actorId,
        scopeType: "location",
        scopeId: locationId,
        periodStart: DAY,
        checklist: [{ key: "cash_counted", label: "Count the till", done: true }],
      });
      expect(opened).toMatchObject({
        organizationId: orgId,
        scopeType: "location",
        scopeId: locationId,
        periodStart: DAY,
        periodEnd: DAY,
        status: "closing",
        lockedBy: null,
      });

      // Idempotent re-begin while closing.
      const again = await beginPeriodClose(store, {
        organizationId: orgId,
        actorId,
        scopeType: "location",
        scopeId: locationId,
        periodStart: DAY,
        checklist: [],
      });
      expect(again.id).toBe(opened.id);
      expect(again.status).toBe("closing");

      const locked = await lockPeriodClose(store, {
        organizationId: orgId,
        actorId,
        periodCloseId: opened.id,
      });
      expect(locked).toMatchObject({ status: "locked", lockedBy: actorId });
      expect(locked.lockedAt).not.toBeNull();

      const lockedRead = await isPeriodLocked(store, {
        organizationId: orgId,
        scopeType: "location",
        scopeId: locationId,
        at: DAY,
      });
      expect(lockedRead.locked).toBe(true);
      expect(lockedRead.periodClose?.id).toBe(opened.id);

      await expect(
        beginPeriodClose(store, {
          organizationId: orgId,
          actorId,
          scopeType: "location",
          scopeId: locationId,
          periodStart: DAY,
          checklist: [],
        }),
      ).rejects.toThrow(DomainError);

      const reopened = await reopenPeriodClose(store, {
        organizationId: orgId,
        actorId,
        periodCloseId: opened.id,
        reason: "correction",
      });
      expect(reopened).toMatchObject({
        status: "reopened",
        reopenedBy: actorId,
        reopenReason: "correction",
      });

      const reBegun = await beginPeriodClose(store, {
        organizationId: orgId,
        actorId,
        scopeType: "location",
        scopeId: locationId,
        periodStart: DAY,
        checklist: [{ key: "recount", label: "Recount", done: true }],
      });
      expect(reBegun).toMatchObject({ status: "closing" });
      expect(reBegun.checklist).toEqual([{ key: "recount", label: "Recount", done: true }]);

      const rows = await listPeriodCloses(store, { organizationId: orgId });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(opened.id);
    });
  });

  it("opens a company close for the calendar month and scopes reads to the organization", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresPeriodCloseStore(tx);
      const actorId = randomUUID();

      const close = await beginPeriodClose(store, {
        organizationId: orgId,
        actorId,
        scopeType: "company",
        scopeId: orgId,
        periodStart: MONTH_START,
        checklist: [],
      });
      expect(close).toMatchObject({
        scopeType: "company",
        scopeId: orgId,
        periodStart: "2026-05-01",
        periodEnd: "2026-05-31",
      });

      expect(
        await isPeriodLocked(store, {
          organizationId: orgId,
          scopeType: "company",
          scopeId: orgId,
          at: "2026-05-20",
        }),
      ).toEqual({ locked: false });

      await expect(
        lockPeriodClose(store, {
          organizationId: randomUUID(),
          actorId,
          periodCloseId: close.id,
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  it("reads the DEC-107 prerequisites organization-scoped and by period overlap", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresPeriodCloseStore(tx);
      const otherOrgId = await seedOrganization(tx, `Close IT prereq other ${suffix}`);
      const scopeId = randomUUID();

      // Two organization reconciliations: one overlapping May, one in June, plus
      // a May row in another organization that must stay invisible.
      const overlapping = await createReconciliation(tx, {
        organizationId: orgId,
        scopeType: "sales_source",
        scopeId,
        periodStart: "2026-05-01",
        periodEnd: "2026-05-31",
        expectedAmount: "100.0000",
        actualAmount: "90.0000",
        tolerance: "1.0000",
        difference: "-10.0000",
        status: "pending",
      });
      await createReconciliation(tx, {
        organizationId: orgId,
        scopeType: "sales_source",
        scopeId,
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
        expectedAmount: "100.0000",
        actualAmount: "100.0000",
        tolerance: "1.0000",
        difference: "0.0000",
        status: "pending",
      });
      await createReconciliation(tx, {
        organizationId: otherOrgId,
        scopeType: "sales_source",
        scopeId,
        periodStart: "2026-05-01",
        periodEnd: "2026-05-31",
        expectedAmount: "100.0000",
        actualAmount: "100.0000",
        tolerance: "1.0000",
        difference: "0.0000",
        status: "pending",
      });

      const reconciliations = await store.listReconciliationsForPeriod({
        organizationId: orgId,
        from: "2026-05-01",
        to: "2026-05-31",
      });
      expect(reconciliations).toHaveLength(1);
      expect(reconciliations[0]?.status).toBe("pending");
      expect(overlapping.status).toBe("pending");

      // Import runs: an overlapping May run and a June run, plus a May other-org run.
      await createImportRun(tx, {
        organizationId: orgId,
        source: "zettle-legacy",
        profileVersion: "1",
        fileHash: randomUUID(),
        periodStart: "2026-05-01",
        periodEnd: "2026-05-31",
        status: "validated",
      });
      await createImportRun(tx, {
        organizationId: orgId,
        source: "zettle-legacy",
        profileVersion: "1",
        fileHash: randomUUID(),
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
        status: "posted",
      });
      await createImportRun(tx, {
        organizationId: otherOrgId,
        source: "zettle-legacy",
        profileVersion: "1",
        fileHash: randomUUID(),
        periodStart: "2026-05-01",
        periodEnd: "2026-05-31",
        status: "validated",
      });

      const importRuns = await store.listImportRunsForPeriod({
        organizationId: orgId,
        from: "2026-05-01",
        to: "2026-05-31",
      });
      expect(importRuns).toHaveLength(1);
      expect(importRuns[0]?.status).toBe("validated");

      // Exceptions: open/acknowledged count; resolved is not open; other org is invisible.
      for (const status of ["open", "acknowledged", "resolved"]) {
        await createDataQualityException(tx, {
          organizationId: orgId,
          ruleCode: `close_prereq_${suffix}`,
          entityType: "stock_transfer",
          entityId: randomUUID(),
          status,
        });
      }
      await createDataQualityException(tx, {
        organizationId: otherOrgId,
        ruleCode: `close_prereq_other_${suffix}`,
        entityType: "stock_transfer",
        entityId: randomUUID(),
        status: "open",
      });
      expect(await store.countOpenDataQualityExceptions({ organizationId: orgId })).toBe(2);

      // Tolerance: effective at the period end, and an expired window is not.
      await createReconciliationTolerance(tx, {
        organizationId: orgId,
        kind: "sales_settlement",
        rate: "0.010000",
        floorAmount: "1.0000",
        effectiveFrom: "2026-01-01",
      });
      expect(
        await store.findReconciliationTolerance({
          organizationId: orgId,
          kind: "sales_settlement",
          asOf: "2026-05-31",
        }),
      ).toEqual({ effectiveFrom: "2026-01-01" });
      expect(
        await store.findReconciliationTolerance({
          organizationId: orgId,
          kind: "supplier_invoice",
          asOf: "2026-05-31",
        }),
      ).toBeUndefined();
    });
  });

  it("rejects a location scope that is not a location in the organization (23514)", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresPeriodCloseStore(tx);
      const actorId = randomUUID();

      await expect(
        beginPeriodClose(store, {
          organizationId: orgId,
          actorId,
          scopeType: "location",
          scopeId: randomUUID(),
          periodStart: DAY,
          checklist: [],
        }),
      ).rejects.toThrow();

      const otherOrgId = await seedOrganization(tx, `Close IT other ${suffix}`);
      const otherLocationId = await seedLocation(tx, otherOrgId, `close_other_${suffix}`);
      await expect(
        beginPeriodClose(store, {
          organizationId: orgId,
          actorId,
          scopeType: "location",
          scopeId: otherLocationId,
          periodStart: DAY,
          checklist: [],
        }),
      ).rejects.toThrow();
    });
  });

  it("rejects a period that breaks the granularity check (23514)", async () => {
    await inRollback(client.db, async (tx) => {
      const locationId = await seedLocation(tx, orgId, `close_gran_${suffix}`);
      let threw = false;
      try {
        await tx.insert(periodClose).values({
          organizationId: orgId,
          scopeType: "location",
          scopeId: locationId,
          periodStart: DAY,
          periodEnd: "2026-05-15",
          status: "closing",
          checklist: [],
        });
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });
  });

  it("keeps a locked snapshot immutable", async () => {
    await inRollback(client.db, async (tx) => {
      const locationId = await seedLocation(tx, orgId, `close_imm_${suffix}`);
      const store = createPostgresPeriodCloseStore(tx);
      const actorId = randomUUID();

      const opened = await beginPeriodClose(store, {
        organizationId: orgId,
        actorId,
        scopeType: "location",
        scopeId: locationId,
        periodStart: DAY,
        checklist: [],
      });
      await lockPeriodClose(store, {
        organizationId: orgId,
        actorId,
        periodCloseId: opened.id,
      });

      await expect(
        updatePeriodClose(tx, {
          organizationId: orgId,
          periodCloseId: opened.id,
          snapshot: { tampered: true },
          actorId,
        }),
      ).rejects.toThrow();
    });
  });

  it("blocks deleting a locked row (23514)", async () => {
    const connection = await client.pool.connect();
    try {
      await connection.query("begin");
      const loc = await connection.query<{ id: string }>(
        "insert into location (organization_id, code, name) values ($1, $2, $3) returning id",
        [orgId, `close_del_${suffix}`, "Close IT delete"],
      );
      const actorId = randomUUID();
      const pc = await connection.query<{ id: string }>(
        "insert into period_close (organization_id, scope_type, scope_id, period_start, period_end, status, checklist, locked_by, locked_at) values ($1, 'location', $2, $3, $3, 'locked', '[]'::jsonb, $4, now()) returning id",
        [orgId, loc.rows[0]!.id, DAY, actorId],
      );
      await expect(
        connection.query("delete from period_close where id = $1", [pc.rows[0]!.id]),
      ).rejects.toThrow();
      await connection.query("rollback");
    } finally {
      connection.release();
    }
  });
});
