import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient } from "../client";
import { organization } from "../schema";
import {
  createDataQualityException,
  findDataQualityException,
  listDataQualityExceptions,
  updateDataQualityException,
} from "./data-quality-exception";
import {
  createTestDataQualityException,
  createTestOrganization,
  inRollback,
  rejectionCause,
  uniqueSuffix,
} from "./test-support";

const databaseUrl = process.env.DATABASE_URL;
const suffix = uniqueSuffix();

describe.skipIf(!databaseUrl)("data quality exception repository", () => {
  let client: DbClient;
  let orgId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    orgId = await createTestOrganization(client.db, suffix);
  });

  afterAll(async () => {
    if (client) {
      // Every exception row is created inside a rolled-back transaction, so the
      // only committed fixture to unwind is the organization.
      await client.db.delete(organization).where(eq(organization.id, orgId));
      await client.close();
    }
  });

  it("creates an exception with the schema defaults and finds it organization-scoped", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createDataQualityException(tx, {
        organizationId: orgId,
        ruleCode: "transfer_discrepancy",
        entityType: "stock_transfer",
        entityId: randomUUID(),
      });
      expect(created.severity).toBe("medium");
      expect(created.status).toBe("open");
      expect(created.resolution).toBeNull();
      expect(created.ownerId).toBeNull();
      expect(created.dueDate).toBeNull();
      expect(created.detectedAt).toBeInstanceOf(Date);

      expect(
        (await findDataQualityException(tx, { organizationId: orgId, exceptionId: created.id }))
          ?.id,
      ).toBe(created.id);

      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      expect(
        await findDataQualityException(tx, { organizationId: otherOrgId, exceptionId: created.id }),
      ).toBeUndefined();
    });
  });

  it("lists newest detected_at first with filters and paging", async () => {
    await inRollback(client.db, async (tx) => {
      const older = await createTestDataQualityException(tx, orgId, {
        detectedAt: new Date("2026-03-01T00:00:00.000Z"),
        severity: "low",
        entityType: "stock_count",
      });
      const newer = await createTestDataQualityException(tx, orgId, {
        detectedAt: new Date("2026-04-01T00:00:00.000Z"),
        severity: "high",
      });

      const all = await listDataQualityExceptions(tx, { organizationId: orgId });
      expect(all.map((row) => row.id)).toEqual([newer.id, older.id]);

      const high = await listDataQualityExceptions(tx, { organizationId: orgId, severity: "high" });
      expect(high.map((row) => row.id)).toEqual([newer.id]);

      const byEntity = await listDataQualityExceptions(tx, {
        organizationId: orgId,
        entityType: "stock_count",
      });
      expect(byEntity.map((row) => row.id)).toEqual([older.id]);

      const paged = await listDataQualityExceptions(tx, {
        organizationId: orgId,
        limit: 1,
        offset: 1,
      });
      expect(paged.map((row) => row.id)).toEqual([older.id]);

      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      expect(await listDataQualityExceptions(tx, { organizationId: otherOrgId })).toEqual([]);
    });
  });

  it("updates status and the resolution trail", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createTestDataQualityException(tx, orgId);

      const updated = await updateDataQualityException(tx, created.id, {
        status: "acknowledged",
        ownerId: randomUUID(),
        dueDate: "2026-04-15",
        resolution: "recounted at the destination",
      });
      expect(updated).toMatchObject({
        status: "acknowledged",
        dueDate: "2026-04-15",
        resolution: "recounted at the destination",
      });
      expect(updated?.ownerId).not.toBeNull();

      expect(
        await updateDataQualityException(tx, randomUUID(), { status: "resolved" }),
      ).toBeUndefined();
    });
  });

  it("rejects a severity outside the exception_severity vocabulary", async () => {
    await inRollback(client.db, async (tx) => {
      const cause = await rejectionCause(
        createDataQualityException(tx, {
          organizationId: orgId,
          ruleCode: "transfer_discrepancy",
          entityType: "stock_transfer",
          entityId: randomUUID(),
          severity: "urgent",
        }),
      );
      expect(cause.message).toMatch(/data_quality_exception_severity_check/);
    });
  });

  it("rejects a status outside the exception_status vocabulary", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createTestDataQualityException(tx, orgId);
      const cause = await rejectionCause(
        updateDataQualityException(tx, created.id, { status: "closed" }),
      );
      expect(cause.message).toMatch(/data_quality_exception_status_check/);
    });
  });
});
