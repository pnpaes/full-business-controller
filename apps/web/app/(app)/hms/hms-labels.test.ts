import { describe, expect, it } from "vitest";

import {
  checkFrequencyLabel,
  checklistOutcomeView,
  checklistRunStatusView,
  correctiveActionStatusView,
  formatAge,
  frequencyWindowHours,
  incidentSeverityView,
  incidentStatusView,
  parseChecklistItems,
  parseChecklistResults,
} from "./hms-labels";

describe("hms-labels", () => {
  it("maps the recorded vocabularies to labels and tones", () => {
    expect(incidentStatusView("open")).toEqual({ tone: "danger", label: "Open" });
    expect(incidentSeverityView("critical").tone).toBe("danger");
    expect(correctiveActionStatusView("verified")).toEqual({
      tone: "success",
      label: "Verified",
    });
    expect(checklistRunStatusView("completed").tone).toBe("success");
    expect(checklistOutcomeView("fail").tone).toBe("danger");
    expect(checkFrequencyLabel("twice_daily")).toBe("Twice daily");
  });

  it("falls back to the raw code for an unknown value", () => {
    expect(incidentStatusView("future_status")).toEqual({
      tone: "info",
      label: "future_status",
    });
    expect(checkFrequencyLabel("hourly")).toBe("hourly");
  });

  it("maps each cadence to its freshness window and leaves `other` open", () => {
    expect(frequencyWindowHours("twice_daily")).toBe(12);
    expect(frequencyWindowHours("daily")).toBe(24);
    expect(frequencyWindowHours("weekly")).toBe(168);
    expect(frequencyWindowHours("monthly")).toBe(744);
    expect(frequencyWindowHours("other")).toBeNull();
  });

  it("formats a coarse age", () => {
    const now = Date.parse("2026-09-23T12:00:00Z");
    expect(formatAge("2026-09-23T11:30:00Z", now)).toBe("30 min ago");
    expect(formatAge("2026-09-23T09:00:00Z", now)).toBe("3 h ago");
    expect(formatAge("2026-09-20T12:00:00Z", now)).toBe("3 d ago");
  });

  it("parses checklist items and skips malformed elements", () => {
    expect(
      parseChecklistItems([
        { key: "temp", label: "Fridge at ≤ 5 °C", required: true },
        { key: "", label: "blank key" },
        { key: "nolabel" },
        "junk",
        null,
      ]),
    ).toEqual([{ key: "temp", label: "Fridge at ≤ 5 °C", required: true }]);
    expect(parseChecklistItems("not an array")).toEqual([]);
  });

  it("parses checklist results and keeps only well-shaped notes", () => {
    expect(
      parseChecklistResults([
        { key: "temp", outcome: "fail", note: "Compressor cycling" },
        { key: "x", outcome: 7 },
        { key: "y" },
      ]),
    ).toEqual([{ key: "temp", outcome: "fail", note: "Compressor cycling" }]);
  });
});
