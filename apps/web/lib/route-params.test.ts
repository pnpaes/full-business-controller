import { describe, expect, it } from "vitest";

import { uuidOrNotFound } from "./route-params";

const VALID = "3bece9e8-ee3d-41e5-b340-dacba03c7855";

describe("uuidOrNotFound", () => {
  it("returns a valid UUID unchanged", () => {
    expect(uuidOrNotFound(VALID)).toBe(VALID);
  });

  it("accepts an uppercase UUID", () => {
    const upper = VALID.toUpperCase();
    expect(uuidOrNotFound(upper)).toBe(upper);
  });

  it("renders 404 for a wrong-length string", () => {
    expect(() => uuidOrNotFound("3bece9e8-ee3d-41e5-b340-dacba03c785")).toThrow();
  });

  it("renders 404 for a non-hex string", () => {
    expect(() => uuidOrNotFound("zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz")).toThrow();
  });

  it("trims surrounding whitespace around a valid UUID", () => {
    expect(uuidOrNotFound(`  ${VALID}  `)).toBe(VALID);
  });
});
