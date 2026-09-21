import { describe, expect, it } from "vitest";

import { DomainError } from "@aquarela/domain";

import { createImportRun } from "./create-import-run";
import { IMPORT_DIAGNOSTIC_KEYS } from "./diagnostics";
import { disposeStagingRow } from "./dispose-staging-row";
import { getImportRun } from "./get-import-run";
import { listImportRuns } from "./list-import-runs";
import { mapImportRows } from "./map-import-rows";
import { previewImportRun } from "./preview-import-run";
import { stageImportRows, type StageImportRowInput } from "./stage-import-rows";
import { FakeImportStore, seedImportFixture, type ImportFixture } from "./test-support";
import { validateImportRun } from "./validate-import-run";

const PERIOD_START = "2026-01-01";
const PERIOD_END = "2026-02-01";
const EFFECTIVE_FROM = "2026-01-01T00:00:00.000Z";

function row(
  sourceRowNo: number,
  normalized: Record<string, unknown>,
  raw: Record<string, unknown> = {},
): StageImportRowInput {
  return { sourceRowNo, raw, normalized };
}

async function openRun(
  store: FakeImportStore,
  fixture: ImportFixture,
  overrides: { fileHash?: string; organizationId?: string } = {},
): Promise<string> {
  const result = await createImportRun(store, {
    organizationId: overrides.organizationId ?? fixture.organizationId,
    actorId: fixture.actorId,
    source: fixture.source,
    profileVersion: "profile-v1",
    fileHash: overrides.fileHash ?? "hash-1",
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
  });
  return result.importRunId;
}

async function stageAndValidate(
  store: FakeImportStore,
  fixture: ImportFixture,
  rows: readonly StageImportRowInput[],
  options: { fileHash?: string; rules?: Parameters<typeof validateImportRun>[1]["rules"] } = {},
): Promise<string> {
  const importRunId = await openRun(store, fixture, {
    ...(options.fileHash === undefined ? {} : { fileHash: options.fileHash }),
  });
  await stageImportRows(store, {
    organizationId: fixture.organizationId,
    actorId: fixture.actorId,
    importRunId,
    rows,
  });
  await validateImportRun(store, {
    organizationId: fixture.organizationId,
    actorId: fixture.actorId,
    importRunId,
    ...(options.rules === undefined ? {} : { rules: options.rules }),
  });
  return importRunId;
}

function fixtureWithConflict(store: FakeImportStore): ImportFixture {
  const fixture = seedImportFixture(store);
  const base = {
    organizationId: fixture.organizationId,
    sourceSystem: fixture.sourceSystem,
    entityType: "item",
    sku: null,
    internalEntityType: "item",
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
  } as const;
  store.externalMappings.set("map-dup-1", {
    ...base,
    id: "map-dup-1",
    externalId: "ext-dup",
    internalEntityId: "item-dup-1",
  });
  store.externalMappings.set("map-dup-2", {
    ...base,
    id: "map-dup-2",
    externalId: "ext-dup",
    internalEntityId: "item-dup-2",
  });
  store.externalMappings.set("map-split-1", {
    ...base,
    id: "map-split-1",
    externalId: "ext-split-1",
    internalEntityId: "item-split",
  });
  store.externalMappings.set("map-split-2", {
    ...base,
    id: "map-split-2",
    externalId: "ext-split-2",
    internalEntityId: "item-split",
  });
  return fixture;
}

describe("createImportRun", () => {
  it("registers an upload in uploaded and records the posting policy", async () => {
    const store = new FakeImportStore();
    const fixture = seedImportFixture(store);

    const result = await createImportRun(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      source: fixture.source,
      profileVersion: "profile-v1",
      fileHash: "hash-1",
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });

    const detail = await getImportRun(store, {
      organizationId: fixture.organizationId,
      importRunId: result.importRunId,
    });
    expect(result.status).toBe("uploaded");
    expect(detail?.run).toMatchObject({ status: "uploaded", profileVersion: "profile-v1" });
    expect(detail?.run.diagnostics).toMatchObject({ posting_policy: "allow_partial" });
    expect(store.auditEvents.map((event) => event.action)).toContain("sales.import_run.created");
  });

  it("rejects a duplicate file hash as a replay of the existing run", async () => {
    const store = new FakeImportStore();
    const fixture = seedImportFixture(store);
    const first = await openRun(store, fixture);

    await expect(openRun(store, fixture)).rejects.toThrow(DomainError);
    expect(store.importRuns.size).toBe(1);
    expect(first).toBeDefined();
  });

  it("allows the same file hash in another organization (DEC-061 scoping)", async () => {
    const store = new FakeImportStore();
    const fixture = seedImportFixture(store);
    await openRun(store, fixture);
    await expect(
      openRun(store, fixture, { organizationId: fixture.otherOrganizationId }),
    ).resolves.toBeDefined();
  });

  it("rejects an inverted period and an unknown posting policy", async () => {
    const store = new FakeImportStore();
    const fixture = seedImportFixture(store);
    await expect(
      createImportRun(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        source: fixture.source,
        profileVersion: "profile-v1",
        fileHash: "hash-x",
        periodStart: PERIOD_END,
        periodEnd: PERIOD_START,
      }),
    ).rejects.toThrow(DomainError);
    await expect(
      createImportRun(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        source: fixture.source,
        profileVersion: "profile-v1",
        fileHash: "hash-y",
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
        postingPolicy: "sometimes",
      }),
    ).rejects.toThrow(DomainError);
  });
});

describe("stageImportRows", () => {
  it("stages every row and moves the run to parsed", async () => {
    const store = new FakeImportStore();
    const fixture = seedImportFixture(store);
    const importRunId = await openRun(store, fixture);

    const result = await stageImportRows(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      importRunId,
      rows: [
        row(1, { sku: fixture.itemSku }),
        row(2, { external_id: "ext-tea" }),
        row(3, { nothing: true }),
      ],
    });

    expect(result).toMatchObject({ stagedCount: 3, status: "parsed" });
    const detail = await getImportRun(store, {
      organizationId: fixture.organizationId,
      importRunId,
    });
    expect(detail?.rows).toHaveLength(3);
    expect(detail?.rows[0]).toMatchObject({ sourceRowNo: 1, mappingState: "unmapped" });
    expect(detail?.run.rowCounts).toMatchObject({ staged: 3 });
  });

  it("rejects re-staging an already-parsed run", async () => {
    const store = new FakeImportStore();
    const fixture = seedImportFixture(store);
    const importRunId = await stageAndValidate(store, fixture, [row(1, { sku: fixture.itemSku })]);

    await expect(
      stageImportRows(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        importRunId,
        rows: [row(2, { sku: fixture.itemSku })],
      }),
    ).rejects.toThrow(DomainError);
  });

  it("rejects a duplicate source row number before writing anything", async () => {
    const store = new FakeImportStore();
    const fixture = seedImportFixture(store);
    const importRunId = await openRun(store, fixture);

    await expect(
      stageImportRows(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        importRunId,
        rows: [row(1, {}), row(1, {})],
      }),
    ).rejects.toThrow(DomainError);
    expect(store.stagingRows.size).toBe(0);
  });
});

describe("validateImportRun", () => {
  it("validates clean rows, records totals and moves to validated", async () => {
    const store = new FakeImportStore();
    const fixture = seedImportFixture(store);
    const importRunId = await stageAndValidate(
      store,
      fixture,
      [
        row(1, { sku: fixture.itemSku, currency: "NOK", gross_amount: "100.0000" }),
        row(2, { sku: fixture.secondItemSku, currency: "NOK", gross_amount: "40.5000" }),
      ],
      { rules: { expectedCurrency: "NOK", requireAmounts: true } },
    );

    const detail = await getImportRun(store, {
      organizationId: fixture.organizationId,
      importRunId,
    });
    expect(detail?.run.status).toBe("validated");
    expect(detail?.run.rowCounts).toMatchObject({ staged: 2, valid: 2, error: 0 });
    expect(detail?.run.diagnostics.totals).toEqual({ NOK: "140.5000" });
  });

  it("keeps invalid rows, marks an error_code and moves to needs_review (SALE-004)", async () => {
    const store = new FakeImportStore();
    const fixture = seedImportFixture(store);
    const importRunId = await stageAndValidate(
      store,
      fixture,
      [
        row(1, { sku: fixture.itemSku, currency: "NOK", gross_amount: "100.0000" }),
        row(2, {
          currency: "EUR",
          gross_amount: "not-a-number",
          occurred_at: "2025-12-31T00:00:00.000Z",
          location_external_id: "loc-unknown",
        }),
      ],
      {
        rules: {
          requiredNormalizedFields: ["sku"],
          expectedCurrency: "NOK",
          requireCurrency: true,
          requireOccurredAt: true,
          requireAmounts: true,
          allowedLocationExternalIds: ["loc-1"],
        },
      },
    );

    const detail = await getImportRun(store, {
      organizationId: fixture.organizationId,
      importRunId,
    });
    expect(detail?.run.status).toBe("needs_review");
    expect(detail?.rows).toHaveLength(2);
    expect(detail?.rows[1]).toMatchObject({ mappingState: "unmapped" });
    expect(detail?.rows[1]?.errorCode).not.toBeNull();
    const codes = (detail?.issues ?? []).map((issue) => issue.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "missing_field",
        "bad_period",
        "currency_mismatch",
        "unknown_location",
        "invalid_amount",
      ]),
    );
  });

  it("refuses to validate a run that is not parsed", async () => {
    const store = new FakeImportStore();
    const fixture = seedImportFixture(store);
    const importRunId = await openRun(store, fixture);

    await expect(
      validateImportRun(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        importRunId,
      }),
    ).rejects.toThrow(DomainError);
  });
});

describe("mapImportRows", () => {
  it("matches on SKU first and records the resolved internal id", async () => {
    const store = new FakeImportStore();
    const fixture = seedImportFixture(store);
    const importRunId = await stageAndValidate(store, fixture, [
      row(1, { sku: fixture.itemSku, external_id: "ext-tea" }),
    ]);

    const result = await mapImportRows(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      importRunId,
    });

    expect(result).toMatchObject({ status: "validated", mappedCount: 1 });
    expect(result.rows[0]).toMatchObject({
      outcome: "mapped",
      internalEntityId: fixture.itemId,
      match: "sku",
    });
    const detail = await getImportRun(store, {
      organizationId: fixture.organizationId,
      importRunId,
    });
    expect(detail?.rows[0]?.normalized).toMatchObject({
      mapped_internal_entity_id: fixture.itemId,
      mapping_match: "sku",
    });
  });

  it("falls back to the external mapping when no SKU is present", async () => {
    const store = new FakeImportStore();
    const fixture = seedImportFixture(store);
    const importRunId = await stageAndValidate(store, fixture, [
      row(1, { external_id: "ext-tea" }),
    ]);

    const result = await mapImportRows(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      importRunId,
    });

    expect(result.rows[0]).toMatchObject({
      outcome: "mapped",
      internalEntityId: fixture.secondItemId,
      match: "external_id",
    });
  });

  it("matches a catalogue SKU that has no external mapping yet", async () => {
    const store = new FakeImportStore();
    const fixture = seedImportFixture(store);
    const importRunId = await stageAndValidate(store, fixture, [
      row(1, { sku: fixture.catalogueSku }),
    ]);

    const result = await mapImportRows(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      importRunId,
    });

    expect(result.rows[0]).toMatchObject({
      outcome: "mapped",
      internalEntityId: fixture.catalogueItemId,
      match: "sku",
    });
  });

  it("leaves an unknown row unmapped and opens needs_review", async () => {
    const store = new FakeImportStore();
    const fixture = seedImportFixture(store);
    const importRunId = await stageAndValidate(store, fixture, [
      row(1, { external_id: "ext-missing" }),
    ]);

    const result = await mapImportRows(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      importRunId,
    });

    expect(result).toMatchObject({ status: "needs_review", unmappedCount: 1 });
    expect(result.rows[0]).toMatchObject({ outcome: "unmapped", reason: "external_id_not_found" });
  });

  it("flags one external id resolving to two internals and never remaps (DEC-033)", async () => {
    const store = new FakeImportStore();
    const fixture = fixtureWithConflict(store);
    const importRunId = await stageAndValidate(store, fixture, [
      row(1, { external_id: "ext-dup" }),
    ]);

    const result = await mapImportRows(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      importRunId,
    });

    expect(result).toMatchObject({ status: "needs_review", conflictCount: 1 });
    expect(result.rows[0]).toMatchObject({
      outcome: "conflict",
      kind: "external_id_to_many_internals",
    });
    const detail = await getImportRun(store, {
      organizationId: fixture.organizationId,
      importRunId,
    });
    expect(detail?.rows[0]).toMatchObject({
      mappingState: "conflict",
      errorCode: "mapping_conflict",
    });
    expect(detail?.rows[0]?.normalized).not.toHaveProperty("mapped_internal_entity_id");
    expect(detail?.conflicts).toHaveLength(1);
  });

  it("flags two external ids resolving to one internal (DEC-033)", async () => {
    const store = new FakeImportStore();
    const fixture = fixtureWithConflict(store);
    const importRunId = await stageAndValidate(store, fixture, [
      row(1, { external_id: "ext-split-1" }),
    ]);

    const result = await mapImportRows(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      importRunId,
    });

    expect(result.rows[0]).toMatchObject({
      outcome: "conflict",
      kind: "internal_to_many_externals",
    });
  });

  it("never remaps a row that already carries a disposition", async () => {
    const store = new FakeImportStore();
    const fixture = seedImportFixture(store);
    const importRunId = await stageAndValidate(store, fixture, [
      row(1, { external_id: "ext-tea" }),
    ]);
    const detail = await getImportRun(store, {
      organizationId: fixture.organizationId,
      importRunId,
    });
    const stagingRowId = detail!.rows[0]!.id;
    await disposeStagingRow(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      importRunId,
      stagingRowId,
      disposition: "ignored",
      reason: "duplicate of another source row",
    });

    const result = await mapImportRows(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      importRunId,
    });

    expect(result).toMatchObject({ skippedCount: 1, mappedCount: 0 });
    const after = await getImportRun(store, {
      organizationId: fixture.organizationId,
      importRunId,
    });
    expect(after?.rows[0]?.mappingState).toBe("ignored");
  });
});

describe("disposeStagingRow", () => {
  it("records an approved disposition in the table and on the row", async () => {
    const store = new FakeImportStore();
    const fixture = seedImportFixture(store);
    const importRunId = await stageAndValidate(store, fixture, [
      row(1, { external_id: "ext-missing" }),
    ]);
    const stagingRowId = (await getImportRun(store, {
      organizationId: fixture.organizationId,
      importRunId,
    }))!.rows[0]!.id;

    const result = await disposeStagingRow(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      importRunId,
      stagingRowId,
      disposition: "unmapped",
      reason: "not sold in this channel",
    });

    expect(result).toMatchObject({ disposition: "unmapped", mappingState: "unmapped" });
    const detail = await getImportRun(store, {
      organizationId: fixture.organizationId,
      importRunId,
    });
    expect(detail?.dispositions).toHaveLength(1);
    expect(detail?.dispositions[0]).toMatchObject({
      stagingRowId,
      disposition: "unmapped",
      actorId: fixture.actorId,
    });
  });

  it("refuses a second disposition for the same row, leaving exactly one (DEC-083)", async () => {
    const store = new FakeImportStore();
    const fixture = seedImportFixture(store);
    const importRunId = await stageAndValidate(store, fixture, [
      row(1, { external_id: "ext-missing" }),
    ]);
    const stagingRowId = (await getImportRun(store, {
      organizationId: fixture.organizationId,
      importRunId,
    }))!.rows[0]!.id;

    await disposeStagingRow(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      importRunId,
      stagingRowId,
      disposition: "unmapped",
      reason: "not sold in this channel",
    });

    await expect(
      disposeStagingRow(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        importRunId,
        stagingRowId,
        disposition: "ignored",
      }),
    ).rejects.toThrow(DomainError);

    const detail = await getImportRun(store, {
      organizationId: fixture.organizationId,
      importRunId,
    });
    expect(detail?.dispositions).toHaveLength(1);
    expect(detail?.dispositions[0]).toMatchObject({
      stagingRowId,
      disposition: "unmapped",
    });
  });

  it("requires a reason for a rejected disposition", async () => {
    const store = new FakeImportStore();
    const fixture = seedImportFixture(store);
    const importRunId = await stageAndValidate(store, fixture, [
      row(1, { external_id: "ext-tea" }),
    ]);
    const stagingRowId = (await getImportRun(store, {
      organizationId: fixture.organizationId,
      importRunId,
    }))!.rows[0]!.id;

    await expect(
      disposeStagingRow(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        importRunId,
        stagingRowId,
        disposition: "rejected",
      }),
    ).rejects.toThrow(DomainError);
  });

  it("refuses to disposition a row already linked to a posted sales line", async () => {
    const store = new FakeImportStore();
    const fixture = seedImportFixture(store);
    const importRunId = await stageAndValidate(store, fixture, [
      row(1, { external_id: "ext-tea" }),
    ]);
    const stagingRowId = (await getImportRun(store, {
      organizationId: fixture.organizationId,
      importRunId,
    }))!.rows[0]!.id;
    await store.updateImportStagingRow(stagingRowId, { linkedSalesLineId: "sales-line-1" });

    await expect(
      disposeStagingRow(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        importRunId,
        stagingRowId,
        disposition: "ignored",
      }),
    ).rejects.toThrow(DomainError);
  });
});

describe("import diagnostics keys (DEC-083 contract)", () => {
  it("no longer carries the removed dispositions key", () => {
    expect(Object.values(IMPORT_DIAGNOSTIC_KEYS)).not.toContain("dispositions");
  });
});

describe("previewImportRun", () => {
  it("cannot close while a non-posted row lacks a disposition (DEC-035)", async () => {
    const store = new FakeImportStore();
    const fixture = seedImportFixture(store);
    const importRunId = await stageAndValidate(
      store,
      fixture,
      [row(1, { external_id: "ext-tea", currency: "NOK", gross_amount: "100.0000" })],
      { rules: { expectedCurrency: "NOK" } },
    );

    const before = await previewImportRun(store, {
      organizationId: fixture.organizationId,
      importRunId,
    });
    expect(before.undecidedRowIds).toHaveLength(1);
    expect(before.canClose).toBe(false);
    expect(before.sourceTotals).toEqual({ NOK: "100.0000" });
    expect(before.postedTotals).toEqual({});

    await disposeStagingRow(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      importRunId,
      stagingRowId: before.undecidedRowIds[0]!,
      disposition: "unmapped",
      reason: "retained in the review queue",
    });

    const after = await previewImportRun(store, {
      organizationId: fixture.organizationId,
      importRunId,
    });
    expect(after.undecidedRowIds).toHaveLength(0);
    expect(after.canClose).toBe(true);
    expect(after.dispositionTotals).toEqual({ NOK: "100.0000" });
    expect(after.residualTotals).toEqual({ NOK: "0.0000" });
  });

  it("closes a fully mapped run and reports mapped counts", async () => {
    const store = new FakeImportStore();
    const fixture = seedImportFixture(store);
    const importRunId = await stageAndValidate(store, fixture, [
      row(1, { sku: fixture.itemSku, currency: "NOK", gross_amount: "60.0000" }),
      row(2, { sku: fixture.secondItemSku, currency: "NOK", gross_amount: "40.0000" }),
    ]);
    await mapImportRows(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      importRunId,
    });

    const preview = await previewImportRun(store, {
      organizationId: fixture.organizationId,
      importRunId,
    });
    expect(preview).toMatchObject({
      mappedCount: 2,
      unmappedCount: 0,
      rowCount: 2,
      canClose: true,
    });
    expect(preview.sourceTotals).toEqual({ NOK: "100.0000" });
    expect(preview.residualTotals).toEqual({ NOK: "100.0000" });
  });
});

describe("reads", () => {
  it("lists runs organization-scoped and newest first", async () => {
    const store = new FakeImportStore();
    const fixture = seedImportFixture(store);
    await openRun(store, fixture, { fileHash: "hash-a" });
    await openRun(store, fixture, { fileHash: "hash-b" });
    await openRun(store, fixture, {
      fileHash: "hash-c",
      organizationId: fixture.otherOrganizationId,
    });

    const mine = await listImportRuns(store, { organizationId: fixture.organizationId });
    const theirs = await listImportRuns(store, { organizationId: fixture.otherOrganizationId });

    expect(mine).toHaveLength(2);
    expect(theirs).toHaveLength(1);
    expect(mine[0]?.run.fileHash).toBe("hash-b");
  });

  it("returns undefined for another organization's run", async () => {
    const store = new FakeImportStore();
    const fixture = seedImportFixture(store);
    const importRunId = await openRun(store, fixture);
    expect(
      await getImportRun(store, {
        organizationId: fixture.otherOrganizationId,
        importRunId,
      }),
    ).toBeUndefined();
  });
});

describe("import profile resolution (DEC-081)", () => {
  async function seedProfile(
    store: FakeImportStore,
    fixture: ImportFixture,
    overrides: {
      readonly source?: string;
      readonly profileVersion?: string;
      readonly postingPolicy?: string;
      readonly validationRules?: Readonly<Record<string, unknown>>;
    } = {},
  ) {
    return store.createImportProfile({
      organizationId: fixture.organizationId,
      source: overrides.source ?? fixture.source,
      profileVersion: overrides.profileVersion ?? "v2",
      postingPolicy: overrides.postingPolicy ?? "allow_partial",
      validationRules: overrides.validationRules ?? {},
      createdBy: fixture.actorId,
    });
  }

  it("resolves the profile's id, version and posting policy when the caller omits them", async () => {
    const store = new FakeImportStore();
    const fixture = seedImportFixture(store);
    const profile = await seedProfile(store, fixture, {
      profileVersion: "v2",
      postingPolicy: "all_or_nothing",
    });

    const result = await createImportRun(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      source: fixture.source,
      fileHash: "hash-profile-1",
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });

    const detail = await getImportRun(store, {
      organizationId: fixture.organizationId,
      importRunId: result.importRunId,
    });
    expect(detail?.run).toMatchObject({ profileVersion: "v2", importProfileId: profile.id });
    expect(detail?.run.diagnostics).toMatchObject({ posting_policy: "all_or_nothing" });
  });

  it("stores a padded source and profileVersion trimmed", async () => {
    const store = new FakeImportStore();
    const fixture = seedImportFixture(store);
    const profile = await seedProfile(store, fixture, {
      source: `  ${fixture.source}  `,
      profileVersion: "  v9  ",
    });

    expect(profile.source).toBe(fixture.source);
    expect(profile.profileVersion).toBe("v9");
  });

  it("resolves a profile stored with a padded source and tolerates a padded caller version", async () => {
    const store = new FakeImportStore();
    const fixture = seedImportFixture(store);
    const profile = await seedProfile(store, fixture, {
      source: ` zettle `,
      profileVersion: "  v2  ",
      postingPolicy: "all_or_nothing",
    });

    const result = await createImportRun(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      source: "zettle",
      fileHash: "hash-padded-source",
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      profileVersion: "  v2  ",
    });

    const detail = await getImportRun(store, {
      organizationId: fixture.organizationId,
      importRunId: result.importRunId,
    });
    expect(detail?.run).toMatchObject({ importProfileId: profile.id, profileVersion: "v2" });
    expect(detail?.run.diagnostics).toMatchObject({ posting_policy: "all_or_nothing" });
  });

  it("does not raise when a padded caller posting policy matches the profile's", async () => {
    const store = new FakeImportStore();
    const fixture = seedImportFixture(store);
    await seedProfile(store, fixture, { profileVersion: "v2", postingPolicy: "all_or_nothing" });

    const result = await createImportRun(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      source: fixture.source,
      fileHash: "hash-padded-policy",
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      postingPolicy: "  all_or_nothing  ",
    });

    const detail = await getImportRun(store, {
      organizationId: fixture.organizationId,
      importRunId: result.importRunId,
    });
    expect(detail?.run.diagnostics).toMatchObject({ posting_policy: "all_or_nothing" });
  });

  it("stores a padded posting policy trimmed when the source has no profile", async () => {
    const store = new FakeImportStore();
    const fixture = seedImportFixture(store);

    const result = await createImportRun(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      source: fixture.source,
      profileVersion: "profile-v1",
      fileHash: "hash-padded-policy-no-profile",
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      postingPolicy: "  all_or_nothing  ",
    });

    const detail = await getImportRun(store, {
      organizationId: fixture.organizationId,
      importRunId: result.importRunId,
    });
    expect(detail?.run.diagnostics).toMatchObject({ posting_policy: "all_or_nothing" });
  });

  it("rejects a caller posting policy or profile version that conflicts with the profile", async () => {
    const store = new FakeImportStore();
    const fixture = seedImportFixture(store);
    await seedProfile(store, fixture, { profileVersion: "v2", postingPolicy: "all_or_nothing" });

    await expect(
      createImportRun(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        source: fixture.source,
        fileHash: "hash-conflict-policy",
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
        postingPolicy: "allow_partial",
      }),
    ).rejects.toThrow(/postingPolicy .* conflicts/i);

    await expect(
      createImportRun(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        source: fixture.source,
        fileHash: "hash-conflict-version",
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
        profileVersion: "v1",
      }),
    ).rejects.toThrow(/profileVersion .* conflicts/i);
    expect(store.importRuns.size).toBe(0);
  });

  it("requires a non-blank profileVersion when the source has no profile", async () => {
    const store = new FakeImportStore();
    const fixture = seedImportFixture(store);

    await expect(
      createImportRun(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        source: fixture.source,
        fileHash: "hash-no-profile-1",
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
      }),
    ).rejects.toThrow(DomainError);
    await expect(
      createImportRun(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        source: fixture.source,
        profileVersion: "   ",
        fileHash: "hash-no-profile-2",
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
      }),
    ).rejects.toThrow(DomainError);
    expect(store.importRuns.size).toBe(0);
  });

  it("applies the profile's rules to a run the caller validates with no rules", async () => {
    const store = new FakeImportStore();
    const fixture = seedImportFixture(store);
    await seedProfile(store, fixture, {
      validationRules: { expectedCurrency: "NOK", requireCurrency: true },
    });
    const result = await createImportRun(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      source: fixture.source,
      fileHash: "hash-profile-rules",
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });
    await stageImportRows(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      importRunId: result.importRunId,
      rows: [row(1, { sku: fixture.itemSku })],
    });

    const validated = await validateImportRun(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      importRunId: result.importRunId,
    });
    expect(validated.status).toBe("needs_review");
    expect(validated.issues.map((issue) => issue.code)).toContain("missing_currency");
  });

  it("lets an explicit caller rule override the profile field-by-field", async () => {
    const store = new FakeImportStore();
    const fixture = seedImportFixture(store);
    await seedProfile(store, fixture, {
      validationRules: { expectedCurrency: "NOK", requireCurrency: true },
    });
    const result = await createImportRun(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      source: fixture.source,
      fileHash: "hash-profile-override",
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });
    await stageImportRows(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      importRunId: result.importRunId,
      rows: [row(1, { sku: fixture.itemSku })],
    });

    const validated = await validateImportRun(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      importRunId: result.importRunId,
      rules: { requireCurrency: false },
    });
    expect(validated.issues.map((issue) => issue.code)).not.toContain("missing_currency");
    expect(validated.status).toBe("validated");
  });

  it("fails closed on a malformed stored validation_rules", async () => {
    const store = new FakeImportStore();
    const fixture = seedImportFixture(store);
    await seedProfile(store, fixture, { validationRules: { requireAmounts: "yes" } });
    const result = await createImportRun(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      source: fixture.source,
      fileHash: "hash-profile-malformed",
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });
    await stageImportRows(store, {
      organizationId: fixture.organizationId,
      actorId: fixture.actorId,
      importRunId: result.importRunId,
      rows: [row(1, { sku: fixture.itemSku })],
    });

    await expect(
      validateImportRun(store, {
        organizationId: fixture.organizationId,
        actorId: fixture.actorId,
        importRunId: result.importRunId,
      }),
    ).rejects.toThrow(DomainError);
  });
});
