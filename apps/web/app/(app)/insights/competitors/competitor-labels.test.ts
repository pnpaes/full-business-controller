import { describe, expect, it } from "vitest";

import {
  comparisonReasonLabel,
  dayStartInstant,
  formatDay,
  formatInstantUTC,
  reviewStatusView,
  statusFilterLabel,
} from "./competitor-labels";

describe("competitor labels", () => {
  it("styles pending as a warning that is not intelligence", () => {
    const pending = reviewStatusView("pending");
    expect(pending.tone).toBe("warning");
    expect(pending.description).toContain("not intelligence");
  });

  it("falls back safely for an unknown status", () => {
    expect(reviewStatusView("bogus")).toMatchObject({ label: "bogus", tone: "info" });
    expect(comparisonReasonLabel("no_item")).toContain("No comparable item");
    expect(comparisonReasonLabel("something_new")).toBe("something_new");
  });

  it("labels the all filter and formats dates", () => {
    expect(statusFilterLabel("all")).toBe("All");
    expect(statusFilterLabel("reviewed")).toBe("Reviewed");
    expect(formatDay("2026-03-05T09:30:00.000Z")).toBe("2026-03-05");
    expect(formatInstantUTC("2026-03-05T09:30:00.000Z")).toBe("2026-03-05 09:30 UTC");
    expect(dayStartInstant("2026-03-05")).toBe("2026-03-05T00:00:00.000Z");
  });
});
