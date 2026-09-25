import { describe, expect, it } from "vitest";

import { TAX_RULE_WRITE_ROLES } from "./access";

describe("TAX_RULE_WRITE_ROLES", () => {
  it("is the owner/admin configuration set from §7.1 and lists owner explicitly (DEC-130)", () => {
    expect(TAX_RULE_WRITE_ROLES).toEqual(["owner", "admin"]);
  });
});
