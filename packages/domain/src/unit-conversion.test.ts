import { describe, expect, it } from "vitest";

import { DomainError } from "./errors";
import { Quantity } from "./quantity";
import { ConversionGraph, convertUsingGraph, type UnitConversionEdge } from "./unit-conversion";
import { Unit } from "./unit";

const gram = Unit.from("g", "mass", true);
const kilogram = Unit.from("kg", "mass");
const milligram = Unit.from("mg", "mass");
const litre = Unit.from("l", "volume", true);
const pack = Unit.from("pack", "package", true);

const AT = new Date("2026-09-19T00:00:00.000Z");
const OPEN = null;

const edge = (
  from: Unit,
  to: Unit,
  factor: string,
  overrides: Partial<Omit<UnitConversionEdge, "from" | "to" | "factor">> = {},
): UnitConversionEdge => ({
  from,
  to,
  factor,
  itemId: null,
  effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
  effectiveTo: OPEN,
  ...overrides,
});

describe("ConversionGraph", () => {
  it("resolves a direct conversion to a factor at 6 dp", () => {
    const graph = ConversionGraph.from([edge(kilogram, gram, "1000")]);
    expect(graph.resolve(kilogram, gram, { asOf: AT })).toBe("1000.000000");
  });

  it("composes a multi-hop path without float error", () => {
    const graph = ConversionGraph.from([
      edge(kilogram, gram, "1000"),
      edge(gram, milligram, "1000"),
    ]);
    expect(graph.resolve(kilogram, milligram, { asOf: AT })).toBe("1000000.000000");
  });

  it("returns 1 for a unit converted to itself", () => {
    const graph = ConversionGraph.from([edge(kilogram, gram, "1000")]);
    expect(graph.resolve(gram, gram, { asOf: AT })).toBe("1.000000");
  });

  it("applies the resolved factor through convertQuantity", () => {
    const graph = ConversionGraph.from([edge(kilogram, gram, "1000")]);
    const converted = convertUsingGraph(graph, Quantity.from("1.5", "kg"), kilogram, gram, {
      asOf: AT,
    });
    expect(converted.toString()).toBe("1500.000000");
    expect(converted.unit).toBe("g");
  });

  it("honours the effective window as a half-open interval", () => {
    const graph = ConversionGraph.from([
      edge(kilogram, gram, "1000", {
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        effectiveTo: new Date("2026-06-01T00:00:00.000Z"),
      }),
    ]);
    expect(graph.resolve(kilogram, gram, { asOf: new Date("2026-03-01T00:00:00.000Z") })).toBe(
      "1000.000000",
    );
    // `effective_to` is exclusive, so it is no longer in effect at the boundary.
    expect(() =>
      graph.resolve(kilogram, gram, { asOf: new Date("2026-06-01T00:00:00.000Z") }),
    ).toThrow(DomainError);
    expect(() =>
      graph.resolve(kilogram, gram, { asOf: new Date("2025-12-31T00:00:00.000Z") }),
    ).toThrow(DomainError);
  });

  it("uses global edges only when no item context is given", () => {
    const graph = ConversionGraph.from([
      edge(kilogram, gram, "1000"),
      edge(kilogram, gram, "1000", { itemId: "item-1" }),
    ]);
    expect(graph.resolve(kilogram, gram, { asOf: AT })).toBe("1000.000000");
  });

  it("includes a matching item-scoped edge and rejects a conflicting global edge", () => {
    const agreeing = ConversionGraph.from([
      edge(kilogram, gram, "1000"),
      edge(kilogram, gram, "1000", { itemId: "item-1" }),
    ]);
    expect(agreeing.resolve(kilogram, gram, { asOf: AT, itemId: "item-1" })).toBe("1000.000000");

    const conflicting = ConversionGraph.from([
      edge(kilogram, gram, "1000"),
      edge(kilogram, gram, "950", { itemId: "item-1" }),
    ]);
    expect(() => conflicting.resolve(kilogram, gram, { asOf: AT, itemId: "item-1" })).toThrow(
      /ambiguous conversion/,
    );
    // A different item does not see the item-scoped edge, so there is no conflict.
    expect(conflicting.resolve(kilogram, gram, { asOf: AT, itemId: "item-2" })).toBe("1000.000000");
  });

  it("rejects a non-positive factor at construction", () => {
    expect(() => ConversionGraph.from([edge(kilogram, gram, "0")])).toThrow(
      /conversion factor must be positive/,
    );
    expect(() => ConversionGraph.from([edge(kilogram, gram, "-1")])).toThrow(
      /conversion factor must be positive/,
    );
  });

  it("rejects incompatible dimensions at construction", () => {
    expect(() => ConversionGraph.from([edge(gram, litre, "1")])).toThrow(
      /incompatible unit dimensions/,
    );
  });

  it("allows a package-to-base edge but not package to a non-base unit", () => {
    const graph = ConversionGraph.from([edge(pack, gram, "1000")]);
    expect(graph.resolve(pack, gram, { asOf: AT })).toBe("1000.000000");
    expect(() => ConversionGraph.from([edge(pack, kilogram, "1")])).toThrow(
      /incompatible unit dimensions/,
    );
  });

  it("rejects an unordered effective window", () => {
    const from = new Date("2026-06-01T00:00:00.000Z");
    expect(() =>
      ConversionGraph.from([
        edge(kilogram, gram, "1000", {
          effectiveFrom: from,
          effectiveTo: new Date("2026-01-01T00:00:00.000Z"),
        }),
      ]),
    ).toThrow(/effective_to must be after effective_from/);
    expect(() =>
      ConversionGraph.from([
        edge(kilogram, gram, "1000", { effectiveFrom: from, effectiveTo: from }),
      ]),
    ).toThrow(/effective_to must be after effective_from/);
  });

  it("throws when two paths imply different factors (inconsistent cycle)", () => {
    // kg -> g -> mg is 1000 * 1000; a second kg -> mg edge of 999 conflicts.
    const graph = ConversionGraph.from([
      edge(kilogram, gram, "1000"),
      edge(gram, milligram, "1000"),
      edge(kilogram, milligram, "999"),
    ]);
    expect(() => graph.resolve(kilogram, milligram, { asOf: AT })).toThrow(/ambiguous conversion/);
  });

  it("accepts a consistent cycle", () => {
    const graph = ConversionGraph.from([
      edge(kilogram, gram, "1000"),
      edge(gram, kilogram, "0.001"),
    ]);
    expect(graph.resolve(kilogram, gram, { asOf: AT })).toBe("1000.000000");
  });

  it("throws when no effective path connects the units", () => {
    const graph = ConversionGraph.from([edge(kilogram, gram, "1000")]);
    expect(() => graph.resolve(kilogram, milligram, { asOf: AT })).toThrow(
      /no conversion from "kg" to "mg"/,
    );
  });
});
