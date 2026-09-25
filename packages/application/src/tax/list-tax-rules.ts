import { DomainError } from "@aquarela/domain";

import type { TaxReadStore, TaxRuleSummaryRecord } from "./read-types";

/** Page size when the caller does not ask for one. */
export const DEFAULT_TAX_RULE_LIMIT = 50;
/** Hard cap so a caller cannot ask the store for the whole register in one page. */
export const MAX_TAX_RULE_LIMIT = 200;

export interface ListTaxRulesQuery {
  readonly organizationId: string;
  /** Absent = every applicability; present = that `applies_to` only. */
  readonly appliesTo?: string;
  /** Absent = every scope; present = that `scope_type` only. */
  readonly scopeType?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * The organization's tax rules (`DATA_DICTIONARY` §1, PRICE-005), ordered by
 * `code` (then `id`), with optional applicability/scope filters. The
 * organization filter is never optional, so a caller cannot read another
 * tenant's rules (`DEC-061`); `limit` defaults to `DEFAULT_TAX_RULE_LIMIT` and
 * is validated against `MAX_TAX_RULE_LIMIT` so a caller cannot request the
 * whole register unbounded. Cross-organization rows are dropped as defence in
 * depth on top of the store's own filter.
 *
 * The projection is deliberately the summary (`TaxRuleSummaryRecord`): the
 * picker needs a `code · name` label, the rate, the basis and the
 * applicability — not the scope columns or the effective window.
 */
export async function listTaxRules(
  store: TaxReadStore,
  query: ListTaxRulesQuery,
): Promise<readonly TaxRuleSummaryRecord[]> {
  const limit = query.limit ?? DEFAULT_TAX_RULE_LIMIT;
  const offset = query.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_TAX_RULE_LIMIT) {
    throw new DomainError(`limit must be an integer between 1 and ${MAX_TAX_RULE_LIMIT}`);
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new DomainError("offset must be a non-negative integer");
  }

  const rows = await store.listTaxRules({
    organizationId: query.organizationId,
    ...(query.appliesTo === undefined ? {} : { appliesTo: query.appliesTo }),
    ...(query.scopeType === undefined ? {} : { scopeType: query.scopeType }),
    limit,
    offset,
  });
  return rows.filter((rule) => rule.organizationId === query.organizationId);
}
