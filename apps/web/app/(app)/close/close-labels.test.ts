import { describe, expect, it } from "vitest";

import {
  CLOSE_SCOPE_LABELS,
  CLOSE_STATUS_VIEW,
  closeScopeLabel,
  closeStatusView,
  formatCloseInstant,
  formatClosePeriod,
} from "./close-labels";

describe("closeStatusView", () => {
  it("labels every period_close_status", () => {
    expect(CLOSE_STATUS_VIEW).toEqual({
      open: { tone: "info", label: "Open" },
      closing: { tone: "warning", label: "Closing" },
      locked: { tone: "success", label: "Locked" },
      reopened: { tone: "warning", label: "Reopened" },
    });
  });

  it("falls back to the raw status for an unknown value", () => {
    expect(closeStatusView("bogus")).toEqual({ tone: "info", label: "bogus" });
  });
});

describe("closeScopeLabel", () => {
  it("labels both scopes and falls back to the raw value", () => {
    expect(CLOSE_SCOPE_LABELS).toEqual({ location: "Location", company: "Company" });
    expect(closeScopeLabel("location")).toBe("Location");
    expect(closeScopeLabel("company")).toBe("Company");
    expect(closeScopeLabel("bogus")).toBe("bogus");
  });
});

describe("formatClosePeriod", () => {
  it("shows a single day when start equals end", () => {
    expect(formatClosePeriod("2026-09-23", "2026-09-23")).toBe("2026-09-23");
  });

  it("shows the inclusive range for a company month", () => {
    expect(formatClosePeriod("2026-09-01", "2026-09-30")).toBe("2026-09-01 → 2026-09-30");
  });
});

describe("formatCloseInstant", () => {
  it("formats an ISO instant as UTC to the minute", () => {
    expect(formatCloseInstant("2026-09-23T13:57:07.123Z")).toBe("2026-09-23 13:57 UTC");
  });
});
