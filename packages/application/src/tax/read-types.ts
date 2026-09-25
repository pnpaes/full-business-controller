/**
 * Read-side port for the tax-rule master data (`DATA_DICTIONARY` §1,
 * PRICE-005). The `tax_rule` table already exists and is referenced by
 * `sales_line`, `supplier_price`, `channel_fee_rule` and `goods_receipt_line`,
 * but nothing read or resolved it, so the UI had no way to choose one and
 * `recordGoodsReceipt` forced the caller to supply recoverable tax by hand.
 *
 * Two projections: a bounded display summary for the picker, and the full row
 * (scope columns + effective window) for `resolveTaxRule`. `timestamptz`
 * columns are `Date` (the costing read adapter's convention); `rate_pct` stays
 * the stored `numeric(9,6)` string and is a **fraction**, not a percent — the
 * domain's `TAX_RATE_SCALE` and every golden fixture store `0.150000` for 15 %
 * (`packages/domain/src/pricing.ts:24`, `tests/fixtures/cheese_bun.json`).
 */
export interface TaxRuleSummaryRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly code: string;
  readonly name: string;
  readonly ratePct: string;
  readonly taxBasis: string;
  readonly taxTreatment: string;
  readonly recoverable: boolean;
  readonly appliesTo: string;
  readonly scopeType: string;
}

/**
 * The full `tax_rule` row `resolveTaxRule` needs: the summary plus the scope
 * narrowing (`locationId`/`channelId`) and the half-open `[effectiveFrom,
 * effectiveTo)` window. `effectiveTo === null` is an open-ended window.
 */
export interface TaxRuleRecord extends TaxRuleSummaryRecord {
  readonly locationId: string | null;
  readonly channelId: string | null;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
}

export interface TaxReadStore {
  /**
   * One bounded page of the organization's tax rules (`DATA_DICTIONARY` §1),
   * ordered by `code` (then `id`). `limit`/`offset` are applied by the store so
   * a caller cannot pull the whole register; the application `listTaxRules`
   * service validates them against `MAX_TAX_RULE_LIMIT` first.
   */
  listTaxRules(query: {
    readonly organizationId: string;
    readonly appliesTo?: string;
    readonly scopeType?: string;
    readonly limit: number;
    readonly offset: number;
  }): Promise<readonly TaxRuleSummaryRecord[]>;

  /**
   * Every `tax_rule` of the organization effective at `asOf` (half-open
   * `[effectiveFrom, effectiveTo)`), ordered by `code` (then `id`). The
   * `resolveTaxRule` service applies the DEC-045 precedence over this set.
   */
  listEffectiveTaxRules(query: {
    readonly organizationId: string;
    readonly asOf: Date;
    readonly appliesTo?: string;
  }): Promise<readonly TaxRuleRecord[]>;
}
