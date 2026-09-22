import { DomainError, NotFoundError } from "@aquarela/domain";
import {
  adjustmentPeriod,
  createAdjustmentPeriod,
  createDb,
  organization,
  type DatabaseTransaction,
  type DbClient,
  type NodeDatabase,
} from "@aquarela/persistence";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeAdjustmentPeriod } from "./close-adjustment-period";
import { listAdjustmentPeriods } from "./list-adjustment-periods";
import { openAdjustmentPeriod } from "./open-adjustment-period";
import { createPostgresAdjustmentPeriodStore } from "./postgres-store";

const databaseUrl = process.env.DATABASE_URL;
const suffix = randomUUID().replace(/-/g, "").slice(0, 12);

const FROM = "2026-05-01";
const TO = "2026-05-07";

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

/**
 * Walks the drizzle error chain to the pg SQLSTATE. `drizzle-orm` wraps the
 * driver error in a `DrizzleQueryError`, so `code` lives on `.cause`, not on the
 * top-level object the test catches.
 */
function sqlState(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") {
      return code;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

async function seedOrganization(tx: DatabaseTransaction, name: string): Promise<string> {
  const rows = await tx.insert(organization).values({ legalName: name }).returning();
  return rows[0]!.id;
}

describe.skipIf(!databaseUrl)("adjustment period against PostgreSQL", () => {
  let client: DbClient;
  let orgId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    const org = await client.pool.query<{ id: string }>(
      "insert into organization (legal_name) values ($1) returning id",
      [`Adjustment IT ${suffix}`],
    );
    orgId = org.rows[0]!.id;
  });

  afterAll(async () => {
    if (client) {
      // Every adjustment period is created inside a rolled-back transaction, so
      // only the organization is committed.
      await client.pool.query("delete from organization where id = $1", [orgId]);
      await client.close();
    }
  });

  it("runs the open → close → open-again lifecycle", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresAdjustmentPeriodStore(tx);
      const actorId = randomUUID();

      const opened = await openAdjustmentPeriod(store, {
        organizationId: orgId,
        actorId,
        openedFrom: FROM,
        openedTo: TO,
        reason: "late invoice corrections",
      });
      expect(opened).toMatchObject({
        organizationId: orgId,
        openedFrom: FROM,
        openedTo: TO,
        reason: "late invoice corrections",
        status: "open",
        approvedBy: actorId,
      });
      expect(opened.approvedAt).not.toBeNull();

      // A second open is refused while one is open.
      await expect(
        openAdjustmentPeriod(store, {
          organizationId: orgId,
          actorId,
          openedFrom: "2026-06-01",
          openedTo: "2026-06-02",
          reason: "second",
        }),
      ).rejects.toThrow(DomainError);

      const closed = await closeAdjustmentPeriod(store, {
        organizationId: orgId,
        actorId,
        adjustmentPeriodId: opened.id,
      });
      expect(closed).toMatchObject({ status: "closed" });

      // After closing, a new window may open.
      const reopened = await openAdjustmentPeriod(store, {
        organizationId: orgId,
        actorId,
        openedFrom: "2026-06-01",
        openedTo: "2026-06-02",
        reason: "second",
      });
      expect(reopened).toMatchObject({ status: "open" });

      const rows = await listAdjustmentPeriods(store, { organizationId: orgId });
      expect(rows.map((row) => row.openedFrom)).toEqual(["2026-06-01", FROM]);
    });
  });

  it("scopes reads and writes to the organization", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresAdjustmentPeriodStore(tx);
      const actorId = randomUUID();

      const opened = await openAdjustmentPeriod(store, {
        organizationId: orgId,
        actorId,
        openedFrom: FROM,
        openedTo: TO,
        reason: "scoped",
      });

      await expect(
        closeAdjustmentPeriod(store, {
          organizationId: randomUUID(),
          actorId,
          adjustmentPeriodId: opened.id,
        }),
      ).rejects.toThrow(NotFoundError);

      const otherOrgId = await seedOrganization(tx, `Adjustment IT other ${suffix}`);
      const otherStore = createPostgresAdjustmentPeriodStore(tx);
      expect(await listAdjustmentPeriods(otherStore, { organizationId: otherOrgId })).toEqual([]);
    });
  });

  it("rejects a second open period for the organization (partial unique, 23505)", async () => {
    await inRollback(client.db, async (tx) => {
      const actorId = randomUUID();
      const approvedAt = new Date();
      await createAdjustmentPeriod(tx, {
        organizationId: orgId,
        openedFrom: FROM,
        openedTo: TO,
        reason: "first",
        status: "open",
        approvedBy: actorId,
        approvedAt,
        createdBy: actorId,
      });

      let error: unknown;
      try {
        await createAdjustmentPeriod(tx, {
          organizationId: orgId,
          openedFrom: "2026-06-01",
          openedTo: "2026-06-02",
          reason: "second",
          status: "open",
          approvedBy: actorId,
          approvedAt,
          createdBy: actorId,
        });
      } catch (caught) {
        error = caught;
      }
      expect(sqlState(error)).toBe("23505");
    });
  });

  it("rejects an inverted window and a half-set approval pair (23514)", async () => {
    // Each violation aborts its transaction, so they must run in separate ones
    // (a second statement in an aborted transaction fails with 25P02, not 23514).
    await inRollback(client.db, async (tx) => {
      let error: unknown;
      try {
        await tx.insert(adjustmentPeriod).values({
          organizationId: orgId,
          openedFrom: TO,
          openedTo: FROM,
          reason: "inverted",
          status: "closed",
        });
      } catch (caught) {
        error = caught;
      }
      expect(sqlState(error)).toBe("23514");
    });

    await inRollback(client.db, async (tx) => {
      let error: unknown;
      try {
        await tx.insert(adjustmentPeriod).values({
          organizationId: orgId,
          openedFrom: FROM,
          openedTo: TO,
          reason: "half approval",
          status: "closed",
          approvedBy: randomUUID(),
        });
      } catch (caught) {
        error = caught;
      }
      expect(sqlState(error)).toBe("23514");
    });
  });
});
