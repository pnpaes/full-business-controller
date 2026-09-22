import type { MenuEngineeringThreshold } from "@aquarela/application";
import { describe, expect, it } from "vitest";

import {
  classificationLabel,
  sourcePeriodLabel,
  thresholdValueLabel,
  wasteLabel,
} from "./menu-engineering-labels";

const FROM = "2026-09-01T00:00:00.000Z";
const TO = "2026-09-30T23:59:59.000Z";
const PERIOD = { start: FROM, end: TO };

function threshold(overrides: Partial<MenuEngineeringThreshold>): MenuEngineeringThreshold {
  return {
    statistic: "median",
    source: "computed",
    value: "5.000000",
    scope: { locationIds: null, channelId: null },
    sourcePeriod: PERIOD,
    ...overrides,
  };
}

describe("menu-engineering labels", () => {
  it("labels a classification without a quadrant name", () => {
    expect(classificationLabel(true)).toBe("High");
    expect(classificationLabel(false)).toBe("Low");
  });

  it("renders a threshold's source period", () => {
    expect(sourcePeriodLabel(PERIOD)).toBe("2026-09-01 – 2026-09-30");
  });

  it("renders a popularity threshold value in units", () => {
    expect(thresholdValueLabel(threshold({ statistic: "median", value: "5.000000" }))).toBe(
      "5 units",
    );
  });

  it("renders a category-relative contribution threshold as per-row", () => {
    expect(thresholdValueLabel(threshold({ statistic: "category_median", value: null }))).toBe(
      "category-relative (per row)",
    );
  });

  it("renders a null median as n/a and a single contribution value in money", () => {
    expect(thresholdValueLabel(threshold({ statistic: "median", value: null }))).toBe("n/a");
    expect(thresholdValueLabel(threshold({ statistic: "category_median", value: "12.0000" }))).toBe(
      "12.00 NOK",
    );
  });

  it("renders the waste annotation, or an em dash when absent", () => {
    expect(wasteLabel(null)).toBe("—");
    expect(wasteLabel({ quantity: "1.500000", value: null })).toBe("1.5");
    expect(wasteLabel({ quantity: "1.500000", value: "12.0000" })).toBe("1.5 · 12.00 NOK");
  });
});
