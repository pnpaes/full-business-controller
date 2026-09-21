import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient } from "../client";
import { importRun, organization } from "../schema";
import { createFileObject, findFileObject, listFileObjects } from "./file-object";
import {
  createTestFileObject,
  createTestImportRun,
  createTestOrganization,
  inRollback,
  rejectionCause,
  uniqueName,
  uniqueSuffix,
} from "./test-support";

const databaseUrl = process.env.DATABASE_URL;
const suffix = uniqueSuffix();

const at = (iso: string): Date => new Date(iso);

describe.skipIf(!databaseUrl)("file object repository", () => {
  let client: DbClient;
  let orgId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    orgId = await createTestOrganization(client.db, suffix);
  });

  afterAll(async () => {
    if (client) {
      // Every file object is created inside a rolled-back transaction, so the
      // only committed fixture to unwind is the organization.
      await client.db.delete(organization).where(eq(organization.id, orgId));
      await client.close();
    }
  });

  it("creates a file object and finds it organization-scoped", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createFileObject(tx, {
        organizationId: orgId,
        storageKey: uniqueName("key"),
        filename: "sales-march.csv",
        mime: "text/csv",
        sizeBytes: 2048,
        checksumSha256: uniqueName("sha"),
        retentionPolicy: "default",
      });
      expect(created.filename).toBe("sales-march.csv");
      expect(created.mime).toBe("text/csv");
      expect(created.sizeBytes).toBe(2048);
      expect(created.uploadedBy).toBeNull();
      expect(created.linkedEntityType).toBeNull();
      expect(created.linkedEntityId).toBeNull();
      expect(created.uploadedAt).toBeInstanceOf(Date);

      expect(
        (await findFileObject(tx, { organizationId: orgId, fileObjectId: created.id }))?.id,
      ).toBe(created.id);

      // A file in another organization is invisible at this scope.
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      expect(
        await findFileObject(tx, { organizationId: otherOrgId, fileObjectId: created.id }),
      ).toBeUndefined();
    });
  });

  it("lists newest uploaded_at first with an entity-type filter and paging", async () => {
    await inRollback(client.db, async (tx) => {
      const january = await createTestFileObject(tx, orgId, {
        uploadedAt: at("2026-01-01T00:00:00.000Z"),
        linkedEntityType: "import_run",
      });
      const february = await createTestFileObject(tx, orgId, {
        uploadedAt: at("2026-02-01T00:00:00.000Z"),
        linkedEntityType: "settlement",
      });
      const march = await createTestFileObject(tx, orgId, {
        uploadedAt: at("2026-03-01T00:00:00.000Z"),
        linkedEntityType: "import_run",
      });

      const all = await listFileObjects(tx, { organizationId: orgId });
      expect(all.map((row) => row.id)).toEqual([march.id, february.id, january.id]);

      const runs = await listFileObjects(tx, {
        organizationId: orgId,
        linkedEntityType: "import_run",
      });
      expect(runs.map((row) => row.id)).toEqual([march.id, january.id]);

      const paged = await listFileObjects(tx, { organizationId: orgId, limit: 1, offset: 1 });
      expect(paged.map((row) => row.id)).toEqual([february.id]);

      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const other = await createTestFileObject(tx, otherOrgId);
      expect((await listFileObjects(tx, { organizationId: orgId })).map((r) => r.id)).not.toContain(
        other.id,
      );
    });
  });

  it("rejects a duplicate (organization_id, storage_key)", async () => {
    await inRollback(client.db, async (tx) => {
      const storageKey = uniqueName("key");
      await createTestFileObject(tx, orgId, { storageKey });
      const cause = await rejectionCause(createTestFileObject(tx, orgId, { storageKey }));
      expect(cause.message).toMatch(/file_object_org_storage_key_key/);
    });
  });

  it("rejects a negative size_bytes", async () => {
    await inRollback(client.db, async (tx) => {
      const cause = await rejectionCause(createTestFileObject(tx, orgId, { sizeBytes: -1 }));
      expect(cause.message).toMatch(/file_object_size_bytes_check/);
    });
  });

  it("accepts a run with no file link (null file_object_id)", async () => {
    await inRollback(client.db, async (tx) => {
      const run = await createTestImportRun(tx, orgId);
      expect(run.fileObjectId).toBeNull();
    });
  });

  it("links a run to a file object and rejects an orphan file id (FK)", async () => {
    await inRollback(client.db, async (tx) => {
      const file = await createTestFileObject(tx, orgId);
      const run = await createTestImportRun(tx, orgId, { fileObjectId: file.id });
      expect(run.fileObjectId).toBe(file.id);

      const cause = await rejectionCause(
        createTestImportRun(tx, orgId, { fileObjectId: randomUUID() }),
      );
      expect((cause as { code?: string }).code).toBe("23503");
      expect(cause.message).toMatch(/import_run_file_object_id_file_object_id_fk/);
    });
  });

  it("rejects a run linked to another organization's file (ADR-0006/0036)", async () => {
    await inRollback(client.db, async (tx) => {
      // A same-organization file link is accepted by the guard.
      const mine = await createTestFileObject(tx, orgId);
      const run = await createTestImportRun(tx, orgId, { fileObjectId: mine.id });
      expect(run.fileObjectId).toBe(mine.id);

      // A file from another organization is rejected even though its id is a
      // valid `file_object` row (the single-column FK alone cannot see the
      // organization mismatch).
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const other = await createTestFileObject(tx, otherOrgId);
      const cause = await rejectionCause(
        createTestImportRun(tx, orgId, { fileObjectId: other.id }),
      );
      expect(cause.message).toContain("import_run.file_object_id");
    });
  });

  it("rejects repointing a run to another organization's file (ADR-0006/0036)", async () => {
    await inRollback(client.db, async (tx) => {
      const mine = await createTestFileObject(tx, orgId);
      const run = await createTestImportRun(tx, orgId, { fileObjectId: mine.id });

      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const other = await createTestFileObject(tx, otherOrgId);

      const cause = await rejectionCause(
        (async () => {
          await tx
            .update(importRun)
            .set({ fileObjectId: other.id })
            .where(eq(importRun.id, run.id));
        })(),
      );
      expect(cause.message).toContain("import_run.file_object_id");
    });
  });
});
