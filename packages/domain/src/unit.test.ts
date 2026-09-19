import { describe, expect, it } from "vitest";

import { DomainError } from "./errors";
import { Quantity } from "./quantity";
import { Unit, convertQuantity } from "./unit";

const gram = Unit.from("g", "mass", true);
const kilogram = Unit.from("kg", "mass");
const millilitre = Unit.from("ml", "volume", true);
const thirdGram = Unit.from("third", "mass");

describe("Unit", () => {
  it("records the dimension and whether it is the dimension's base unit", () => {
    expect(gram.isBase).toBe(true);
    expect(kilogram.isBase).toBe(false);
    expect(kilogram.dimension).toBe("mass");
  });

  it("defaults to a non-base unit and trims the code", () => {
    expect(Unit.from("  kg  ", "mass").code).toBe("kg");
    expect(Unit.from("kg", "mass").isBase).toBe(false);
  });

  it("rejects an empty code and an unknown dimension", () => {
    expect(() => Unit.from("  ", "mass")).toThrow(DomainError);
    expect(() => Unit.from("m", "length" as never)).toThrow(DomainError);
  });

  it("compares by dimension, compatibility and identity", () => {
    expect(gram.isCompatibleWith(kilogram)).toBe(true);
    expect(gram.isCompatibleWith(millilitre)).toBe(false);
    expect(gram.equals(Unit.from("g", "mass", true))).toBe(true);
    expect(gram.equals(kilogram)).toBe(false);
  });
});

describe("convertQuantity", () => {
  it("applies a resolved factor within one dimension", () => {
    expect(convertQuantity(Quantity.from("1.5", "kg"), kilogram, gram, "1000").toString()).toBe(
      "1500.000000",
    );
    expect(convertQuantity(Quantity.from("500", "g"), gram, kilogram, "0.001").toString()).toBe(
      "0.500000",
    );
  });

  it("rounds HALF_UP at quantity scale after a single multiplication", () => {
    // 0.000001 × 0.5 = 0.0000005 -> 0.000001; × 0.499999 = 0.000000499999 -> 0.000000.
    expect(convertQuantity(Quantity.from("0.000001", "g"), gram, kilogram, "0.5").toString()).toBe(
      "0.000001",
    );
    expect(
      convertQuantity(Quantity.from("0.000001", "g"), gram, kilogram, "0.499999").toString(),
    ).toBe("0.000000");
  });

  it("is a no-op for a factor of exactly one", () => {
    expect(convertQuantity(Quantity.from("2.5", "g"), gram, gram, "1").toString()).toBe("2.500000");
  });

  it("rejects a mismatched source unit, an incompatible dimension and a non-positive factor", () => {
    expect(() => convertQuantity(Quantity.from("1", "kg"), gram, kilogram, "0.001")).toThrow(
      DomainError,
    );
    expect(() => convertQuantity(Quantity.from("1", "g"), gram, millilitre, "1")).toThrow(
      DomainError,
    );
    expect(() => convertQuantity(Quantity.from("1", "g"), gram, thirdGram, "0")).toThrow(
      DomainError,
    );
    expect(() => convertQuantity(Quantity.from("1", "g"), gram, thirdGram, "-1")).toThrow(
      DomainError,
    );
  });
});
