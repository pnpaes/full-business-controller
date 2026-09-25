import type { AuditInput } from "../auth";

import type { TaxRuleRecord } from "./read-types";
import type { NewTaxRuleRecord, TaxScopeRef, TaxWriteStore } from "./write-types";

/**
 * In-memory `TaxWriteStore` for the unit suite. It mirrors the observable
 * contract (org-scoped lookups, the code uniqueness, the id-targeted
 * `effective_to` write) closely enough to exercise the commands without a
 * database; the postgres adapter is covered by the routes' integration path and
 * the resolver's existing tests.
 */
export class FakeTaxWriteStore implements TaxWriteStore {
  readonly taxRules: TaxRuleRecord[] = [];
  readonly channels = new Map<string, TaxScopeRef>();
  readonly locations = new Map<string, TaxScopeRef>();
  readonly audits: AuditInput[] = [];

  private sequence = 0;

  async withTransaction<T>(fn: (store: TaxWriteStore) => Promise<T>): Promise<T> {
    return fn(this);
  }

  findTaxRuleByCode(organizationId: string, code: string): Promise<TaxRuleRecord | undefined> {
    return Promise.resolve(
      this.taxRules.find((rule) => rule.organizationId === organizationId && rule.code === code),
    );
  }

  findTaxRuleById(taxRuleId: string): Promise<TaxRuleRecord | undefined> {
    return Promise.resolve(this.taxRules.find((rule) => rule.id === taxRuleId));
  }

  listTaxRulesByApplicability(
    organizationId: string,
    appliesTo: string,
  ): Promise<readonly TaxRuleRecord[]> {
    return Promise.resolve(
      this.taxRules.filter(
        (rule) => rule.organizationId === organizationId && rule.appliesTo === appliesTo,
      ),
    );
  }

  listTaxRulesWithWindows(organizationId: string): Promise<readonly TaxRuleRecord[]> {
    return Promise.resolve(
      this.taxRules
        .filter((rule) => rule.organizationId === organizationId)
        .sort((a, b) => a.code.localeCompare(b.code) || a.id.localeCompare(b.id)),
    );
  }

  findChannelScope(channelId: string): Promise<TaxScopeRef | undefined> {
    return Promise.resolve(this.channels.get(channelId));
  }

  findLocationScope(locationId: string): Promise<TaxScopeRef | undefined> {
    return Promise.resolve(this.locations.get(locationId));
  }

  createTaxRule(input: NewTaxRuleRecord): Promise<TaxRuleRecord> {
    this.sequence += 1;
    const record: TaxRuleRecord = { id: `tax-rule-${this.sequence}`, ...input };
    this.taxRules.push(record);
    return Promise.resolve(record);
  }

  endTaxRule(
    organizationId: string,
    taxRuleId: string,
    effectiveTo: Date,
  ): Promise<TaxRuleRecord | undefined> {
    const index = this.taxRules.findIndex(
      (rule) => rule.id === taxRuleId && rule.organizationId === organizationId,
    );
    if (index === -1) {
      return Promise.resolve(undefined);
    }
    const current = this.taxRules[index]!;
    if (current.effectiveTo !== null) {
      return Promise.resolve(undefined);
    }
    const updated: TaxRuleRecord = { ...current, effectiveTo };
    this.taxRules[index] = updated;
    return Promise.resolve(updated);
  }

  writeAudit(input: AuditInput): Promise<void> {
    this.audits.push(input);
    return Promise.resolve();
  }
}
