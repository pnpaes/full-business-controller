import { describe, expect, it } from "vitest";

import { DomainError } from "./errors";
import { Quantity } from "./quantity";
import { SupplierPack } from "./supplier-pack";
import { Unit } from "./unit";

const pack = Unit.from("pack", "package", true);
const gram = Unit.from("g", "mass", true);
const kilogram = Unit.from("kg", "mass");
const millilitre = Unit.from("ml", "volume", true);

describe("SupplierPack", () => {
  it("converts an accepted pack quantity to base units (1 pack = N base units)", () => {
    const flour = SupplierPack.from(pack, gram, "1000");
    expect(flour.factor).toBe("1000.000000");
    expect(flour.baseUnitsReceived(Quantity.from("2", "pack")).toString()).toBe("2000.000000");
    expect(flour.baseUnitsReceived(Quantity.from("2", "pack")).unit).toBe("g");
  });

  it("supports a fractional pack-to-base-unit factor", () => {
    const rice = SupplierPack.from(pack, kilogram, "2.5");
    expect(rice.baseUnitsReceived(Quantity.from("3", "pack")).toString()).toBe("7.500000");
  });

  it("allows a same-dimension pack (e.g. bottle to litre) and package to base", () => {
    expect(() => SupplierPack.from(pack, gram, "1000")).not.toThrow();
    expect(() => SupplierPack.from(kilogram, gram, "1000")).not.toThrow();
  });

  it("rejects a non-positive or over-precise factor", () => {
    expect(() => SupplierPack.from(pack, gram, "0")).toThrow(DomainError);
    expect(() => SupplierPack.from(pack, gram, "-2")).toThrow(DomainError);
    expect(() => SupplierPack.from(pack, gram, "1.0000001")).toThrow(DomainError);
  });

  it("rejects incompatible dimensions", () => {
    expect(() => SupplierPack.from(kilogram, millilitre, "1")).toThrow(DomainError);
  });

  it("rejects a pack quantity expressed in the wrong unit", () => {
    const flour = SupplierPack.from(pack, gram, "1000");
    expect(() => flour.baseUnitsReceived(Quantity.from("1", "kg"))).toThrow(DomainError);
  });

  it("rejects a non-positive accepted pack quantity", () => {
    const flour = SupplierPack.from(pack, gram, "1000");
    expect(() => flour.baseUnitsReceived(Quantity.from("0", "pack"))).toThrow(DomainError);
    expect(() => flour.baseUnitsReceived(Quantity.from("-1", "pack"))).toThrow(DomainError);
  });
});
