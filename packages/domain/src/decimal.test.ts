import { describe, expect, it } from "vitest";

import { divideRoundHalfUp, formatDecimal, parseDecimal, rescale } from "./decimal";
import { DomainError } from "./errors";

describe("parseDecimal", () => {
  it("scales a plain decimal to the given scale", () => {
    expect(parseDecimal("123.45", 4)).toBe(1234500n);
  });

  it("keeps the sign", () => {
    expect(parseDecimal("-123.45", 4)).toBe(-1234500n);
  });

  it("accepts the exact numeric(19,6) limit of 13 integer digits", () => {
    expect(parseDecimal("1234567890123", 6)).toBe(1234567890123000000n);
  });

  it("accepts the exact numeric(19,4) limit of 15 integer digits", () => {
    expect(parseDecimal("123456789012345", 4)).toBe(1234567890123450000n);
  });

  it("rejects one integer digit over the numeric(19,6) limit", () => {
    expect(() => parseDecimal("12345678901234", 6)).toThrow(DomainError);
  });

  it("rejects one integer digit over the numeric(19,4) limit", () => {
    expect(() => parseDecimal("1234567890123456", 4)).toThrow(DomainError);
  });

  it("rejects a negative value one integer digit over the numeric(19,6) limit", () => {
    expect(() => parseDecimal("-12345678901234", 6)).toThrow(DomainError);
  });

  it("accepts the exact numeric(19,0) limit of 19 integer digits", () => {
    expect(parseDecimal("1234567890123456789", 0)).toBe(1234567890123456789n);
  });

  it("rejects one integer digit over the numeric(19,0) limit", () => {
    expect(() => parseDecimal("12345678901234567890", 0)).toThrow(DomainError);
  });

  it("does not count leading zeros toward the precision limit", () => {
    expect(parseDecimal("0000000000000123", 6)).toBe(123000000n);
  });

  it("still rejects more fractional precision than the scale", () => {
    expect(() => parseDecimal("1.1234567", 6)).toThrow(DomainError);
  });
});

describe("formatDecimal", () => {
  it("renders a scaled integer back with the scale's decimal places", () => {
    expect(formatDecimal(1234500n, 4)).toBe("123.4500");
    expect(formatDecimal(-1234500n, 4)).toBe("-123.4500");
  });
});

describe("rescale", () => {
  it("scales up exactly and rounds HALF_UP when scaling down", () => {
    expect(rescale(1234500n, 4, 6)).toBe(123450000n);
    expect(rescale(1234567n, 6, 4)).toBe(12346n);
  });
});

describe("divideRoundHalfUp", () => {
  it("rounds halves away from zero", () => {
    expect(divideRoundHalfUp(1n, 2n)).toBe(1n);
    expect(divideRoundHalfUp(1n, 3n)).toBe(0n);
    expect(divideRoundHalfUp(2n, 3n)).toBe(1n);
    expect(divideRoundHalfUp(-1n, 2n)).toBe(-1n);
  });
});
