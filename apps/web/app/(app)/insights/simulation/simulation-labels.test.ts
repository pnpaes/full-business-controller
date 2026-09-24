import { describe, expect, it } from "vitest";

import {
  buildSimulationBody,
  endOfDayInstant,
  formatHours,
  formatMoney,
  formatPct,
  previousMonthPeriod,
  startOfDayInstant,
} from "./simulation-labels";

const AS_OF = "2026-06-01T00:00:00.000Z";

function form(overrides: Record<string, unknown> = {}) {
  return {
    locationId: "loc-1",
    periodFrom: "2026-05-01",
    periodTo: "2026-05-31",
    volumeChangePct: "",
    priceChangePct: "",
    wageChangePct: "",
    menuRemovals: [],
    menuAdds: [],
    headcountChange: [],
    ...overrides,
  };
}

describe("simulation-labels", () => {
  it("formats money and percentages as decimal strings", () => {
    expect(formatMoney("130.5000")).toBe("130.50");
    expect(formatMoney("-0.5000")).toBe("-0.50");
    expect(formatPct("10.00")).toBe("10.0%");
    expect(formatPct(null)).toBe("n/a");
    expect(formatHours("320.000000")).toBe("320");
    expect(formatHours("1.500000")).toBe("1.5");
  });

  it("converts date inputs to inclusive ISO instants", () => {
    expect(startOfDayInstant("2026-05-01")).toBe("2026-05-01T00:00:00.000Z");
    expect(endOfDayInstant("2026-05-31")).toBe("2026-05-31T23:59:59.999Z");
  });

  it("derives the previous whole UTC month", () => {
    expect(previousMonthPeriod(new Date("2026-06-15T12:00:00Z"))).toEqual({
      from: "2026-05-01",
      to: "2026-05-31",
    });
    expect(previousMonthPeriod(new Date("2026-01-05T12:00:00Z"))).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });

  it("builds a minimal body and omits blank optional fields", () => {
    expect(buildSimulationBody(form(), AS_OF)).toEqual({
      asOf: AS_OF,
      locationId: "loc-1",
      baseline: {
        periodFrom: "2026-05-01T00:00:00.000Z",
        periodTo: "2026-05-31T23:59:59.999Z",
      },
    });
  });

  it("includes every provided dimension", () => {
    const body = buildSimulationBody(
      form({
        volumeChangePct: "10",
        priceChangePct: "-5",
        wageChangePct: "2",
        menuRemovals: ["recipe-1"],
        menuAdds: [{ recipeId: "recipe-2", expectedUnitsPerPeriod: "50" }],
        headcountChange: [
          { roleCode: "kitchen", countDelta: "2", hoursPerPeriod: "160", costCenterId: "" },
        ],
      }),
      AS_OF,
    );

    expect(body).toMatchObject({
      volumeChangePct: "10",
      priceChangePct: "-5",
      wageChangePct: "2",
      menuRemovals: [{ recipeId: "recipe-1" }],
      menuAdds: [{ recipeId: "recipe-2", expectedUnitsPerPeriod: "50" }],
      headcountChange: [{ roleCode: "kitchen", countDelta: "2", hoursPerPeriod: "160" }],
    });
  });

  it("drops a fully blank headcount row", () => {
    const body = buildSimulationBody(
      form({
        headcountChange: [
          { roleCode: "", countDelta: "", hoursPerPeriod: "", costCenterId: "" },
          { roleCode: "barista", countDelta: "1", hoursPerPeriod: "20", costCenterId: "cc-1" },
        ],
      }),
      AS_OF,
    );

    expect(body["headcountChange"]).toEqual([
      { roleCode: "barista", countDelta: "1", hoursPerPeriod: "20", costCenterId: "cc-1" },
    ]);
  });
});
