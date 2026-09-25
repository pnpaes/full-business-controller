import { DomainError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { FakeCostingReadStore } from "../costing/read-test-support";

import type { TaxRuleRecord } from "./read-types";
import { resolveTaxRule } from "./resolve-tax-rule";

const AS_OF = new Date("2026-06-01T12:00:00.000Z");
const ORG = "org";

function taxRule(overrides: Partial<TaxRuleRecord> & { readonly id: string }): TaxRuleRecord {
  return {
    organizationId: ORG,
    code: overrides.id,
    name: overrides.id,
    ratePct: "0.250000",
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

function storeWith(rules: readonly TaxRuleRecord[]): FakeCostingReadStore {
  const store = new FakeCostingReadStore();
  for (const rule of rules) {
    store.taxRules.set(rule.id, rule);
  }
  return store;
}

describe("resolveTaxRule", () => {
  it("takes a fixed item rate over any channel override (DEC-045 step 1)", async () => {
    const store = storeWith([
      taxRule({ id: "book", taxTreatment: "fixed", appliesTo: "product", ratePct: "0.000000" }),
      taxRule({
        id: "eat-in",
        taxTreatment: "channel_overridable",
        scopeType: "channel",
        channelId: "chan-in",
        ratePct: "0.250000",
      }),
    ]);

    const resolved = await resolveTaxRule(store, {
      organizationId: ORG,
      asOf: AS_OF,
      itemTaxRuleId: "book",
      channelId: "chan-in",
    });

    expect(resolved.source).toBe("fixed");
    expect(resolved.rule.id).toBe("book");
    expect(resolved.ratePct).toBe("0.000000");
  });

  it("uses the channel-scoped override for a channel_overridable item (DEC-045 step 2)", async () => {
    const store = storeWith([
      taxRule({ id: "food-default", appliesTo: "product" }),
      taxRule({
        id: "takeaway",
        appliesTo: "product",
        scopeType: "channel",
        channelId: "chan-out",
        ratePct: "0.150000",
      }),
    ]);

    const resolved = await resolveTaxRule(store, {
      organizationId: ORG,
      asOf: AS_OF,
      itemTaxRuleId: "food-default",
      channelId: "chan-out",
    });

    expect(resolved.source).toBe("channel_override");
    expect(resolved.rule.id).toBe("takeaway");
    expect(resolved.ratePct).toBe("0.150000");
  });

  it("falls back to the item default when no channel override is effective", async () => {
    const store = storeWith([
      taxRule({ id: "food-default", appliesTo: "product", ratePct: "0.250000" }),
      taxRule({
        id: "closed",
        appliesTo: "product",
        scopeType: "channel",
        channelId: "chan-out",
        effectiveTo: new Date("2026-05-01T00:00:00.000Z"),
      }),
    ]);

    const resolved = await resolveTaxRule(store, {
      organizationId: ORG,
      asOf: AS_OF,
      itemTaxRuleId: "food-default",
      channelId: "chan-out",
    });

    expect(resolved.source).toBe("default");
    expect(resolved.rule.id).toBe("food-default");
  });

  it("resolves the organization-wide default when the item references no rule", async () => {
    const store = storeWith([taxRule({ id: "org-default", scopeType: "company_wide" })]);

    const resolved = await resolveTaxRule(store, { organizationId: ORG, asOf: AS_OF });

    expect(resolved.source).toBe("default");
    expect(resolved.rule.id).toBe("org-default");
  });

  it("includes effective_from and excludes effective_to (half-open window)", async () => {
    const store = storeWith([
      taxRule({
        id: "window",
        effectiveFrom: AS_OF,
        effectiveTo: new Date("2026-06-02T00:00:00.000Z"),
      }),
    ]);

    await expect(
      resolveTaxRule(store, { organizationId: ORG, asOf: AS_OF }),
    ).resolves.toMatchObject({ rule: { id: "window" } });

    await expect(
      resolveTaxRule(store, {
        organizationId: ORG,
        asOf: new Date("2026-06-02T00:00:00.000Z"),
      }),
    ).rejects.toThrow(DomainError);
  });

  it("refuses when no effective rule matches rather than guessing", async () => {
    const store = storeWith([
      taxRule({ id: "expired", effectiveTo: new Date("2026-05-01T00:00:00.000Z") }),
    ]);

    await expect(resolveTaxRule(store, { organizationId: ORG, asOf: AS_OF })).rejects.toThrow(
      DomainError,
    );
  });

  it("refuses an item rule that is not effective at the requested instant", async () => {
    const store = storeWith([
      taxRule({ id: "future", effectiveFrom: new Date("2026-07-01T00:00:00.000Z") }),
    ]);

    await expect(
      resolveTaxRule(store, { organizationId: ORG, asOf: AS_OF, itemTaxRuleId: "future" }),
    ).rejects.toThrow(DomainError);
  });

  it("refuses a foreign organization's rule and matches only its own tenant", async () => {
    const store = storeWith([
      taxRule({ id: "mine", organizationId: ORG }),
      taxRule({ id: "theirs", organizationId: "org-other" }),
    ]);

    const resolved = await resolveTaxRule(store, { organizationId: ORG, asOf: AS_OF });
    expect(resolved.rule.id).toBe("mine");
  });

  it("refuses when two channel-scoped rules match", async () => {
    const store = storeWith([
      taxRule({ id: "a", scopeType: "channel", channelId: "chan-1" }),
      taxRule({ id: "b", scopeType: "channel", channelId: "chan-1" }),
    ]);

    await expect(
      resolveTaxRule(store, { organizationId: ORG, asOf: AS_OF, channelId: "chan-1" }),
    ).rejects.toThrow(/ambiguous/);
  });

  it("refuses when a channel-scoped and a location-scoped rule both match (no documented precedence)", async () => {
    const store = storeWith([
      taxRule({ id: "by-channel", scopeType: "channel", channelId: "chan-1" }),
      taxRule({ id: "by-location", scopeType: "location", locationId: "loc-1" }),
    ]);

    await expect(
      resolveTaxRule(store, {
        organizationId: ORG,
        asOf: AS_OF,
        channelId: "chan-1",
        locationId: "loc-1",
      }),
    ).rejects.toThrow(/ambiguous/);
  });

  it("parameterizes the rate to the 6 dp fraction scale", async () => {
    const store = storeWith([taxRule({ id: "rate", ratePct: "0.15" })]);
    const resolved = await resolveTaxRule(store, { organizationId: ORG, asOf: AS_OF });
    expect(resolved.ratePct).toBe("0.150000");
  });
});
