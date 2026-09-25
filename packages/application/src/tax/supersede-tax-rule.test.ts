import { DomainError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { FakeCostingReadStore } from "../costing/read-test-support";

import { createTaxRule } from "./create-tax-rule";
import type { TaxRuleRecord } from "./read-types";
import { resolveTaxRule } from "./resolve-tax-rule";
import { supersedeTaxRule } from "./supersede-tax-rule";
import { FakeTaxWriteStore } from "./test-support";

/**
 * Models the two-transaction race M2: the command's pre-read (`findTaxRuleById`)
 * still shows the rule open, while the conditional write sees the end a
 * concurrent supersede committed, matches zero rows and reports `undefined`.
 */
class ConcurrentlyEndedStore extends FakeTaxWriteStore {
  override findTaxRuleById(taxRuleId: string): Promise<TaxRuleRecord | undefined> {
    const rule = this.taxRules.find((candidate) => candidate.id === taxRuleId);
    return Promise.resolve(rule === undefined ? undefined : { ...rule, effectiveTo: null });
  }

  override endTaxRule(
    organizationId: string,
    taxRuleId: string,
    effectiveTo: Date,
  ): Promise<TaxRuleRecord | undefined> {
    const index = this.taxRules.findIndex(
      (rule) => rule.id === taxRuleId && rule.organizationId === organizationId,
    );
    const current = index === -1 ? undefined : this.taxRules[index]!;
    if (current === undefined || current.effectiveTo !== null) {
      return Promise.resolve(undefined);
    }
    const updated: TaxRuleRecord = { ...current, effectiveTo };
    this.taxRules[index] = updated;
    return Promise.resolve(updated);
  }
}

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

  it("refuses a supersede that loses the concurrent write as already ended (M2)", async () => {
    const store = new ConcurrentlyEndedStore();
    const taxRuleId = await seedRule(store);
    const concurrentEnd = new Date(END);
    store.taxRules[0] = { ...store.taxRules[0]!, effectiveTo: concurrentEnd };

    await expect(
      supersedeTaxRule(store, {
        organizationId: ORG,
        actorId: ACTOR,
        taxRuleId,
        effectiveTo: "2027-01-01T00:00:00.000Z",
      }),
    ).rejects.toThrow(/already ended/);

    // The first end is untouched and no superseded audit was written.
    expect(store.taxRules[0]!.effectiveTo?.toISOString()).toBe(END);
    expect(store.audits.some((audit) => audit.action === "tax.tax_rule.superseded")).toBe(false);
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
