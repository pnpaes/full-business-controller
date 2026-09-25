import type { TaxRuleRecord } from "./read-types";
import type { TaxWriteStore } from "./write-types";

export interface ListTaxRuleRegisterQuery {
  readonly organizationId: string;
}

/**
 * The organization's tax rules with their scope columns and effective windows,
 * ordered by `code` — the register behind the Administration authoring screen.
 *
 * Unlike `listTaxRules` (the bounded picker summary) this carries
 * `effectiveFrom`/`effectiveTo` so the screen can state an effective status at
 * one `asOf`. The organization filter is never optional (`DEC-061`) and
 * cross-organization rows are dropped as defence in depth on top of the store's
 * own filter.
 */
export async function listTaxRuleRegister(
  store: TaxWriteStore,
  query: ListTaxRuleRegisterQuery,
): Promise<readonly TaxRuleRecord[]> {
  const rows = await store.listTaxRulesWithWindows(query.organizationId);
  return rows.filter((rule) => rule.organizationId === query.organizationId);
}
