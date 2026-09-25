import { describe, expect, it } from "vitest";

import { listTaxRuleRegister } from "./list-tax-rule-register";
import { FakeTaxWriteStore } from "./test-support";

const ORG = "org-1";
const FROM = new Date("2026-01-01T00:00:00.000Z");

function rule(id: string, organizationId: string, code: string) {
  return {
    id,
    organizationId,
    code,
    name: code,
    ratePct: "0.150000",
    taxBasis: "inclusive",
    taxTreatment: "channel_overridable",
    recoverable: false,
    appliesTo: "product",
    scopeType: "company_wide",
    locationId: null,
    channelId: null,
    effectiveFrom: FROM,
    effectiveTo: null,
  };
}

describe("listTaxRuleRegister", () => {
  it("returns only the organization's rules, ordered by code, with windows", async () => {
    const store = new FakeTaxWriteStore();
    store.taxRules.push(rule("b", ORG, "ZULU"), rule("a", ORG, "ALPHA"), rule("c", "org-2", "AAA"));

    const rows = await listTaxRuleRegister(store, { organizationId: ORG });

    expect(rows.map((row) => row.code)).toEqual(["ALPHA", "ZULU"]);
    expect(rows[0]).toHaveProperty("effectiveFrom");
    expect(rows[0]).toHaveProperty("effectiveTo");
  });
});
