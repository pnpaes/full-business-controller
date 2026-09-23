import { describe, expect, it } from "vitest";

import { DomainError } from "./errors";
import {
  normaliseRecurringCostsToPeriod,
  recurringCostContributesToPeriod,
  type RecurringCostToNormalise,
} from "./recurrence";

function cost(
  recurrence: string,
  amount: string,
  effectiveFrom = "2026-01-01",
): RecurringCostToNormalise {
  return { amount, recurrence, effectiveFrom };
}

const JUNE_2026 = { periodFrom: "2026-06-01", periodTo: "2026-07-01" };

describe("normaliseRecurringCostsToPeriod", () => {
  it("scales each recurrence against a calendar-month period", () => {
    // June 2026 is 30 whole days.
    expect(
      normaliseRecurringCostsToPeriod({ costs: [cost("daily", "10.0000")], ...JUNE_2026 }),
    ).toBe("300.0000");
    expect(
      normaliseRecurringCostsToPeriod({ costs: [cost("weekly", "70.0000")], ...JUNE_2026 }),
    ).toBe("300.0000");
    expect(
      normaliseRecurringCostsToPeriod({ costs: [cost("monthly", "1000.0000")], ...JUNE_2026 }),
    ).toBe("1000.0000");
    // Quarterly nominal anchored at June = Jun+Jul+Aug = 92 days.
    expect(
      normaliseRecurringCostsToPeriod({ costs: [cost("quarterly", "900.0000")], ...JUNE_2026 }),
    ).toBe("293.4783");
    // Annual nominal anchored at June = the 12 months Jun 2026…May 2027 = 365
    // days, so 1200 × 30/365 = 98.6301369…, rounded once at 4 dp.
    expect(
      normaliseRecurringCostsToPeriod({ costs: [cost("annual", "1200.0000")], ...JUNE_2026 }),
    ).toBe("98.6301");
  });

  it("scales a monthly cost by exactly 1 in a calendar-month period", () => {
    expect(
      normaliseRecurringCostsToPeriod({ costs: [cost("monthly", "1000.0000")], ...JUNE_2026 }),
    ).toBe("1000.0000");
  });

  it("scales an annual cost over a multi-month period", () => {
    // 2026-04-01…2026-07-01 = 91 days; annual anchored at April = 365 days.
    // 365 × 91/365 = exactly 91.
    expect(
      normaliseRecurringCostsToPeriod({
        costs: [cost("annual", "365.0000")],
        periodFrom: "2026-04-01",
        periodTo: "2026-07-01",
      }),
    ).toBe("91.0000");
    // A monthly cost over three calendar months: 300 × 91/30 = 910 exactly.
    expect(
      normaliseRecurringCostsToPeriod({
        costs: [cost("monthly", "300.0000")],
        periodFrom: "2026-04-01",
        periodTo: "2026-07-01",
      }),
    ).toBe("910.0000");
  });

  it("anchors the nominal month on periodFrom in a February period", () => {
    // Non-leap February 2026 = 28 days, nominal 28 → exactly 1.
    expect(
      normaliseRecurringCostsToPeriod({
        costs: [cost("monthly", "280.0000")],
        periodFrom: "2026-02-01",
        periodTo: "2026-03-01",
      }),
    ).toBe("280.0000");
    // Leap February 2028 = 29 days, nominal 29 → exactly 1.
    expect(
      normaliseRecurringCostsToPeriod({
        costs: [cost("monthly", "290.0000")],
        periodFrom: "2028-02-01",
        periodTo: "2028-03-01",
      }),
    ).toBe("290.0000");
    // The annual anchor is the 12 months from Feb 2028 = 366 days, so
    // 366 × 29/366 = exactly 29 (the leap day is handled by the calendar).
    expect(
      normaliseRecurringCostsToPeriod({
        costs: [cost("annual", "366.0000")],
        periodFrom: "2028-02-01",
        periodTo: "2028-03-01",
      }),
    ).toBe("29.0000");
  });

  it("counts a one_off once, only in the period containing its effectiveFrom", () => {
    const costs = [
      cost("one_off", "500.0000", "2026-06-15"),
      cost("one_off", "700.0000", "2025-01-01"),
    ];
    expect(normaliseRecurringCostsToPeriod({ costs, ...JUNE_2026 })).toBe("500.0000");
    // Its open-ended window still overlaps July, but it must not repeat.
    expect(
      normaliseRecurringCostsToPeriod({
        costs,
        periodFrom: "2026-07-01",
        periodTo: "2026-08-01",
      }),
    ).toBe("0.0000");
  });

  it("counts a one_off on the half-open period boundary", () => {
    expect(
      normaliseRecurringCostsToPeriod({
        costs: [cost("one_off", "500.0000", "2026-06-01")],
        ...JUNE_2026,
      }),
    ).toBe("500.0000");
    // effectiveFrom == periodTo is outside the half-open period.
    expect(
      normaliseRecurringCostsToPeriod({
        costs: [cost("one_off", "500.0000", "2026-07-01")],
        ...JUNE_2026,
      }),
    ).toBe("0.0000");
  });

  it("sums mixed recurrences exactly over a common denominator", () => {
    // 1000 (monthly) + 98.6301369… (annual) + 300 (daily) + 500 (one_off) =
    // 1898.6301369… → 1898.6301 in one HALF_UP step.
    expect(
      normaliseRecurringCostsToPeriod({
        costs: [
          cost("monthly", "1000.0000"),
          cost("annual", "1200.0000"),
          cost("daily", "10.0000"),
          cost("one_off", "500.0000", "2026-06-15"),
        ],
        ...JUNE_2026,
      }),
    ).toBe("1898.6301");
  });

  it("returns zero for an empty cost list", () => {
    expect(normaliseRecurringCostsToPeriod({ costs: [], ...JUNE_2026 })).toBe("0.0000");
  });

  it("throws on an unknown recurrence", () => {
    expect(() =>
      normaliseRecurringCostsToPeriod({ costs: [cost("biweekly", "10.0000")], ...JUNE_2026 }),
    ).toThrow(DomainError);
    expect(() =>
      normaliseRecurringCostsToPeriod({ costs: [cost("biweekly", "10.0000")], ...JUNE_2026 }),
    ).toThrow(/unknown operating cost recurrence "biweekly"/);
  });
});

describe("recurringCostContributesToPeriod", () => {
  it("is true for a cost in its period and false for a one_off outside it", () => {
    expect(
      recurringCostContributesToPeriod(cost("monthly", "1.0000"), "2026-06-01", "2026-07-01"),
    ).toBe(true);
    expect(
      recurringCostContributesToPeriod(
        cost("one_off", "1.0000", "2026-06-15"),
        "2026-06-01",
        "2026-07-01",
      ),
    ).toBe(true);
    expect(
      recurringCostContributesToPeriod(
        cost("one_off", "1.0000", "2025-01-01"),
        "2026-06-01",
        "2026-07-01",
      ),
    ).toBe(false);
  });

  it("is false for a zero amount", () => {
    expect(
      recurringCostContributesToPeriod(cost("monthly", "0.0000"), "2026-06-01", "2026-07-01"),
    ).toBe(false);
  });

  it("throws on an unknown recurrence", () => {
    expect(() =>
      recurringCostContributesToPeriod(cost("biweekly", "1.0000"), "2026-06-01", "2026-07-01"),
    ).toThrow(DomainError);
  });
});
