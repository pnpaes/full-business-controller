import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient } from "../client";
import { job, organization } from "../schema";
import { countJobsByStatus } from "./jobs";
import { inRollback, uniqueSuffix } from "./test-support";

const databaseUrl = process.env.DATABASE_URL;

/**
 * `countJobsByStatus` is the grouped read behind the `/jobs` hero and status
 * chips. It replaced a bounded `listJobs` fetch, so the contract under test is
 * the true per-status count plus each bucket's oldest `created_at`, both
 * organization-scoped (`DEC-061`).
 */
describe.skipIf(!databaseUrl)("jobs repository — countJobsByStatus", () => {
  let client: DbClient;

  beforeAll(() => {
    client = createDb(databaseUrl!);
  });

  afterAll(async () => {
    await client.close();
  });

  it("groups counts by status with the oldest instant, organization-scoped", async () => {
    await inRollback(client.db, async (tx) => {
      const suffix = uniqueSuffix();
      const orgId = (
        await tx
          .insert(organization)
          .values({ legalName: `job-count-${suffix}` })
          .returning()
      )[0]!.id;
      const otherOrgId = (
        await tx
          .insert(organization)
          .values({ legalName: `job-count-other-${suffix}` })
          .returning()
      )[0]!.id;

      const now = Date.now();
      const oldest = new Date(now - 3 * 24 * 60 * 60 * 1000);
      const newest = new Date(now - 60 * 1000);

      await tx.insert(job).values([
        {
          organizationId: orgId,
          queue: "outbox.platform.smoke",
          kind: "k",
          status: "dead_lettered",
          createdAt: oldest,
        },
        {
          organizationId: orgId,
          queue: "outbox.platform.smoke",
          kind: "k",
          status: "dead_lettered",
          createdAt: newest,
        },
        {
          organizationId: orgId,
          queue: "outbox.platform.smoke",
          kind: "k",
          status: "running",
          createdAt: newest,
        },
        {
          organizationId: otherOrgId,
          queue: "outbox.platform.smoke",
          kind: "k",
          status: "dead_lettered",
          createdAt: oldest,
        },
      ]);

      const counts = await countJobsByStatus(tx, { organizationId: orgId });
      const byStatus = new Map(counts.map((entry) => [entry.status, entry]));

      expect(byStatus.get("dead_lettered")?.count).toBe(2);
      expect(byStatus.get("dead_lettered")?.oldestCreatedAt?.getTime()).toBe(oldest.getTime());
      expect(byStatus.get("running")?.count).toBe(1);

      // A status with no rows is absent, not a zero bucket.
      expect(byStatus.has("succeeded")).toBe(false);
      // The other organization's row is invisible.
      expect(counts.reduce((total, entry) => total + entry.count, 0)).toBe(3);

      const other = await countJobsByStatus(tx, { organizationId: otherOrgId });
      expect(other).toHaveLength(1);
      expect(other[0]!.status).toBe("dead_lettered");
      expect(other[0]!.count).toBe(1);
    });
  });
});
