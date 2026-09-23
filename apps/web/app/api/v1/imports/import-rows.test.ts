import type {
  ImportRunPreview,
  ImportRunRecord,
  ImportRunSummary,
  ImportStagingRowRecord,
} from "@aquarela/application";
import { describe, expect, it } from "vitest";

import {
  normalizedSummary,
  parseCreateImportRunBody,
  parseDisposeStagingRowBody,
  parseImportRunListQuery,
  parseMapImportRowsBody,
  parseStageRowsBody,
  parseValidateImportRunBody,
  toImportRunRows,
  toPreviewJson,
  toStagingRowRows,
} from "./import-rows";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const RUN = "11111111-1111-4111-8111-111111111111";
const ROW = "22222222-2222-4222-8222-222222222222";

function runRecord(
  overrides: Partial<Omit<ImportRunRecord, "importProfileId">> = {},
): ImportRunRecord {
  return {
    id: RUN,
    organizationId: ORG,
    source: "zettle-legacy",
    importProfileId: null,
    profileVersion: "i19-v1",
    fileObjectId: null,
    fileHash: "hash-1",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    status: "needs_review",
    rowCounts: { staged: 4, valid: 4, error: 0, mapped: 3, unmapped: 1 },
    diagnostics: {},
    createdAt: "2026-09-01T10:00:00.000Z",
    createdBy: "actor-1",
    ...overrides,
  };
}

function summary(overrides: Partial<ImportRunRecord> = {}): ImportRunSummary {
  return {
    run: runRecord(overrides),
    stagedCount: 4,
    mappedCount: 3,
    unmappedCount: 1,
    errorCount: 0,
    dispositionCount: 1,
  };
}

function stagingRow(overrides: Partial<ImportStagingRowRecord> = {}): ImportStagingRowRecord {
  return {
    id: ROW,
    importRunId: RUN,
    sourceRowNo: 2,
    raw: {},
    normalized: {},
    mappingState: "mapped",
    errorCode: null,
    linkedSalesLineId: null,
    ...overrides,
  };
}

describe("parseImportRunListQuery", () => {
  it("defaults paging and accepts a source and status filter", () => {
    expect(parseImportRunListQuery(new URLSearchParams())).toEqual({
      ok: true,
      query: { limit: 50, offset: 0 },
    });
    expect(
      parseImportRunListQuery(new URLSearchParams({ source: "zettle", status: "needs_review" })),
    ).toEqual({
      ok: true,
      query: { source: "zettle", status: "needs_review", limit: 50, offset: 0 },
    });
  });

  it("rejects an unknown status and out-of-range paging", () => {
    expect(parseImportRunListQuery(new URLSearchParams({ status: "paused" })).ok).toBe(false);
    expect(parseImportRunListQuery(new URLSearchParams({ limit: "0" })).ok).toBe(false);
    expect(parseImportRunListQuery(new URLSearchParams({ limit: "201" })).ok).toBe(false);
    expect(parseImportRunListQuery(new URLSearchParams({ offset: "-1" })).ok).toBe(false);
  });
});

describe("parseCreateImportRunBody", () => {
  const valid = {
    source: "zettle-legacy",
    profileVersion: "i19-v1",
    fileHash: "hash-1",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
  };

  it("defaults the optional file id and posting policy to null", () => {
    expect(parseCreateImportRunBody(valid)).toEqual({
      ok: true,
      input: {
        source: "zettle-legacy",
        profileVersion: "i19-v1",
        fileHash: "hash-1",
        periodStart: "2026-08-01",
        periodEnd: "2026-08-31",
        fileObjectId: null,
        postingPolicy: null,
      },
    });
  });

  it("keeps a caller profile version but defaults an absent or blank one to null", () => {
    const present = parseCreateImportRunBody(valid);
    expect(present.ok).toBe(true);
    if (present.ok) {
      expect(present.input.profileVersion).toBe("i19-v1");
    }

    expect(
      parseCreateImportRunBody({
        source: "zettle-legacy",
        fileHash: "hash-1",
        periodStart: "2026-08-01",
        periodEnd: "2026-08-31",
      }),
    ).toEqual({
      ok: true,
      input: {
        source: "zettle-legacy",
        profileVersion: null,
        fileHash: "hash-1",
        periodStart: "2026-08-01",
        periodEnd: "2026-08-31",
        fileObjectId: null,
        postingPolicy: null,
      },
    });
    const blank = parseCreateImportRunBody({ ...valid, profileVersion: "   " });
    expect(blank.ok).toBe(true);
    if (blank.ok) {
      expect(blank.input.profileVersion).toBeNull();
    }
  });

  it("rejects a non-string or over-long profile version", () => {
    expect(parseCreateImportRunBody({ ...valid, profileVersion: 4 }).ok).toBe(false);
    expect(parseCreateImportRunBody({ ...valid, profileVersion: "v".repeat(201) }).ok).toBe(false);
  });

  it("accepts a uuid file id and a known posting policy", () => {
    const parsed = parseCreateImportRunBody({
      ...valid,
      fileObjectId: ROW,
      postingPolicy: "all_or_nothing",
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.input.fileObjectId).toBe(ROW);
      expect(parsed.input.postingPolicy).toBe("all_or_nothing");
    }
  });

  it("rejects a missing source, a reversed period, a bad date and an unknown policy", () => {
    expect(parseCreateImportRunBody({ ...valid, source: "" }).ok).toBe(false);
    expect(
      parseCreateImportRunBody({ ...valid, periodStart: "2026-09-01", periodEnd: "2026-08-31" }).ok,
    ).toBe(false);
    expect(parseCreateImportRunBody({ ...valid, periodEnd: "2026-08" }).ok).toBe(false);
    expect(parseCreateImportRunBody({ ...valid, postingPolicy: "whatever" }).ok).toBe(false);
    expect(parseCreateImportRunBody(undefined).ok).toBe(false);
  });
});

describe("parseStageRowsBody", () => {
  it("accepts well-formed rows", () => {
    const parsed = parseStageRowsBody({
      rows: [
        { sourceRowNo: 1, raw: { a: 1 }, normalized: { b: 2 } },
        { sourceRowNo: 2, raw: {}, normalized: {} },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.rows).toHaveLength(2);
      expect(parsed.rows[0]).toEqual({ sourceRowNo: 1, raw: { a: 1 }, normalized: { b: 2 } });
    }
  });

  it("rejects an empty batch, a non-object row and a bad row number", () => {
    expect(parseStageRowsBody({ rows: [] }).ok).toBe(false);
    expect(parseStageRowsBody({ rows: ["x"] }).ok).toBe(false);
    expect(parseStageRowsBody({ rows: [{ sourceRowNo: 0, raw: {}, normalized: {} }] }).ok).toBe(
      false,
    );
    expect(parseStageRowsBody({ rows: [{ sourceRowNo: 1, raw: [], normalized: {} }] }).ok).toBe(
      false,
    );
    expect(parseStageRowsBody(undefined).ok).toBe(false);
  });
});

describe("parseValidateImportRunBody", () => {
  it("treats an absent body as no extra rules", () => {
    expect(parseValidateImportRunBody(undefined)).toEqual({ ok: true, rules: {} });
    expect(parseValidateImportRunBody({})).toEqual({ ok: true, rules: {} });
  });

  it("accepts the caller-supplied rules and rejects a malformed one", () => {
    const parsed = parseValidateImportRunBody({
      requiredNormalizedFields: ["occurred_at"],
      expectedCurrency: "NOK",
      requireCurrency: true,
      allowedLocationExternalIds: ["Aquarela Kongens Gate"],
      requireAmounts: true,
    });
    expect(parsed).toEqual({
      ok: true,
      rules: {
        requiredNormalizedFields: ["occurred_at"],
        expectedCurrency: "NOK",
        requireCurrency: true,
        allowedLocationExternalIds: ["Aquarela Kongens Gate"],
        requireAmounts: true,
      },
    });
    expect(parseValidateImportRunBody({ requireCurrency: "yes" }).ok).toBe(false);
    expect(parseValidateImportRunBody({ requiredNormalizedFields: [1] }).ok).toBe(false);
    expect(parseValidateImportRunBody({ expectedCurrency: "N" }).ok).toBe(true);
  });
});

describe("parseMapImportRowsBody", () => {
  it("treats an absent body as no narrowing", () => {
    expect(parseMapImportRowsBody(undefined)).toEqual({
      ok: true,
      input: { sourceSystem: null, entityType: null, internalEntityType: null },
    });
  });

  it("accepts source and entity type and rejects a non-string", () => {
    expect(parseMapImportRowsBody({ sourceSystem: "zettle", entityType: "item" })).toEqual({
      ok: true,
      input: { sourceSystem: "zettle", entityType: "item", internalEntityType: null },
    });
    expect(parseMapImportRowsBody({ sourceSystem: 4 }).ok).toBe(false);
  });

  it("defaults internalEntityType to null when absent and passes a present value (DEC-113)", () => {
    expect(parseMapImportRowsBody({ sourceSystem: "zettle" })).toEqual({
      ok: true,
      input: { sourceSystem: "zettle", entityType: null, internalEntityType: null },
    });
    expect(parseMapImportRowsBody({ internalEntityType: "product_variant" })).toEqual({
      ok: true,
      input: { sourceSystem: null, entityType: null, internalEntityType: "product_variant" },
    });
  });

  it("rejects a malformed internalEntityType", () => {
    expect(parseMapImportRowsBody({ internalEntityType: 4 }).ok).toBe(false);
    expect(parseMapImportRowsBody({ internalEntityType: "x".repeat(201) }).ok).toBe(false);
  });
});

describe("parseDisposeStagingRowBody", () => {
  it("accepts an approved disposition and defaults the reason", () => {
    expect(parseDisposeStagingRowBody({ stagingRowId: ROW, disposition: "unmapped" })).toEqual({
      ok: true,
      input: { stagingRowId: ROW, disposition: "unmapped", reason: null },
    });
  });

  it("requires a reason for a rejected disposition", () => {
    expect(parseDisposeStagingRowBody({ stagingRowId: ROW, disposition: "rejected" }).ok).toBe(
      false,
    );
    expect(
      parseDisposeStagingRowBody({
        stagingRowId: ROW,
        disposition: "rejected",
        reason: "not a real product",
      }).ok,
    ).toBe(true);
  });

  it("rejects a malformed row id and an unknown disposition", () => {
    expect(parseDisposeStagingRowBody({ stagingRowId: "nope", disposition: "ignored" }).ok).toBe(
      false,
    );
    expect(parseDisposeStagingRowBody({ stagingRowId: ROW, disposition: "deleted" }).ok).toBe(
      false,
    );
    expect(parseDisposeStagingRowBody(undefined).ok).toBe(false);
  });
});

describe("toImportRunRows", () => {
  it("maps the run counts and drops a foreign run", () => {
    const rows = toImportRunRows(ORG, [
      summary(),
      summary({ id: "foreign", organizationId: OTHER }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: RUN,
      source: "zettle-legacy",
      status: "needs_review",
      stagedCount: 4,
      mappedCount: 3,
      unmappedCount: 1,
      errorCount: 0,
      dispositionCount: 1,
      fileHash: "hash-1",
    });
  });
});

describe("normalizedSummary", () => {
  it("builds a compact summary from the profile keys", () => {
    expect(
      normalizedSummary({
        product: "Demo Espresso Beans",
        variant: "250g",
        quantity: "2",
        gross_amount: "248.0000",
        currency: "NOK",
        occurred_at: "2026-08-01T12:16:30.000Z",
        location_external_id: "Aquarela Kongens Gate",
      }),
    ).toBe("Demo Espresso Beans · 250g · × 2 · 248.0000 NOK · 2026-08-01 · Aquarela Kongens Gate");
  });

  it("falls back to sku/external id and ignores unknown keys", () => {
    expect(normalizedSummary({ external_id: "Legacy widget", notes: "ignored" })).toBe(
      "Legacy widget",
    );
    expect(normalizedSummary({})).toBe("—");
  });
});

describe("toStagingRowRows", () => {
  it("maps the row state and flags a posted row", () => {
    const rows = toStagingRowRows([
      stagingRow({ normalized: { sku: "DEMO-SKU-ESPRESSO", gross_amount: "129.0000" } }),
      stagingRow({ id: "row-2", sourceRowNo: 3, linkedSalesLineId: "line-1" }),
    ]);
    expect(rows[0]).toMatchObject({
      sourceRowNo: 2,
      mappingState: "mapped",
      errorCode: null,
      posted: false,
      summary: "DEMO-SKU-ESPRESSO · 129.0000",
    });
    expect(rows[1]).toMatchObject({ posted: true, summary: "—" });
  });
});

describe("toPreviewJson", () => {
  it("counts the undecided rows and passes the totals through", () => {
    const preview: ImportRunPreview = {
      importRunId: RUN,
      status: "needs_review",
      rowCount: 4,
      mappedCount: 3,
      unmappedCount: 1,
      ignoredCount: 0,
      erroredCount: 0,
      conflictCount: 0,
      undecidedRowIds: [ROW],
      sourceTotals: { NOK: "555.0000" },
      postedTotals: {},
      dispositionTotals: { NOK: "49.0000" },
      residualTotals: { NOK: "506.0000" },
      canClose: false,
    };
    expect(toPreviewJson(preview)).toMatchObject({
      undecidedCount: 1,
      postedTotals: {},
      residualTotals: { NOK: "506.0000" },
      canClose: false,
    });
  });
});
