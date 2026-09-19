import { describe, expect, it } from "vitest";

import { DomainError } from "./errors";
import { computeLandedCost } from "./landed-cost";
import { Quantity } from "./quantity";
import { SupplierPack } from "./supplier-pack";
import { Unit } from "./unit";

const packUnit = Unit.from("pack", "package", false);
const kgUnit = Unit.from("kg", "mass", false);

function pack(factor = "1000"): SupplierPack {
  return SupplierPack.from(packUnit, kgUnit, factor);
}

describe("computeLandedCost", () => {
  it("computes net, landed pack cost and the B1 base-unit cost (exclusive basis)", () => {
    const result = computeLandedCost({
      grossPackPrice: "100",
      discount: "5",
      recoverableTax: "0",
      allocatedFreight: "3",
      importFee: "2",
      currency: "NOK",
      acceptedPackQuantity: Quantity.from("2", "pack"),
      pack: pack("1000"),
    });

    expect(result.netPackPrice).toBe("95.0000");
    expect(result.landedPackCost).toBe("100.0000");
    expect(result.baseUnitsReceived).toBe("2000.000000");
    expect(result.landedBaseUnitCost).toBe("0.0500");
  });

  it("subtracts the explicit recoverable tax from an inclusive price", () => {
    const result = computeLandedCost({
      grossPackPrice: "125",
      recoverableTax: "25",
      currency: "NOK",
      acceptedPackQuantity: Quantity.from("1", "pack"),
      pack: pack("1000"),
    });

    expect(result.netPackPrice).toBe("100.0000");
    expect(result.landedPackCost).toBe("100.0000");
    expect(result.landedBaseUnitCost).toBe("0.1000");
  });

  it("adds other_acquisition_cost when supplied (§5)", () => {
    const result = computeLandedCost({
      grossPackPrice: "10",
      recoverableTax: "0",
      otherAcquisitionCost: "2.5",
      currency: "NOK",
      acceptedPackQuantity: Quantity.from("1", "pack"),
      pack: pack("100"),
    });

    expect(result.landedPackCost).toBe("12.5000");
    expect(result.landedBaseUnitCost).toBe("0.1250");
  });

  it("rounds HALF_UP at B1 where the 5th decimal decides", () => {
    // 2 / 3 = 0.6666…, the 5th decimal (6) rounds 0.6666 up to 0.6667.
    const up = computeLandedCost({
      grossPackPrice: "2",
      recoverableTax: "0",
      currency: "NOK",
      acceptedPackQuantity: Quantity.from("1", "pack"),
      pack: pack("3"),
    });
    expect(up.landedBaseUnitCost).toBe("0.6667");

    // 1 / 3 = 0.3333…, the 5th decimal (3) rounds 0.3333 down.
    const down = computeLandedCost({
      grossPackPrice: "1",
      recoverableTax: "0",
      currency: "NOK",
      acceptedPackQuantity: Quantity.from("1", "pack"),
      pack: pack("3"),
    });
    expect(down.landedBaseUnitCost).toBe("0.3333");
  });

  it("rejects a non-positive accepted pack quantity", () => {
    expect(() =>
      computeLandedCost({
        grossPackPrice: "10",
        recoverableTax: "0",
        currency: "NOK",
        acceptedPackQuantity: Quantity.from("0", "pack"),
        pack: pack("1000"),
      }),
    ).toThrow(DomainError);
  });

  it("rejects a quantity expressed in a unit that is not the pack unit", () => {
    expect(() =>
      computeLandedCost({
        grossPackPrice: "10",
        recoverableTax: "0",
        currency: "NOK",
        acceptedPackQuantity: Quantity.from("1", "kg"),
        pack: pack("1000"),
      }),
    ).toThrow(/does not match pack unit/);
  });

  it("rejects an unresolved currency", () => {
    expect(() =>
      computeLandedCost({
        grossPackPrice: "10",
        recoverableTax: "0",
        currency: "",
        acceptedPackQuantity: Quantity.from("1", "pack"),
        pack: pack("1000"),
      }),
    ).toThrow(DomainError);
  });
});
