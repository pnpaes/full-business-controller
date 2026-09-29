import { describe, expect, it } from "vitest";

import {
  axisLabel,
  formatAxisValue,
  formatMoney,
  formatNumber,
  formatRelativeAge,
  groupDecimal,
} from "./format";

describe("groupDecimal", () => {
  it("groups the integer part in threes without touching the fraction", () => {
    expect(groupDecimal("1234567.8900")).toBe("1,234,567.8900");
    expect(groupDecimal("999")).toBe("999");
    expect(groupDecimal("1000")).toBe("1,000");
  });

  it("keeps a leading sign and handles a bare fraction", () => {
    expect(groupDecimal("-1234.5")).toBe("-1,234.5");
    expect(groupDecimal("+.50")).toBe("0.50");
  });

  it("rejects a non-decimal string rather than silently reformatting it", () => {
    expect(() => groupDecimal("1,234")).toThrow();
    expect(() => groupDecimal("not-a-number")).toThrow();
    expect(() => groupDecimal("1.2.3")).toThrow();
  });
});

describe("formatNumber", () => {
  it("rounds HALF_UP to the requested decimals", () => {
    expect(formatNumber("1234.5000")).toBe("1,234.50");
    expect(formatNumber("10.0050")).toBe("10.01");
    expect(formatNumber("0.0000")).toBe("0.00");
    expect(formatNumber("-10.0050")).toBe("-10.01");
  });

  it("carries across the integer when rounding overflows", () => {
    expect(formatNumber("9.999", { decimals: 2 })).toBe("10.00");
    expect(formatNumber("99.999", { decimals: 2 })).toBe("100.00");
  });

  it("supports zero decimals and configurable separators", () => {
    expect(formatNumber("42.6", { decimals: 0 })).toBe("43");
    expect(formatNumber("1234.5", { groupSeparator: " ", decimalSeparator: "," })).toBe("1 234,50");
  });
});

describe("formatMoney", () => {
  it("groups, scales to 2dp and appends the currency", () => {
    expect(formatMoney("1234.5000", { currency: "NOK" })).toBe("1,234.50 NOK");
    expect(formatMoney("1234.5")).toBe("1,234.50");
  });
});

describe("chart axis convention", () => {
  it("formatAxisValue names the unit on every tick", () => {
    expect(formatAxisValue("1200", "kg", { decimals: 0 })).toBe("1,200 kg");
    expect(formatAxisValue("12.5", "NOK")).toBe("12.50 NOK");
    expect(formatAxisValue("3", undefined, { decimals: 0 })).toBe("3");
  });

  it("axisLabel names the subject and, when given, the unit", () => {
    expect(axisLabel("Amount", "NOK")).toBe("Amount (NOK)");
    expect(axisLabel("Quantity", "kg")).toBe("Quantity (kg)");
    expect(axisLabel("Food cost %")).toBe("Food cost %");
  });
});

describe("formatRelativeAge", () => {
  const now = new Date("2026-09-29T08:00:00Z");

  it("renders sub-minute ages as just now", () => {
    expect(formatRelativeAge("2026-09-29T07:59:30.000Z", now)).toBe("just now");
  });

  it("renders minutes, hours and days", () => {
    expect(formatRelativeAge("2026-09-29T07:55:00.000Z", now)).toBe("5m");
    expect(formatRelativeAge("2026-09-29T05:00:00.000Z", now)).toBe("3h");
    expect(formatRelativeAge("2026-09-27T08:00:00.000Z", now)).toBe("2d");
  });

  it("clamps a future instant to just now rather than a negative age", () => {
    expect(formatRelativeAge("2026-09-29T09:00:00.000Z", now)).toBe("just now");
    expect(formatRelativeAge(new Date("2026-09-29T09:00:00.000Z"), now)).toBe("just now");
  });
});
