import { describe, expect, it } from "vitest";

import { DomainError } from "./errors";
import { isReadingInRange } from "./monitoring";

describe("isReadingInRange", () => {
  it("accepts a reading within the target range", () => {
    expect(isReadingInRange("2", "0", "4")).toBe(true);
  });

  it("accepts a reading exactly on either inclusive bound", () => {
    expect(isReadingInRange("0", "0", "4")).toBe(true);
    expect(isReadingInRange("4", "0", "4")).toBe(true);
  });

  it("rejects a reading below the minimum or above the maximum", () => {
    expect(isReadingInRange("-0.5", "0", "4")).toBe(false);
    expect(isReadingInRange("4.5", "0", "4")).toBe(false);
  });

  it("handles negative targets (a freezer's −18 °C band)", () => {
    expect(isReadingInRange("-18", "-20", "-16")).toBe(true);
    expect(isReadingInRange("-22", "-20", "-16")).toBe(false);
  });

  it("rejects an inverted target range as a misconfigured point", () => {
    expect(() => isReadingInRange("2", "4", "0")).toThrow(DomainError);
  });

  it("rejects a value with more precision than the quantity scale", () => {
    expect(() => isReadingInRange("1.0000001", "0", "4")).toThrow(DomainError);
  });
});
