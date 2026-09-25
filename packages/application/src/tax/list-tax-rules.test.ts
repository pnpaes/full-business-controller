import { DomainError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { FakeCostingReadStore } from "../costing/read-test-support";

import { DEFAULT_TAX_RULE_LIMIT, MAX_TAX_RULE_LIMIT, listTaxRules } from "./list-tax-rules";
import type { TaxRuleRecord } from "./read-types";

function taxRule(
  overrides: Partial<TaxRuleRecord> & {
    readonly id: string;
    readonly organizationId: string;
    readonly code: string;
  },
): TaxRuleRecord {
  return {
    name: overrides.code,
    ratePct: "0.150000",
    taxBasis: "exclusive",
    taxTreatment: "channel_overridable",
    recoverable: false,
    appliesTo: "product",
    scopeType: "company_wide",
    locationId: null,
    channelId: null,
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveTo: null,
    ...overrides,
  };
}

function buildStore(): FakeCostingReadStore {
  const store = new FakeCostingReadStore();
  store.taxRules.set(
    "tax-alpha",
    taxRule({ id: "tax-alpha", organizationId: "org", code: "ALPHA", appliesTo: "product" }),
  );
  store.taxRules.set(
    "tax-zulu",
    taxRule({
      id: "tax-zulu",
      organizationId: "org",
      code: "ZULU",
      appliesTo: "fee",
      scopeType: "channel",
      channelId: "chan-1",
    }),
  );
  store.taxRules.set(
    "tax-foreign",
    taxRule({ id: "tax-foreign", organizationId: "org-other", code: "AAA" }),
  );
  return store;
}

describe("listTaxRules", () => {
  it("returns only the organization's rules ordered by code", async () => {
    const store = buildStore();
    const rows = await listTaxRules(store, { organizationId: "org" });
    expect(rows.map((row) => row.code)).toEqual(["ALPHA", "ZULU"]);
    expect(DEFAULT_TAX_RULE_LIMIT).toBe(50);
  });

  it("filters by appliesTo and scopeType", async () => {
    const store = buildStore();
    const fees = await listTaxRules(store, { organizationId: "org", appliesTo: "fee" });
    expect(fees.map((row) => row.code)).toEqual(["ZULU"]);

    const channelScoped = await listTaxRules(store, {
      organizationId: "org",
      scopeType: "channel",
    });
    expect(channelScoped.map((row) => row.code)).toEqual(["ZULU"]);
  });

  it("applies the offset over the bounded page", async () => {
    const store = buildStore();
    const rows = await listTaxRules(store, { organizationId: "org", limit: 1, offset: 1 });
    expect(rows.map((row) => row.code)).toEqual(["ZULU"]);
  });

  it("returns the bounded summary, never the full scope/effective columns", async () => {
    const store = buildStore();
    const [row] = await listTaxRules(store, { organizationId: "org" });
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty("locationId");
    expect(row).not.toHaveProperty("effectiveFrom");
  });

  it("rejects an out-of-range limit and a negative offset", async () => {
    const store = buildStore();
    await expect(listTaxRules(store, { organizationId: "org", limit: 0 })).rejects.toThrow(
      DomainError,
    );
    await expect(
      listTaxRules(store, { organizationId: "org", limit: MAX_TAX_RULE_LIMIT + 1 }),
    ).rejects.toThrow(DomainError);
    await expect(listTaxRules(store, { organizationId: "org", offset: -1 })).rejects.toThrow(
      DomainError,
    );
  });
});
