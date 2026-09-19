import { describe, expect, it } from "vitest";
import { contrastRatio, relativeLuminance } from "./contrast";

describe("relativeLuminance", () => {
  it("returns 0 for black and 1 for white", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBe(1);
  });

  it("is case- and shorthand-insensitive", () => {
    expect(relativeLuminance("#FFF")).toBe(relativeLuminance("#FFFFFF"));
    expect(relativeLuminance("abc")).toBe(relativeLuminance("#AABBCC"));
  });

  it("throws on invalid input", () => {
    expect(() => relativeLuminance("#12345")).toThrow();
    expect(() => relativeLuminance("not-a-color")).toThrow();
  });

  it("matches the WCAG published value for a known colour", () => {
    // WCAG example: #797979 relative luminance ≈ 0.1912
    expect(relativeLuminance("#797979")).toBeCloseTo(0.1912, 2);
  });
});

describe("contrastRatio", () => {
  it("is symmetric and at least 1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBe(21);
    expect(contrastRatio("#ffffff", "#000000")).toBe(21);
    expect(contrastRatio("#8e2a4f", "#1f6b3a")).toBe(contrastRatio("#1f6b3a", "#8e2a4f"));
  });

  it("a colour against itself has ratio 1", () => {
    expect(contrastRatio("#8e2a4f", "#8e2a4f")).toBe(1);
  });
});
