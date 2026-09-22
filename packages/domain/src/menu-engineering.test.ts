import { describe, expect, it } from "vitest";

import { DomainError } from "./errors";
import { isHighAgainst, medianDecimal } from "./menu-engineering";

describe("medianDecimal", () => {
  it("returns null for an empty input", () => {
    expect(medianDecimal([])).toBeNull();
  });

  it("returns the middle value of an odd count at its scale", () => {
    expect(medianDecimal(["3.000000", "1.000000", "2.000000"])).toBe("2.000000");
  });

  it("returns the mean of the two middle values of an even count", () => {
    expect(medianDecimal(["1.000000", "2.000000"])).toBe("1.500000");
    expect(medianDecimal(["1.0000", "2.0000", "3.0000", "4.0000"])).toBe("2.5000");
  });

  it("rounds the even-count mean HALF_UP at the working scale (DEC-024)", () => {
    // (1.0001 + 1.0002) / 2 = 1.00015 → 1.0002 at 4 dp (half away from zero).
    expect(medianDecimal(["1.0001", "1.0002"])).toBe("1.0002");
    // (1.0000 + 1.0001) / 2 = 1.00005 → 1.0001 at 4 dp.
    expect(medianDecimal(["1.0000", "1.0001"])).toBe("1.0001");
  });

  it("keeps the middle value of a tie", () => {
    expect(medianDecimal(["2.0000", "2.0000", "2.0000"])).toBe("2.0000");
    expect(medianDecimal(["5.0000", "1.0000", "1.0000"])).toBe("1.0000");
  });

  it("handles negative values exactly", () => {
    expect(medianDecimal(["-3.0000", "-1.0000"])).toBe("-2.0000");
    expect(medianDecimal(["-5.0000", "-1.0000", "-3.0000"])).toBe("-3.0000");
  });

  it("rounds a negative even-count mean half away from zero (DEC-024)", () => {
    // (-1.0001 + -1.0002) / 2 = -1.00015 → -1.0002 at 4 dp (half away from zero).
    expect(medianDecimal(["-1.0001", "-1.0002"])).toBe("-1.0002");
  });

  it("uses MONEY_SCALE for integer inputs so a half is never lost", () => {
    expect(medianDecimal(["1", "2"])).toBe("1.5000");
  });

  it("rejects a malformed decimal", () => {
    expect(() => medianDecimal(["1.0000", "nope"])).toThrow(DomainError);
    expect(() => medianDecimal([""])).toThrow(DomainError);
    expect(() => medianDecimal(["1.0000000"])).toThrow(DomainError);
  });
});

describe("isHighAgainst", () => {
  it("is true at the equality boundary", () => {
    expect(isHighAgainst("2.0000", "2.0000")).toBe(true);
    expect(isHighAgainst("2.000000", "2.000000")).toBe(true);
  });

  it("is true above and false below the boundary", () => {
    expect(isHighAgainst("2.0001", "2.0000")).toBe(true);
    expect(isHighAgainst("1.9999", "2.0000")).toBe(false);
  });

  it("compares exactly across different scales", () => {
    expect(isHighAgainst("2.000000", "2.0000")).toBe(true);
    expect(isHighAgainst("1.999999", "2.0000")).toBe(false);
    expect(isHighAgainst("-1.0000", "-2.0000")).toBe(true);
  });

  it("rejects a malformed decimal", () => {
    expect(() => isHighAgainst("nope", "1.0000")).toThrow(DomainError);
    expect(() => isHighAgainst("1.0000", "1.0000000")).toThrow(DomainError);
  });
});
