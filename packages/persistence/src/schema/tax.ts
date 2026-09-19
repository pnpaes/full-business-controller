import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  date,
  numeric,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { effectiveRange, enumCheck, money, orgId, rangeCheck, rate, tstz, uuidPk } from "./columns";
import { channel, location, organization } from "./organization";
import {
  FEE_BASIS,
  FEE_KIND,
  SCOPE_TYPE,
  TAX_APPLIES_TO,
  TAX_BASIS,
  TAX_TREATMENT,
} from "./vocabularies";

export const taxRule = pgTable(
  "tax_rule",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    ratePct: rate("rate_pct").notNull(),
    taxTreatment: text("tax_treatment").notNull().default("channel_overridable"),
    taxBasis: text("tax_basis").notNull(),
    recoverable: boolean("recoverable").notNull().default(false),
    appliesTo: text("applies_to").notNull(),
    scopeType: text("scope_type").notNull().default("company_wide"),
    locationId: uuid("location_id").references(() => location.id),
    channelId: uuid("channel_id").references(() => channel.id),
    ...effectiveRange(),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("tax_rule_rate_pct_check", sql`${t.ratePct} >= 0`),
    check("tax_rule_tax_treatment_check", enumCheck(t.taxTreatment, TAX_TREATMENT)),
    check("tax_rule_tax_basis_check", enumCheck(t.taxBasis, TAX_BASIS)),
    check("tax_rule_applies_to_check", enumCheck(t.appliesTo, TAX_APPLIES_TO)),
    check("tax_rule_scope_type_check", enumCheck(t.scopeType, SCOPE_TYPE)),
    check("tax_rule_effective_range_check", rangeCheck(t.effectiveFrom, t.effectiveTo)),
    unique("tax_rule_organization_id_code_key").on(t.organizationId, t.code),
  ],
);

export const channelFeeRule = pgTable(
  "channel_fee_rule",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channel.id),
    feeKind: text("fee_kind").notNull(),
    percentageRate: rate("percentage_rate"),
    fixedAmount: money("fixed_amount"),
    feeBasis: text("fee_basis").notNull(),
    taxRuleId: uuid("tax_rule_id").references(() => taxRule.id),
    ...effectiveRange(),
  },
  (t) => [
    check("channel_fee_rule_fee_kind_check", enumCheck(t.feeKind, FEE_KIND)),
    check("channel_fee_rule_fee_basis_check", enumCheck(t.feeBasis, FEE_BASIS)),
    check(
      "channel_fee_rule_percentage_rate_check",
      sql`${t.percentageRate} is null or ${t.percentageRate} >= 0`,
    ),
    check(
      "channel_fee_rule_fixed_amount_check",
      sql`${t.fixedAmount} is null or ${t.fixedAmount} >= 0`,
    ),
    check("channel_fee_rule_effective_range_check", rangeCheck(t.effectiveFrom, t.effectiveTo)),
    check(
      "channel_fee_rule_amount_kind_check",
      sql`case ${t.feeKind}
        when 'commission_pct' then ${t.percentageRate} is not null and ${t.fixedAmount} is null
        when 'processing_pct' then ${t.percentageRate} is not null and ${t.fixedAmount} is null
        when 'fixed_per_order' then ${t.fixedAmount} is not null and ${t.percentageRate} is null
        when 'delivery_subsidy' then ${t.fixedAmount} is not null and ${t.percentageRate} is null
        when 'discount_funding' then ${t.fixedAmount} is not null and ${t.percentageRate} is null
        else false
      end`,
    ),
    // channel_fee_rule_no_overlap (exclusion constraint) is emitted in the raw
    // `invariants` migration: drizzle-kit 0.30 cannot express exclusion constraints.
  ],
);

export const exchangeRate = pgTable(
  "exchange_rate",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    baseCurrency: char("base_currency", { length: 3 }).notNull(),
    quoteCurrency: char("quote_currency", { length: 3 }).notNull(),
    rate: numeric("rate", { precision: 19, scale: 10 }).notNull(),
    rateDate: date("rate_date").notNull(),
    source: text("source").notNull().default("norges_bank"),
  },
  (t) => [
    check("exchange_rate_rate_check", sql`${t.rate} > 0`),
    unique("exchange_rate_org_pair_date_key").on(
      t.organizationId,
      t.baseCurrency,
      t.quoteCurrency,
      t.rateDate,
    ),
  ],
);
