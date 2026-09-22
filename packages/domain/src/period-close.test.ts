import { describe, expect, it } from "vitest";

import { DomainError } from "./errors";
import {
  CLOSE_IMPORT_STATUSES,
  PERIOD_CLOSE_SCOPE_TYPES,
  PERIOD_CLOSE_SNAPSHOT_VERSION,
  PERIOD_CLOSE_STATUSES,
  assertCloseChecklist,
  buildClosePrerequisites,
  buildCloseSnapshot,
  resolveClosePeriod,
} from "./period-close";
import { IMPORT_RUN_STATUSES } from "./sales-mapping";

describe("period-close vocabularies", () => {
  it("mirrors the period_close_scope_type and period_close_status arrays", () => {
    expect(PERIOD_CLOSE_SCOPE_TYPES).toEqual(["location", "company"]);
    expect(PERIOD_CLOSE_STATUSES).toEqual(["open", "closing", "locked", "reopened"]);
  });

  it("reuses the domain import-run status vocabulary (no second literal copy)", () => {
    expect(CLOSE_IMPORT_STATUSES).toBe(IMPORT_RUN_STATUSES);
  });

  it("bumps the stored snapshot shape to version 2", () => {
    expect(PERIOD_CLOSE_SNAPSHOT_VERSION).toBe(2);
  });
});

describe("resolveClosePeriod", () => {
  it("resolves a location scope to a single day", () => {
    expect(resolveClosePeriod("location", "2026-03-05")).toEqual({
      periodStart: "2026-03-05",
      periodEnd: "2026-03-05",
    });
  });

  it("resolves a company scope to its UTC calendar month", () => {
    expect(resolveClosePeriod("company", "2026-03-01")).toEqual({
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
    });
  });

  it("resolves a February company scope to the 28th or 29th", () => {
    expect(resolveClosePeriod("company", "2026-02-01")).toEqual({
      periodStart: "2026-02-01",
      periodEnd: "2026-02-28",
    });
    expect(resolveClosePeriod("company", "2028-02-01")).toEqual({
      periodStart: "2028-02-01",
      periodEnd: "2028-02-29",
    });
  });

  it("resolves a 31-day company month to the 31st", () => {
    expect(resolveClosePeriod("company", "2026-12-01").periodEnd).toBe("2026-12-31");
  });

  it.each(["organization", "storage", "company_wide", ""])(
    "rejects the unknown scope %j",
    (scopeType) => {
      expect(() => resolveClosePeriod(scopeType, "2026-03-01")).toThrow(DomainError);
    },
  );

  it.each(["2026-3-1", "2026-13-01", "2026-02-31", "2026-03-01T00:00:00Z", "not-a-date"])(
    "rejects the malformed periodStart %j",
    (periodStart) => {
      expect(() => resolveClosePeriod("location", periodStart)).toThrow(DomainError);
    },
  );

  it("rejects a company start that is not a month's first day", () => {
    expect(() => resolveClosePeriod("company", "2026-03-02")).toThrow(DomainError);
    expect(() => resolveClosePeriod("company", "2026-03-15")).toThrow(DomainError);
  });
});

describe("assertCloseChecklist", () => {
  it("accepts an empty checklist", () => {
    expect(assertCloseChecklist([])).toEqual([]);
  });

  it("accepts well-formed items and preserves extra keys", () => {
    const result = assertCloseChecklist([
      { key: "cash_counted", label: "Count the till", done: true, note: "ok" },
    ]);

    expect(result).toEqual([
      { key: "cash_counted", label: "Count the till", done: true, note: "ok" },
    ]);
  });

  it.each([undefined, null, "nope", {}, 42])("rejects the non-array %j", (value) => {
    expect(() => assertCloseChecklist(value)).toThrow(DomainError);
  });

  it.each([
    [["nope"]],
    [[null]],
    [[{ key: "", label: "x", done: true }]],
    [[{ key: "   ", label: "x", done: true }]],
    [[{ key: "k", label: "", done: true }]],
    [[{ key: "k", label: "x", done: "yes" }]],
    [[{ key: "k", label: "x" }]],
    [[{ label: "x", done: true }]],
  ])("rejects the malformed checklist %j", (value) => {
    expect(() => assertCloseChecklist(value)).toThrow(DomainError);
  });
});

describe("buildClosePrerequisites", () => {
  function build(
    overrides: Partial<Parameters<typeof buildClosePrerequisites>[0]> = {},
  ): ReturnType<typeof buildClosePrerequisites> {
    return buildClosePrerequisites({
      reconciliationStatuses: [],
      importRunStatuses: [],
      openExceptions: 0,
      tolerances: { sales_settlement: false, supplier_invoice: false },
      scopeLimited: false,
      ...overrides,
    });
  }

  it("zero-fills the status histograms and passes the informational reads through", () => {
    const prerequisites = build({
      openExceptions: 3,
      tolerances: { sales_settlement: true, supplier_invoice: false },
      scopeLimited: true,
    });

    expect(prerequisites.reconciliations).toEqual({
      total: 0,
      byStatus: {
        pending: 0,
        within_tolerance: 0,
        exception: 0,
        resolved: 0,
        approved: 0,
      },
      blocking: 0,
    });
    expect(prerequisites.importRuns).toEqual({
      total: 0,
      byStatus: {
        uploaded: 0,
        parsed: 0,
        needs_review: 0,
        validated: 0,
        posted: 0,
        partially_posted: 0,
        failed: 0,
        superseded: 0,
      },
      blocking: 0,
    });
    expect(prerequisites.exceptions).toEqual({ open: 3 });
    expect(prerequisites.tolerances).toEqual({
      sales_settlement: true,
      supplier_invoice: false,
    });
    expect(prerequisites.scopeLimited).toBe(true);
  });

  it("counts pending and exception reconciliations as blocking only", () => {
    const prerequisites = build({
      reconciliationStatuses: [
        "pending",
        "pending",
        "exception",
        "within_tolerance",
        "resolved",
        "approved",
      ],
    });

    expect(prerequisites.reconciliations.total).toBe(6);
    expect(prerequisites.reconciliations.blocking).toBe(3);
    expect(prerequisites.reconciliations.byStatus).toMatchObject({
      pending: 2,
      within_tolerance: 1,
      exception: 1,
      resolved: 1,
      approved: 1,
    });
  });

  it("blocks every import run not yet fully posted", () => {
    const prerequisites = build({
      importRunStatuses: [
        "uploaded",
        "parsed",
        "needs_review",
        "validated",
        "partially_posted",
        "posted",
        "failed",
        "superseded",
      ],
    });

    expect(prerequisites.importRuns.total).toBe(8);
    expect(prerequisites.importRuns.blocking).toBe(5);
    expect(prerequisites.importRuns.byStatus).toMatchObject({
      uploaded: 1,
      parsed: 1,
      needs_review: 1,
      validated: 1,
      partially_posted: 1,
      posted: 1,
      failed: 1,
      superseded: 1,
    });
  });

  it("rejects a status outside the mirrored vocabulary (fail-closed)", () => {
    expect(() => build({ reconciliationStatuses: ["bogus"] })).toThrow(DomainError);
    expect(() => build({ importRunStatuses: ["bogus"] })).toThrow(DomainError);
  });
});

describe("buildCloseSnapshot", () => {
  it("builds a versioned, float-free snapshot with the prerequisite block", () => {
    const snapshot = buildCloseSnapshot({
      scopeType: "location",
      scopeId: "loc-1",
      periodStart: "2026-03-05",
      periodEnd: "2026-03-05",
      capturedAt: "2026-03-05T22:00:00.000Z",
      checklist: [{ key: "cash_counted", label: "Count the till", done: false }],
      prerequisites: buildClosePrerequisites({
        reconciliationStatuses: ["approved"],
        importRunStatuses: ["posted"],
        openExceptions: 1,
        tolerances: { sales_settlement: true, supplier_invoice: true },
        scopeLimited: true,
      }),
    });

    expect(snapshot).toEqual({
      schemaVersion: PERIOD_CLOSE_SNAPSHOT_VERSION,
      scopeType: "location",
      scopeId: "loc-1",
      periodStart: "2026-03-05",
      periodEnd: "2026-03-05",
      capturedAt: "2026-03-05T22:00:00.000Z",
      checklist: [{ key: "cash_counted", label: "Count the till", done: false }],
      prerequisites: {
        reconciliations: {
          total: 1,
          byStatus: {
            pending: 0,
            within_tolerance: 0,
            exception: 0,
            resolved: 0,
            approved: 1,
          },
          blocking: 0,
        },
        importRuns: {
          total: 1,
          byStatus: {
            uploaded: 0,
            parsed: 0,
            needs_review: 0,
            validated: 0,
            posted: 1,
            partially_posted: 0,
            failed: 0,
            superseded: 0,
          },
          blocking: 0,
        },
        exceptions: { open: 1 },
        tolerances: { sales_settlement: true, supplier_invoice: true },
        scopeLimited: true,
      },
    });
  });
});
