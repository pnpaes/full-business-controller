import { describe, expect, it } from "vitest";

import { DomainError } from "./errors";
import {
  PERIOD_CLOSE_SCOPE_TYPES,
  PERIOD_CLOSE_SNAPSHOT_VERSION,
  PERIOD_CLOSE_STATUSES,
  assertCloseChecklist,
  buildCloseSnapshot,
  resolveClosePeriod,
} from "./period-close";

describe("period-close vocabularies", () => {
  it("mirrors the period_close_scope_type and period_close_status arrays", () => {
    expect(PERIOD_CLOSE_SCOPE_TYPES).toEqual(["location", "company"]);
    expect(PERIOD_CLOSE_STATUSES).toEqual(["open", "closing", "locked", "reopened"]);
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

describe("buildCloseSnapshot", () => {
  it("builds a versioned, float-free snapshot", () => {
    const snapshot = buildCloseSnapshot({
      scopeType: "location",
      scopeId: "loc-1",
      periodStart: "2026-03-05",
      periodEnd: "2026-03-05",
      capturedAt: "2026-03-05T22:00:00.000Z",
      checklist: [{ key: "cash_counted", label: "Count the till", done: false }],
    });

    expect(snapshot).toEqual({
      schemaVersion: PERIOD_CLOSE_SNAPSHOT_VERSION,
      scopeType: "location",
      scopeId: "loc-1",
      periodStart: "2026-03-05",
      periodEnd: "2026-03-05",
      capturedAt: "2026-03-05T22:00:00.000Z",
      checklist: [{ key: "cash_counted", label: "Count the till", done: false }],
    });
  });
});
