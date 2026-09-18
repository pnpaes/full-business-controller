import { describe, expect, it } from "vitest";

import { DomainError } from "./errors";
import { Money } from "./money";

describe("Money", () => {
  it("adds amounts in the same currency at money scale", () => {
    const total = Money.from("10.5000", "NOK").add(Money.from("2.2500", "NOK"));
    expect(total.toString()).toBe("12.7500");
  });

  it("rounds HALF_UP when a factor lands exactly on a half unit", () => {
    // 1.0000 * 0.00005 = 0.00005 -> rounds up to 0.0001 at 4 dp.
    expect(Money.from("1", "NOK").multiply("0.00005").toString()).toBe("0.0001");
  });

  it("rejects amounts with more precision than the money scale", () => {
    expect(() => Money.from("1.23456", "NOK")).toThrow(DomainError);
  });

  it("rejects arithmetic across currencies", () => {
    expect(() => Money.from("1", "NOK").add(Money.from("1", "EUR"))).toThrow(DomainError);
  });
});
