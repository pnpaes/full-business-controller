import { describe, expect, it } from "vitest";

import { DomainError, NotFoundError } from "./errors";

describe("NotFoundError", () => {
  it("is a DomainError with a distinct name", () => {
    const error = new NotFoundError("item not found");
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.name).toBe("NotFoundError");
    expect(error.message).toBe("item not found");
  });
});
