import { describe, expect, it } from "vitest";

import {
  formatFlatBand,
  formatFractionPct,
  formatMetricValue,
  formatRelativeChange,
  formatShortfall,
  isDimension,
  isMetric,
  severityTone,
} from "./analytics-labels";

describe("formatFractionPct", () => {
  it("formats a 6 dp fraction as a 1 dp percentage", () => {
    expect(formatFractionPct("0.200000")).toBe("20.0%");
    expect(formatFractionPct("-0.250000")).toBe("-25.0%");
    expect(formatFractionPct("0.050000")).toBe("5.0%");
  });
});

describe("formatRelativeChange", () => {
  it("renders n/a for an undefined change", () => {
    expect(formatRelativeChange(null)).toBe("n/a");
    expect(formatRelativeChange("0.100000")).toBe("10.0%");
  });
});

describe("formatMetricValue", () => {
  it("formats each unit and never shows an undefined value as zero", () => {
    expect(formatMetricValue("100.0000", "money")).toBe("100.00 NOK");
    expect(formatMetricValue("3.000000", "quantity")).toBe("3");
    expect(formatMetricValue("0.950000", "ratio")).toBe("95.0%");
    expect(formatMetricValue("12", "count")).toBe("12");
    expect(formatMetricValue(null, "money")).toBe("n/a");
  });
});

describe("formatFlatBand / formatShortfall", () => {
  it("formats the flat band and a shortfall", () => {
    expect(formatFlatBand("0.050000")).toBe("±5.0%");
    expect(formatShortfall("0.500000")).toBe("50.0%");
    expect(formatShortfall(null)).toBe("n/a");
  });
});

describe("guards and severity", () => {
  it("guards the vocabularies and maps severity to a tone", () => {
    expect(isMetric("revenue")).toBe(true);
    expect(isMetric("profit")).toBe(false);
    expect(isDimension("location")).toBe(true);
    expect(isDimension("supplier")).toBe(false);
    expect(severityTone("high")).toBe("danger");
    expect(severityTone("medium")).toBe("warning");
    expect(severityTone("low")).toBe("info");
  });
});
