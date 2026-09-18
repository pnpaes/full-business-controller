import { Money, Quantity } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { lineTotal } from "./line-total";

describe("lineTotal", () => {
  it("multiplies a unit price by a quantity via the domain package", () => {
    const total = lineTotal(Money.from("19.9000", "NOK"), Quantity.from("2.5", "piece"));
    expect(total.toString()).toBe("49.7500");
  });
});
