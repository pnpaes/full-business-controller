import { describe, expect, it } from "vitest";

import { DomainError } from "./errors";
import { Quantity } from "./quantity";

describe("Quantity", () => {
  it("subtracts quantities expressed in the same unit", () => {
    const remaining = Quantity.from("2.5", "kg").subtract(Quantity.from("0.75", "kg"));
    expect(remaining.toString()).toBe("1.750000");
  });

  it("rounds HALF_UP when dividing", () => {
    // 1 / 3 = 0.333333... -> 0.333333 at 6 dp for 1 and 0.333334 for 2.
    expect(Quantity.from("1", "kg").divide("3").toString()).toBe("0.333333");
    expect(Quantity.from("2", "kg").divide("3").toString()).toBe("0.666667");
  });

  it("rejects division by zero", () => {
    expect(() => Quantity.from("1", "kg").divide("0")).toThrow(DomainError);
  });

  it("rejects arithmetic across units", () => {
    expect(() => Quantity.from("1", "kg").add(Quantity.from("1", "g"))).toThrow(DomainError);
  });
});
