import { describe, expect, it } from "vitest";

import {
  GRAIN_LABELS,
  GROUP_BY_LABELS,
  formatAsOf,
  formatMoney,
  formatPct,
  formatQuantity,
  isGrain,
  isGroupBy,
  metaLine,
  periodForGrain,
  scopeLabel,
  sparklinePoints,
} from "./report-labels";

const scope = { locationIds: null, channelId: null, category: null, productVariantId: null };

describe("isGrain", () => {
  it("recognises only the reporting grains", () => {
    expect(isGrain("week")).toBe(true);
    expect(isGrain("quarter")).toBe(false);
  });
});

describe("GRAIN_LABELS", () => {
  it("labels every grain", () => {
    expect(GRAIN_LABELS).toEqual({ day: "Daily", week: "Weekly", month: "Monthly" });
  });
});

describe("isGroupBy", () => {
  it("recognises only the reporting dimensions", () => {
    expect(isGroupBy("category")).toBe(true);
    expect(isGroupBy("sku")).toBe(false);
  });

  it("labels every group-by dimension", () => {
    expect(GROUP_BY_LABELS).toEqual({
      location: "Location",
      channel: "Channel",
      category: "Category",
      product: "Product",
      period: "Period",
    });
  });
});

describe("periodForGrain", () => {
  it("windows the current UTC day", () => {
    const period = periodForGrain("day", new Date("2026-09-22T14:30:00.000Z"));
    expect(period.from).toBe("2026-09-22T00:00:00.000Z");
    expect(period.to).toBe("2026-09-22T14:30:00.000Z");
    expect(period.label).toBe("2026-09-22 (today)");
  });

  it("windows the ISO week from Monday", () => {
    // 2026-09-22 is a Tuesday; the week began Monday 2026-09-21.
    const tuesday = periodForGrain("week", new Date("2026-09-22T09:00:00.000Z"));
    expect(tuesday.from).toBe("2026-09-21T00:00:00.000Z");
    // Sunday 2026-09-27 still belongs to the week that began Monday 2026-09-21.
    const sunday = periodForGrain("week", new Date("2026-09-27T20:00:00.000Z"));
    expect(sunday.from).toBe("2026-09-21T00:00:00.000Z");
    // The next Monday starts a new week.
    const nextMonday = periodForGrain("week", new Date("2026-09-28T00:00:00.000Z"));
    expect(nextMonday.from).toBe("2026-09-28T00:00:00.000Z");
  });

  it("windows the month to date", () => {
    const period = periodForGrain("month", new Date("2026-09-22T14:30:00.000Z"));
    expect(period.from).toBe("2026-09-01T00:00:00.000Z");
    expect(period.label).toBe("2026-09 month-to-date");
  });
});

describe("formatMoney", () => {
  it("presents money at 2 dp", () => {
    expect(formatMoney("1234.5000")).toBe("1234.50");
    expect(formatMoney("0.0000")).toBe("0.00");
    expect(formatMoney("10.0050")).toBe("10.01");
  });
});

describe("formatQuantity", () => {
  it("presents a quantity at 3 dp with trailing zeros trimmed", () => {
    expect(formatQuantity("3.000000")).toBe("3");
    expect(formatQuantity("1.500000")).toBe("1.5");
    expect(formatQuantity("0.000000")).toBe("0");
    expect(formatQuantity("1.234500")).toBe("1.235");
  });
});

describe("formatPct", () => {
  it("presents a margin at 1 dp or n/a", () => {
    expect(formatPct("67.500000")).toBe("67.5%");
    expect(formatPct("0.000000")).toBe("0.0%");
    expect(formatPct(null)).toBe("n/a");
  });
});

describe("scopeLabel and metaLine", () => {
  it("labels an organization-wide scope and a scoped one", () => {
    expect(scopeLabel(scope)).toBe("All locations");
    expect(scopeLabel({ ...scope, locationIds: ["a"] })).toBe("1 location");
    expect(scopeLabel({ ...scope, locationIds: ["a", "b"] })).toBe("2 locations");
  });

  it("builds the period · scope · freshness meta line", () => {
    const period = periodForGrain("month", new Date("2026-09-22T14:30:00.000Z"));
    expect(metaLine(period, scope, "2026-09-22T14:30:00.000Z")).toBe(
      "2026-09 month-to-date · All locations · as of 2026-09-22 14:30 UTC",
    );
    expect(formatAsOf("2026-09-22T14:30:00.000Z")).toBe("2026-09-22 14:30 UTC");
  });
});

describe("sparklinePoints", () => {
  it("maps net sales to chart coordinates", () => {
    expect(sparklinePoints([{ netSales: "100.0000" }, { netSales: "50.5000" }])).toEqual([
      100, 50.5,
    ]);
  });
});
