import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient } from "../client";
import { externalMapping, importRun, importStagingRow, organization } from "../schema";
import {
  createImportRun,
  createImportStagingRow,
  findExternalMapping,
  findImportRun,
  findOrCreateExternalMapping,
  listExternalMappings,
  listImportRuns,
  listImportStagingRows,
  updateImportRun,
  updateImportStagingRow,
} from "./imports";
import {
  createTestExternalMapping,
  createTestImportRun,
  createTestImportStagingRow,
  createTestOrganization,
  inRollback,
  rejectionCause,
  uniqueName,
  uniqueSuffix,
} from "./test-support";

const databaseUrl = process.env.DATABASE_URL;
const suffix = uniqueSuffix();

const at = (iso: string): Date => new Date(iso);

describe.skipIf(!databaseUrl)("imports repository", () => {
  let client: DbClient;
  let orgId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    orgId = await createTestOrganization(client.db, suffix);
  });

  afterAll(async () => {
    if (client) {
      await client.db.delete(organization).where(eq(organization.id, orgId));
      await client.close();
    }
  });

  it("creates an import run and finds/lists it organization-scoped", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createImportRun(tx, {
        organizationId: orgId,
        source: "frontline",
        profileVersion: "v1",
        fileHash: uniqueName("hash"),
        periodStart: "2026-03-01",
        periodEnd: "2026-03-31",
      });
      expect(created.status).toBe("uploaded");
      expect(created.rowCounts).toEqual({});
      expect(created.diagnostics).toEqual({});
      expect(created.fileObjectId).toBeNull();

      expect(
        (await findImportRun(tx, { organizationId: orgId, importRunId: created.id }))?.id,
      ).toBe(created.id);

      // Explicit created_at so the newest-first ordering is not a coin flip on
      // the transaction-identical now().
      const january = await createTestImportRun(tx, orgId, {
        createdAt: at("2026-01-01T00:00:00.000Z"),
      });
      const february = await createTestImportRun(tx, orgId, {
        createdAt: at("2026-02-01T00:00:00.000Z"),
        source: "wolt",
        status: "validated",
      });

      const all = await listImportRuns(tx, { organizationId: orgId });
      expect(all.map((row) => row.id)).toEqual([created.id, february.id, january.id]);

      const bySource = await listImportRuns(tx, { organizationId: orgId, source: "wolt" });
      expect(bySource.map((row) => row.id)).toEqual([february.id]);

      const byStatus = await listImportRuns(tx, { organizationId: orgId, status: "validated" });
      expect(byStatus.map((row) => row.id)).toEqual([february.id]);

      const paged = await listImportRuns(tx, { organizationId: orgId, limit: 1, offset: 1 });
      expect(paged.map((row) => row.id)).toEqual([february.id]);

      // A run in another organization is invisible at this scope.
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const other = await createTestImportRun(tx, otherOrgId);
      expect(
        await findImportRun(tx, { organizationId: orgId, importRunId: other.id }),
      ).toBeUndefined();
      expect((await listImportRuns(tx, { organizationId: orgId })).map((r) => r.id)).not.toContain(
        other.id,
      );
    });
  });

  it("rejects a duplicate file hash", async () => {
    await inRollback(client.db, async (tx) => {
      const hash = uniqueName("hash");
      await createTestImportRun(tx, orgId, { fileHash: hash });
      const cause = await rejectionCause(createTestImportRun(tx, orgId, { fileHash: hash }));
      expect(cause.message).toMatch(/import_run_file_hash_key/);
    });
  });

  it("rejects an out-of-vocabulary run status", async () => {
    await inRollback(client.db, async (tx) => {
      const cause = await rejectionCause(
        createImportRun(tx, {
          organizationId: orgId,
          source: "frontline",
          profileVersion: "v1",
          fileHash: uniqueName("hash"),
          periodStart: "2026-03-01",
          periodEnd: "2026-03-31",
          status: "processing",
        }),
      );
      expect(cause.message).toMatch(/import_run_status_check/);
    });
  });

  it("rejects a reversed import period", async () => {
    await inRollback(client.db, async (tx) => {
      const cause = await rejectionCause(
        createImportRun(tx, {
          organizationId: orgId,
          source: "frontline",
          profileVersion: "v1",
          fileHash: uniqueName("hash"),
          periodStart: "2026-03-31",
          periodEnd: "2026-03-01",
        }),
      );
      expect(cause.message).toMatch(/import_run_period_check/);
    });
  });

  it("updates a run additively (status, row_counts, diagnostics)", async () => {
    await inRollback(client.db, async (tx) => {
      const run = await createTestImportRun(tx, orgId);

      const parsed = await updateImportRun(tx, run.id, {
        status: "parsed",
        rowCounts: { parsed: 10, rejected: 0 },
        diagnostics: { warnings: 1 },
      });
      expect(parsed?.status).toBe("parsed");
      expect(parsed?.rowCounts).toEqual({ parsed: 10, rejected: 0 });
      expect(parsed?.diagnostics).toEqual({ warnings: 1 });
      // The patch is additive: the file hash is preserved.
      expect(parsed?.fileHash).toBe(run.fileHash);

      expect(
        await updateImportRun(tx, "00000000-0000-0000-0000-000000000000", { status: "failed" }),
      ).toBeUndefined();
    });
  });

  it("creates and lists staging rows organization-scoped through the parent", async () => {
    await inRollback(client.db, async (tx) => {
      const run = await createTestImportRun(tx, orgId);
      const first = await createImportStagingRow(tx, {
        importRunId: run.id,
        sourceRowNo: 1,
        raw: { sku: "A", qty: 2 },
      });
      await createImportStagingRow(tx, {
        importRunId: run.id,
        sourceRowNo: 2,
        raw: { sku: "B", qty: 1 },
      });
      expect(first.mappingState).toBe("unmapped");
      expect(first.raw).toEqual({ sku: "A", qty: 2 });

      const rows = await listImportStagingRows(tx, { organizationId: orgId, importRunId: run.id });
      expect(rows.map((row) => row.sourceRowNo)).toEqual([1, 2]);

      const updated = await updateImportStagingRow(tx, first.id, {
        mappingState: "mapped",
        normalized: { sku: "A", productVariantId: "00000000-0000-0000-0000-0000000000c1" },
        linkedSalesLineId: "00000000-0000-0000-0000-0000000000c2",
      });
      expect(updated?.mappingState).toBe("mapped");
      expect(updated?.linkedSalesLineId).toBe("00000000-0000-0000-0000-0000000000c2");

      // Another organization's run resolves to no staging rows at this scope.
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const otherRun = await createTestImportRun(tx, otherOrgId);
      await createTestImportStagingRow(tx, otherRun.id, { sourceRowNo: 1 });
      expect(
        await listImportStagingRows(tx, { organizationId: orgId, importRunId: otherRun.id }),
      ).toHaveLength(0);
    });
  });

  it("rejects a duplicate staging-row number", async () => {
    await inRollback(client.db, async (tx) => {
      const run = await createTestImportRun(tx, orgId);
      await createTestImportStagingRow(tx, run.id, { sourceRowNo: 5 });

      const cause = await rejectionCause(
        createImportStagingRow(tx, { importRunId: run.id, sourceRowNo: 5 }),
      );
      expect(cause.message).toMatch(/import_staging_row_run_row_no_key/);
    });
  });

  it("rejects an out-of-vocabulary staging mapping state", async () => {
    await inRollback(client.db, async (tx) => {
      const run = await createTestImportRun(tx, orgId);
      const cause = await rejectionCause(
        createImportStagingRow(tx, {
          importRunId: run.id,
          sourceRowNo: 6,
          mappingState: "resolved",
        }),
      );
      expect(cause.message).toMatch(/import_staging_row_mapping_state_check/);
    });
  });

  it("cascades staging-row deletes from the parent run", async () => {
    await inRollback(client.db, async (tx) => {
      const run = await createTestImportRun(tx, orgId);
      await createTestImportStagingRow(tx, run.id, { sourceRowNo: 1 });
      await createTestImportStagingRow(tx, run.id, { sourceRowNo: 2 });

      await tx.delete(importRun).where(eq(importRun.id, run.id));

      const remaining = await tx
        .select()
        .from(importStagingRow)
        .where(eq(importStagingRow.importRunId, run.id));
      expect(remaining).toHaveLength(0);
    });
  });

  it("find-or-creates an external mapping on its natural key", async () => {
    await inRollback(client.db, async (tx) => {
      const key = {
        organizationId: orgId,
        sourceSystem: "frontline",
        entityType: "product",
        externalId: uniqueName("ext"),
        internalEntityType: "product_variant",
        internalEntityId: "00000000-0000-0000-0000-0000000000d1",
        effectiveFrom: at("2026-01-01T00:00:00.000Z"),
      };

      const first = await findOrCreateExternalMapping(tx, key);
      expect(first.sku).toBeNull();

      const second = await findOrCreateExternalMapping(tx, key);
      expect(second.id).toBe(first.id);

      const other = await findOrCreateExternalMapping(tx, {
        ...key,
        effectiveFrom: at("2026-06-01T00:00:00.000Z"),
      });
      expect(other.id).not.toBe(first.id);

      expect(
        (await findExternalMapping(tx, { organizationId: orgId, externalMappingId: first.id }))?.id,
      ).toBe(first.id);

      const listed = await listExternalMappings(tx, {
        organizationId: orgId,
        sourceSystem: "frontline",
        entityType: "product",
        externalId: key.externalId,
      });
      expect(listed.map((row) => row.id)).toEqual([other.id, first.id]);

      // The unique key is global, so a direct duplicate is rejected.
      const duplicate = await rejectionCause(
        createTestExternalMapping(tx, orgId, {
          sourceSystem: key.sourceSystem,
          entityType: key.entityType,
          externalId: key.externalId,
          effectiveFrom: key.effectiveFrom,
        }),
      );
      expect(duplicate.message).toMatch(/external_mapping_key/);
    });
  });

  it("rejects a cross-organization mapping that reuses a taken key", async () => {
    await inRollback(client.db, async (tx) => {
      const externalId = uniqueName("ext");
      await createTestExternalMapping(tx, orgId, { externalId });

      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const cause = await rejectionCause(
        findOrCreateExternalMapping(tx, {
          organizationId: otherOrgId,
          sourceSystem: "frontline",
          entityType: "product",
          externalId,
          internalEntityType: "product_variant",
          internalEntityId: "00000000-0000-0000-0000-0000000000d2",
          effectiveFrom: at("2026-01-01T00:00:00.000Z"),
        }),
      );
      expect(cause.message).toMatch(
        /external_mapping row missing after findOrCreateExternalMapping/,
      );
    });
  });

  it("rejects an out-of-range external-mapping effective window", async () => {
    await inRollback(client.db, async (tx) => {
      const cause = await rejectionCause(
        createTestExternalMapping(tx, orgId, {
          effectiveFrom: at("2026-06-01T00:00:00.000Z"),
          effectiveTo: at("2026-01-01T00:00:00.000Z"),
        }),
      );
      expect(cause.message).toMatch(/external_mapping_effective_range_check/);
    });
  });

  it("keeps another organization's mappings invisible", async () => {
    await inRollback(client.db, async (tx) => {
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const other = await createTestExternalMapping(tx, otherOrgId);

      expect(
        await findExternalMapping(tx, {
          organizationId: orgId,
          externalMappingId: other.id,
        }),
      ).toBeUndefined();
      expect(
        (await listExternalMappings(tx, { organizationId: orgId })).map((r) => r.id),
      ).not.toContain(other.id);
    });
  });

  it("exposes the import-framework tables", () => {
    expect(importRun).toBeDefined();
    expect(importStagingRow).toBeDefined();
    expect(externalMapping).toBeDefined();
  });
});
