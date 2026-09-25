import {
  createDb,
  organization,
  sql,
  type DatabaseTransaction,
  type DbClient,
  type NodeDatabase,
} from "@aquarela/persistence";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresForecastStore } from "./postgres-store";

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

/** The full pg error chain, so a wrapped driver message is still visible. */
function errorChain(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth++) {
    parts.push(current instanceof Error ? current.message : String(current));
    current = (current as { cause?: unknown }).cause;
  }
  return parts.join(" | ");
}

async function createOrg(tx: DatabaseTransaction, label: string): Promise<string> {
  const rows = await tx
    .insert(organization)
    .values({ legalName: `${label}-${suffix}` })
    .returning();
  return rows[0]!.id;
}

function snapshotInput(organizationId: string, asOf: string) {
  return {
    organizationId,
    metric: "revenue",
    grain: "day_location" as const,
    locationId: null,
    channelId: null,
    category: null,
    productVariantId: null,
    asOf,
    model: "least_squares_linear",
    projection: [{ period: "2026-06-06", value: "140.0000", lower: "130.0000", upper: "150.0000" }],
    accuracyMethod: "mape",
    accuracyMape: "0.010000",
    accuracyPoints: 4,
    actorId: randomUUID(),
  };
}

describe.skipIf(!databaseUrl)("forecast store against PostgreSQL", () => {
  let client: DbClient;

  beforeAll(() => {
    client = createDb(databaseUrl!);
  });

  afterAll(async () => {
    await client.close();
  });

  it("round-trips a snapshot, returns the newest and scopes the lookup by organization", async () => {
    await inRollback(client.db, async (tx) => {
      const orgId = await createOrg(tx, "fcst-snap");
      const otherOrgId = await createOrg(tx, "fcst-snap-b");
      const store = createPostgresForecastStore(tx);

      const older = await store.createForecastSnapshot(
        snapshotInput(orgId, "2026-06-05T12:00:00.000Z"),
      );
      const newer = await store.createForecastSnapshot(
        snapshotInput(orgId, "2026-06-06T12:00:00.000Z"),
      );
      expect(older.projection[0]!.value).toBe("140.0000");

      const latest = await store.findLatestForecastSnapshot({
        organizationId: orgId,
        metric: "revenue",
        grain: "day_location",
        locationId: null,
        channelId: null,
        category: null,
        productVariantId: null,
      });
      expect(latest?.id).toBe(newer.id);
      expect(latest?.projection).toHaveLength(1);

      const foreign = await store.findLatestForecastSnapshot({
        organizationId: otherOrgId,
        metric: "revenue",
        grain: "day_location",
        locationId: null,
        channelId: null,
        category: null,
        productVariantId: null,
      });
      expect(foreign).toBeUndefined();
    });
  });

  it("rejects a duplicate snapshot for the same scope and as_of (natural uniqueness)", async () => {
    await inRollback(client.db, async (tx) => {
      const orgId = await createOrg(tx, "fcst-dup");
      const store = createPostgresForecastStore(tx);
      await store.createForecastSnapshot(snapshotInput(orgId, "2026-06-05T12:00:00.000Z"));

      let caught: unknown;
      try {
        await tx.transaction(async (inner) => {
          await createPostgresForecastStore(inner).createForecastSnapshot(
            snapshotInput(orgId, "2026-06-05T12:00:00.000Z"),
          );
        });
      } catch (error) {
        caught = error;
      }
      expect(errorChain(caught)).toContain("forecast_snapshot_org_scope_asof_key");
    });
  });

  it("appends overrides and enforces append-only plus the mandatory reason at the database", async () => {
    await inRollback(client.db, async (tx) => {
      const orgId = await createOrg(tx, "fcst-override");
      const store = createPostgresForecastStore(tx);

      const created = await store.createForecastOverride({
        organizationId: orgId,
        snapshotId: null,
        metric: "revenue",
        grain: "day_location",
        period: "2026-09-25",
        locationId: null,
        channelId: null,
        category: null,
        productVariantId: null,
        actorId: randomUUID(),
        reason: "local festival distorted the day",
      });
      const listed = await store.listForecastOverrides({
        organizationId: orgId,
        metric: "revenue",
        grain: "day_location",
      });
      expect(listed.map((row) => row.id)).toEqual([created.id]);

      let updateError: unknown;
      try {
        await tx.transaction(async (inner) => {
          await inner.execute(
            sql`update "forecast_override" set "reason" = 'changed' where "id" = ${created.id}`,
          );
        });
      } catch (error) {
        updateError = error;
      }
      expect(errorChain(updateError)).toContain("append-only");

      let deleteError: unknown;
      try {
        await tx.transaction(async (inner) => {
          await inner.execute(sql`delete from "forecast_override" where "id" = ${created.id}`);
        });
      } catch (error) {
        deleteError = error;
      }
      expect(errorChain(deleteError)).toContain("append-only");

      let blankReasonError: unknown;
      try {
        await tx.transaction(async (inner) => {
          await createPostgresForecastStore(inner).createForecastOverride({
            organizationId: orgId,
            snapshotId: null,
            metric: "revenue",
            grain: "day_location",
            period: "2026-09-26",
            locationId: null,
            channelId: null,
            category: null,
            productVariantId: null,
            actorId: randomUUID(),
            reason: "   ",
          });
        });
      } catch (error) {
        blankReasonError = error;
      }
      expect(errorChain(blankReasonError)).toContain("forecast_override_reason_check");
    });
  });
});
