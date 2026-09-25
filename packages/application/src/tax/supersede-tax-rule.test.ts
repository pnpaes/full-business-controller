import { DomainError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { FakeCostingReadStore } from "../costing/read-test-support";

import { createTaxRule } from "./create-tax-rule";
import { resolveTaxRule } from "./resolve-tax-rule";
import { supersedeTaxRule } from "./supersede-tax-rule";
import { FakeTaxWriteStore } from "./test-support";

const ORG = "org-1";
const ACTOR = "user-1";
const FROM = "2026-01-01T00:00:00.000Z";
const END = "2026-06-01T00:00:00.000Z";

async function seedRule(store: FakeTaxWriteStore): Promise<string> {
  const result = await createTaxRule(store, {
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
  });
  return result.taxRuleId;
}

describe("supersedeTaxRule", () => {
  it("sets effective_to and the rule stops being effective from that instant", async () => {
    const store = new FakeTaxWriteStore();
    const taxRuleId = await seedRule(store);

    const result = await supersedeTaxRule(store, {
      organizationId: ORG,
      actorId: ACTOR,
      taxRuleId,
      effectiveTo: END,
    });

    expect(result).toEqual({ taxRuleId, effectiveTo: END });
    const ended = store.taxRules.find((rule) => rule.id === taxRuleId)!;
    expect(ended.effectiveTo?.toISOString()).toBe(END);
    expect(store.audits.at(-1)).toMatchObject({
      action: "tax.tax_rule.superseded",
      entityType: "tax_rule",
      entityId: taxRuleId,
      before: { effective_to: null },
      after: { effective_to: END },
    });

    // The end date is honoured by the resolver's half-open window: effective
    // just before it, refused at and after it.
    const readStore = new FakeCostingReadStore();
    readStore.taxRules.set(ended.id, ended);
    await expect(
      resolveTaxRule(readStore, {
        organizationId: ORG,
        asOf: new Date("2026-05-31T23:59:59.999Z"),
      }),
    ).resolves.toMatchObject({ ratePct: "0.150000" });
    await expect(
      resolveTaxRule(readStore, { organizationId: ORG, asOf: new Date(END) }),
    ).rejects.toThrow(/no effective tax rule/);
  });

  it("refuses a rule that has already ended", async () => {
    const store = new FakeTaxWriteStore();
    const taxRuleId = await seedRule(store);
    await supersedeTaxRule(store, {
      organizationId: ORG,
      actorId: ACTOR,
      taxRuleId,
      effectiveTo: END,
    });

    await expect(
      supersedeTaxRule(store, {
        organizationId: ORG,
        actorId: ACTOR,
        taxRuleId,
        effectiveTo: "2027-01-01T00:00:00.000Z",
      }),
    ).rejects.toThrow(/already ended/);
  });

  it("refuses an end at or before the rule's effective_from", async () => {
    const store = new FakeTaxWriteStore();
    const taxRuleId = await seedRule(store);

    await expect(
      supersedeTaxRule(store, {
        organizationId: ORG,
        actorId: ACTOR,
        taxRuleId,
        effectiveTo: FROM,
      }),
    ).rejects.toThrow(/effectiveTo must be after the rule's effectiveFrom/);
    await expect(
      supersedeTaxRule(store, {
        organizationId: ORG,
        actorId: ACTOR,
        taxRuleId,
        effectiveTo: "2025-12-31T00:00:00.000Z",
      }),
    ).rejects.toThrow(/effectiveTo must be after the rule's effectiveFrom/);
  });

  it("rejects an unknown or cross-organization rule and a malformed instant", async () => {
    const store = new FakeTaxWriteStore();
    const taxRuleId = await seedRule(store);

    await expect(
      supersedeTaxRule(store, {
        organizationId: "org-2",
        actorId: ACTOR,
        taxRuleId,
        effectiveTo: END,
      }),
    ).rejects.toThrow(/not found in organization/);
    await expect(
      supersedeTaxRule(store, {
        organizationId: ORG,
        actorId: ACTOR,
        taxRuleId: "missing",
        effectiveTo: END,
      }),
    ).rejects.toThrow(/not found in organization/);
    await expect(
      supersedeTaxRule(store, {
        organizationId: ORG,
        actorId: ACTOR,
        taxRuleId,
        effectiveTo: "2026-06-01",
      }),
    ).rejects.toThrow(DomainError);
  });
});
