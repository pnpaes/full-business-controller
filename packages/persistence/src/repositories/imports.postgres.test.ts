import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient } from "../client";
import {
  externalMapping,
  importProfile,
  importRun,
  importStagingRow,
  organization,
} from "../schema";
import {
  createImportProfile,
  createImportRun,
  createImportStagingRow,
  findExternalMapping,
  findImportProfile,
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
  createTestImportProfile,
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

  it("accepts the conflict staging mapping state (DEC-074)", async () => {
    await inRollback(client.db, async (tx) => {
      const run = await createTestImportRun(tx, orgId);
      const row = await createTestImportStagingRow(tx, run.id, {
        sourceRowNo: 7,
        mappingState: "conflict",
        errorCode: "mapping_conflict",
      });
      expect(row.mappingState).toBe("conflict");
      expect(row.errorCode).toBe("mapping_conflict");
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

  it("creates a profile and finds it by source or id, organization-scoped", async () => {
    await inRollback(client.db, async (tx) => {
      const source = uniqueName("source");
      const created = await createImportProfile(tx, {
        organizationId: orgId,
        source,
        profileVersion: "2026-03",
        validationRules: { requiredNormalizedFields: ["occurred_at"] },
      });
      expect(created.postingPolicy).toBe("allow_partial");
      expect(created.profileVersion).toBe("2026-03");
      expect(created.validationRules).toEqual({ requiredNormalizedFields: ["occurred_at"] });

      expect((await findImportProfile(tx, { organizationId: orgId, source }))?.id).toBe(created.id);
      expect(
        (await findImportProfile(tx, { organizationId: orgId, importProfileId: created.id }))?.id,
      ).toBe(created.id);

      // A source that was never profiled resolves to undefined.
      expect(
        await findImportProfile(tx, { organizationId: orgId, source: uniqueName("source") }),
      ).toBeUndefined();
    });
  });

  it("defaults a profile's posting policy and validation rules", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createTestImportProfile(tx, orgId);
      expect(created.postingPolicy).toBe("allow_partial");
      expect(created.validationRules).toEqual({});
      // A run created without a profile is a legacy run: the link stays null.
      expect((await createTestImportRun(tx, orgId)).importProfileId).toBeNull();
    });
  });

  it("keeps another organization's profile invisible by source and by id", async () => {
    await inRollback(client.db, async (tx) => {
      const source = uniqueName("source");
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const other = await createTestImportProfile(tx, otherOrgId, { source });

      expect(await findImportProfile(tx, { organizationId: orgId, source })).toBeUndefined();
      expect(
        await findImportProfile(tx, { organizationId: orgId, importProfileId: other.id }),
      ).toBeUndefined();

      // The same source in a second organization is a distinct profile.
      const mine = await createTestImportProfile(tx, orgId, { source });
      expect(mine.id).not.toBe(other.id);
    });
  });

  it("rejects a duplicate (organization_id, source) profile", async () => {
    await inRollback(client.db, async (tx) => {
      const source = uniqueName("source");
      await createTestImportProfile(tx, orgId, { source });
      const cause = await rejectionCause(createTestImportProfile(tx, orgId, { source }));
      expect(cause.message).toMatch(/import_profile_org_source_key/);
    });
  });

  it("rejects an out-of-vocabulary profile posting policy", async () => {
    await inRollback(client.db, async (tx) => {
      const cause = await rejectionCause(
        createTestImportProfile(tx, orgId, { postingPolicy: "best_effort" }),
      );
      expect(cause.message).toMatch(/import_profile_posting_policy_check/);
    });
  });

  it("rejects non-object validation rules", async () => {
    await inRollback(client.db, async (tx) => {
      const cause = await rejectionCause(
        createTestImportProfile(tx, orgId, { validationRules: [] }),
      );
      expect(cause.message).toMatch(/import_profile_validation_rules_check/);
    });
  });

  it("links a run to a profile and rejects an unknown profile id", async () => {
    await inRollback(client.db, async (tx) => {
      const profile = await createTestImportProfile(tx, orgId);
      const run = await createTestImportRun(tx, orgId, { importProfileId: profile.id });
      expect(run.importProfileId).toBe(profile.id);

      const cause = await rejectionCause(
        createTestImportRun(tx, orgId, {
          importProfileId: "00000000-0000-0000-0000-000000000000",
        }),
      );
      expect(cause.message).toMatch(/import_run_import_profile_id_import_profile_id_fk/);
    });
  });

  it("rejects a run linked to another organization's profile (DEC-079/0032)", async () => {
    await inRollback(client.db, async (tx) => {
      // A same-organization profile link is accepted by the guard.
      const mine = await createTestImportProfile(tx, orgId);
      const run = await createTestImportRun(tx, orgId, { importProfileId: mine.id });
      expect(run.importProfileId).toBe(mine.id);

      // A profile from another organization is rejected even though its id is a
      // valid `import_profile` row (the single-column FK alone cannot see the
      // organization mismatch).
      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const other = await createTestImportProfile(tx, otherOrgId);
      const cause = await rejectionCause(
        createTestImportRun(tx, orgId, { importProfileId: other.id }),
      );
      expect(cause.message).toContain("import_run.import_profile_id");
    });
  });

  it("rejects repointing a run to another organization's profile (DEC-079/0032)", async () => {
    await inRollback(client.db, async (tx) => {
      const mine = await createTestImportProfile(tx, orgId);
      const run = await createTestImportRun(tx, orgId, { importProfileId: mine.id });

      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      const other = await createTestImportProfile(tx, otherOrgId);

      const cause = await rejectionCause(
        (async () => {
          await tx
            .update(importRun)
            .set({ importProfileId: other.id })
            .where(eq(importRun.id, run.id));
        })(),
      );
      expect(cause.message).toContain("import_run.import_profile_id");
    });
  });

  it("exposes the import-framework tables", () => {
    expect(importRun).toBeDefined();
    expect(importStagingRow).toBeDefined();
    expect(externalMapping).toBeDefined();
    expect(importProfile).toBeDefined();
  });
});
