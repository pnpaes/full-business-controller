import { describe, expect, it } from "vitest";

import {
  formatFractionPct,
  formatMoney,
  formatQuantity,
  formatRatio,
  operationsRecordsHref,
  wasteStageLabel,
} from "./operations-labels";

describe("wasteStageLabel", () => {
  it("maps the DEC-018 stages to display labels", () => {
    expect(wasteStageLabel("storage_expiry")).toBe("Storage / expiry");
    expect(wasteStageLabel("unsold_finished_goods")).toBe("Unsold finished goods");
  });

  it("falls back to the raw stage for an unknown value", () => {
    expect(wasteStageLabel("mystery")).toBe("mystery");
  });
});

describe("formatFractionPct", () => {
  it("renders a stored fraction as a 1 dp percentage", () => {
    expect(formatFractionPct("0.100000")).toBe("10.0%");
    expect(formatFractionPct("-0.050000")).toBe("-5.0%");
    expect(formatFractionPct("0.000000")).toBe("0.0%");
  });

  it("renders n/a when undefined", () => {
    expect(formatFractionPct(null)).toBe("n/a");
  });
});

describe("formatRatio", () => {
  it("renders a 6 dp ratio at 2 dp", () => {
    expect(formatRatio("0.900000")).toBe("0.90");
    expect(formatRatio("1.250000")).toBe("1.25");
  });

  it("renders n/a when undefined", () => {
    expect(formatRatio(null)).toBe("n/a");
  });
});

describe("formatMoney and formatQuantity", () => {
  it("formats money at 2 dp and quantity with trailing zeros trimmed", () => {
    expect(formatMoney("1250.0000")).toBe("1250.00");
    expect(formatQuantity("3.000000")).toBe("3");
    expect(formatQuantity("1.500000")).toBe("1.5");
  });
});

describe("operationsRecordsHref", () => {
  const report = {
    period: { from: "2026-09-01T00:00:00.000Z", to: "2026-09-30T23:59:59.000Z" },
    grain: "month" as const,
    scope: { locationIds: null },
    stockValue: { asOf: "2026-09-29T23:59:59.000Z" },
  };

  it("builds the section URL with the window, grain and the stock-value as-of", () => {
    const href = operationsRecordsHref("production", report);
    const params = new URL(`http://localhost${href}`).searchParams;
    expect(params.get("section")).toBe("production");
    expect(params.get("from")).toBe(report.period.from);
    expect(params.get("to")).toBe(report.period.to);
    expect(params.get("grain")).toBe("month");
    expect(params.get("asOf")).toBe(report.stockValue.asOf);
    expect(params.get("locationIds")).toBeNull();
  });

  it("carries the caller's location scope as a list", () => {
    const href = operationsRecordsHref("waste", {
      ...report,
      scope: { locationIds: ["loc-1", "loc-2"] },
    });
    const params = new URL(`http://localhost${href}`).searchParams;
    expect(params.get("locationIds")).toBe("loc-1,loc-2");
  });
});
