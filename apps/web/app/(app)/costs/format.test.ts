import { describe, expect, it } from "vitest";

import {
  formatInstant,
  formatInstantWindow,
  formatMoney,
  formatPercent,
  formatQuantity,
  formatWindow,
  orDash,
  stateTone,
  trimDecimal,
} from "./format";

describe("costs display formatting", () => {
  it("rounds money to 2 dp and trims quantities", () => {
    expect(formatMoney("12.3348")).toBe("12.33");
    expect(formatMoney("12.3350")).toBe("12.34");
    expect(formatQuantity("0.018000")).toBe("0.018");
    expect(trimDecimal("1.500000")).toBe("1.5");
    expect(trimDecimal("-0.000000")).toBe("0");
  });

  it("converts a 6 dp fraction to a 2 dp percentage", () => {
    expect(formatPercent("0.253300")).toBe("25.33%");
    expect(formatPercent("0.8500")).toBe("85.00%");
  });

  it("formats instants, windows and nulls", () => {
    expect(formatInstant("2026-09-20T12:42:00.000Z")).toBe("2026-09-20 12:42 UTC");
    expect(formatWindow("2026-01-01", null)).toBe("2026-01-01 → open");
    expect(formatWindow("2026-01-01", "2026-06-01")).toBe("2026-01-01 → 2026-06-01");
    expect(formatInstantWindow("2026-10-01T00:00:00.000Z", null)).toBe(
      "2026-10-01 00:00 UTC → open",
    );
    expect(formatInstantWindow("2026-10-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z")).toBe(
      "2026-10-01 00:00 UTC → 2026-11-01 00:00 UTC",
    );
    expect(orDash(null)).toBe("—");
    expect(orDash("")).toBe("—");
    expect(orDash("MAIN")).toBe("MAIN");
  });

  it("maps states to tones", () => {
    expect(stateTone("approved")).toBe("success");
    expect(stateTone("superseded")).toBe("warning");
    expect(stateTone("rejected")).toBe("danger");
    expect(stateTone("draft")).toBe("info");
  });
});
