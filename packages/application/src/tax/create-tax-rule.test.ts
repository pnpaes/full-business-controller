import { DomainError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { createTaxRule } from "./create-tax-rule";
import { FakeTaxWriteStore } from "./test-support";

const ORG = "org-1";
const ACTOR = "user-1";
const CHANNEL = "chan-1";
const LOCATION = "loc-1";
const FROM = "2026-01-01T00:00:00.000Z";

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG,
    actorId: ACTOR,
    code: "NO_VAT_FOOD",
    name: "Food 15%",
    ratePct: "0.150000",
    taxBasis: "inclusive",
    taxTreatment: "channel_overridable",
    appliesTo: "product",
    scopeType: "company_wide",
    effectiveFrom: FROM,
    ...overrides,
  };
}

describe("createTaxRule", () => {
  it("creates a canonical rule and audits it", async () => {
    const store = new FakeTaxWriteStore();

    const result = await createTaxRule(store, baseInput({ ratePct: "0.15" }));

    expect(store.taxRules).toEqual([
      expect.objectContaining({
        id: result.taxRuleId,
        organizationId: ORG,
        code: "NO_VAT_FOOD",
        name: "Food 15%",
        ratePct: "0.150000",
        taxBasis: "inclusive",
        taxTreatment: "channel_overridable",
        recoverable: false,
        appliesTo: "product",
        scopeType: "company_wide",
        locationId: null,
        channelId: null,
      }),
    ]);
    expect(store.audits.at(-1)).toMatchObject({
      action: "tax.tax_rule.created",
      entityType: "tax_rule",
      entityId: result.taxRuleId,
    });
  });

  it("rejects a duplicate code for the organization", async () => {
    const store = new FakeTaxWriteStore();
    await createTaxRule(store, baseInput());

    await expect(createTaxRule(store, baseInput({ name: "Second" }))).rejects.toThrow(
      /code "NO_VAT_FOOD" already exists/,
    );
  });

  it("accepts a fraction at the 6 dp scale and rejects a percent-shaped value", async () => {
    const store = new FakeTaxWriteStore();
    await createTaxRule(store, baseInput({ code: "FIFTEEN", ratePct: "0.150000" }));
    expect(store.taxRules.at(-1)?.ratePct).toBe("0.150000");

    await expect(
      createTaxRule(store, baseInput({ code: "PERCENT", ratePct: "15" })),
    ).rejects.toThrow(/must be a fraction between 0 and 1/);
    await expect(
      createTaxRule(store, baseInput({ code: "NEG", ratePct: "-0.100000" })),
    ).rejects.toThrow(/must not be negative/);
    await expect(
      createTaxRule(store, baseInput({ code: "PRECISE", ratePct: "0.1234567" })),
    ).rejects.toThrow(DomainError);
  });

  it("rejects an out-of-vocabulary basis, treatment, applicability or scope", async () => {
    const store = new FakeTaxWriteStore();
    await expect(createTaxRule(store, baseInput({ taxBasis: "gross" }))).rejects.toThrow(
      /taxBasis must be one of/,
    );
    await expect(createTaxRule(store, baseInput({ taxTreatment: "guessed" }))).rejects.toThrow(
      /taxTreatment must be one of/,
    );
    await expect(createTaxRule(store, baseInput({ appliesTo: "everything" }))).rejects.toThrow(
      /appliesTo must be one of/,
    );
    await expect(createTaxRule(store, baseInput({ scopeType: "galaxy" }))).rejects.toThrow(
      /scopeType must be one of/,
    );
  });

  it("rejects a non-advancing effective window", async () => {
    const store = new FakeTaxWriteStore();
    await expect(
      createTaxRule(store, baseInput({ effectiveTo: "2025-01-01T00:00:00.000Z" })),
    ).rejects.toThrow(/effectiveTo must be after effectiveFrom/);
    await expect(createTaxRule(store, baseInput({ effectiveTo: FROM }))).rejects.toThrow(
      /effectiveTo must be after effectiveFrom/,
    );
  });

  it("rejects an overlap and names the conflicting rule", async () => {
    const store = new FakeTaxWriteStore();
    await createTaxRule(
      store,
      baseInput({ code: "FIRST", effectiveTo: "2026-06-01T00:00:00.000Z" }),
    );

    await expect(
      createTaxRule(
        store,
        baseInput({ code: "SECOND", effectiveFrom: "2026-03-01T00:00:00.000Z" }),
      ),
    ).rejects.toThrow(/tax rule "FIRST" is already effective over this window/);

    // Half-open: the successor may start exactly when the first ends.
    const successor = await createTaxRule(
      store,
      baseInput({ code: "SECOND", effectiveFrom: "2026-06-01T00:00:00.000Z" }),
    );
    expect(successor.taxRuleId).toBeDefined();
  });

  it("scopes the overlap check to the applicability and scope key", async () => {
    const store = new FakeTaxWriteStore();
    await createTaxRule(
      store,
      baseInput({ code: "PRODUCT", effectiveTo: "2026-06-01T00:00:00.000Z" }),
    );

    // A different applicability may overlap the same window.
    await createTaxRule(
      store,
      baseInput({
        code: "FEE",
        appliesTo: "fee",
        effectiveFrom: "2026-03-01T00:00:00.000Z",
      }),
    );

    // A channel-scoped rule is a different key from the org-wide one.
    store.channels.set(CHANNEL, { id: CHANNEL, organizationId: ORG });
    await createTaxRule(
      store,
      baseInput({
        code: "CHANNEL",
        scopeType: "channel",
        channelId: CHANNEL,
        effectiveFrom: "2026-03-01T00:00:00.000Z",
      }),
    );
  });

  it("refuses an overlap across the organization/company_wide equivalence (M1)", async () => {
    const store = new FakeTaxWriteStore();
    await createTaxRule(store, baseInput({ code: "ORG", scopeType: "organization" }));

    // The resolver buckets `organization` and `company_wide` together and fails
    // closed when both are effective, so the guard must treat them as one key.
    await expect(
      createTaxRule(store, baseInput({ code: "WIDE", scopeType: "company_wide" })),
    ).rejects.toThrow(/tax rule "ORG" is already effective over this window/);
  });

  it("refuses a channel-scoped/location-scoped overlap for one applicability (M1)", async () => {
    const store = new FakeTaxWriteStore();
    store.channels.set(CHANNEL, { id: CHANNEL, organizationId: ORG });
    store.locations.set(LOCATION, { id: LOCATION, organizationId: ORG });
    await createTaxRule(
      store,
      baseInput({ code: "BY_CHANNEL", scopeType: "channel", channelId: CHANNEL }),
    );

    // `recordGoodsReceipt` passes both ids, so this pair makes the resolver
    // refuse every scope-only resolution (no documented precedence).
    await expect(
      createTaxRule(
        store,
        baseInput({ code: "BY_LOCATION", scopeType: "location", locationId: LOCATION }),
      ),
    ).rejects.toThrow(/tax rule "BY_CHANNEL" is already effective over this window/);
  });

  it("refuses scopeType storage, which the resolver has no arm for (M3)", async () => {
    const store = new FakeTaxWriteStore();
    await expect(createTaxRule(store, baseInput({ scopeType: "storage" }))).rejects.toThrow(
      /scopeType "storage" is not supported for tax rules/,
    );
    expect(store.taxRules).toHaveLength(0);
  });

  it("rejects a channel or location from another organization", async () => {
    const store = new FakeTaxWriteStore();
    store.channels.set(CHANNEL, { id: CHANNEL, organizationId: "org-2" });
    store.locations.set(LOCATION, { id: LOCATION, organizationId: "org-2" });

    await expect(
      createTaxRule(store, baseInput({ scopeType: "channel", channelId: CHANNEL })),
    ).rejects.toThrow(/channel not found in organization/);
    await expect(
      createTaxRule(store, baseInput({ scopeType: "location", locationId: LOCATION })),
    ).rejects.toThrow(/location not found in organization/);
  });

  it("requires the scope id its scope type implies and forbids the other", async () => {
    const store = new FakeTaxWriteStore();
    await expect(createTaxRule(store, baseInput({ scopeType: "channel" }))).rejects.toThrow(
      /channelId is required/,
    );
    await expect(createTaxRule(store, baseInput({ scopeType: "location" }))).rejects.toThrow(
      /locationId is required/,
    );
    await expect(
      createTaxRule(store, baseInput({ scopeType: "company_wide", channelId: CHANNEL })),
    ).rejects.toThrow(/channelId must be null/);
    await expect(
      createTaxRule(store, baseInput({ scopeType: "company_wide", locationId: LOCATION })),
    ).rejects.toThrow(/locationId must be null/);
  });
});
