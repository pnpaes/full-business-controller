import { describe, expect, it } from "vitest";

import { nextDocumentVersionNumber } from "./documents";

describe("nextDocumentVersionNumber", () => {
  it("returns 1 for a document with no versions", () => {
    expect(nextDocumentVersionNumber([])).toBe(1);
  });

  it("returns the greatest version plus one", () => {
    expect(nextDocumentVersionNumber([{ version: 1 }, { version: 4 }, { version: 2 }])).toBe(5);
  });

  it("ignores input ordering", () => {
    expect(nextDocumentVersionNumber([{ version: 7 }, { version: 1 }])).toBe(8);
    expect(nextDocumentVersionNumber([{ version: 1 }, { version: 7 }])).toBe(8);
  });
});
