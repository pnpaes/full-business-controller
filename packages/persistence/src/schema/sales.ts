import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import {
  auditColumns,
  currency,
  enumCheck,
  jsonObject,
  money,
  orgId,
  quantity,
  rangeCheck,
  rate,
  tstz,
  uuidPk,
} from "./columns";
import { channel, location, organization } from "./organization";
import { productVariant } from "./products";
import { taxRule } from "./tax";
import {
  IMPORT_STATUS,
  MAPPING_STATE,
  OPTION_KIND,
  RECONCILIATION_STATUS,
  RECONCILIATION_TOLERANCE_KIND,
} from "./vocabularies";

/*
 * Slices 11–12 — import framework + external mappings + sales/settlements/
 * reconciliation.
 *
 * Slice 11 (`SALE-002`, `SALE-004`, `SALE-007`, `SALE-008`; `DEC-025`,
 * `DEC-033`, `DEC-035`, `DEC-041`): `import_run`, `import_staging_row` and
 * `external_mapping` are deferred in `schemas/phase1_2_draft.sql` (line 22;
 * there is no DDL for them); the authority for their columns is
 * `docs/phase0/DATA_DICTIONARY.md` §8 and the workflow is `05_WORKFLOWS.md`
 * §5.9.
 *
 * Slice 12 (`SALE-001`–`011`, `PRICE-006`, `REC-001`/`002`/`005`; `DEC-026`,
 * `DEC-035`, `DEC-040`, `DEC-042`, `DEC-043`, `DEC-045`; `ADR-0008` **Accepted**
 * 2026-09-20): `sales_transaction` and `sales_line` are drafted in
 * `schemas/phase1_2_draft.sql:620-668`; `settlement`/`reconciliation` have **no
 * DDL** anywhere, so their authority is `DATA_DICTIONARY.md:725-729`. The four
 * row-12 tables are authored below, and `0023` extends the
 * `stock_movement_source_guard` trigger with the `sales_line` branch.
 *
 * ponytail: recorded open points — deliberately NOT resolved. The same list is
 * in `docs/runbooks/persistence-migrations.md` ("Known follow-up obligations").
 * Do not invent a resolution for any of these.
 *
 * Slice-11:
 * (a) There is **no import/mapping profile table**. `import_run.source` and
 *     `import_run.profile_version` are opaque text labels: the profiles are
 *     static configuration in this slice, not rows. No profile DDL is authored.
 * (b) **`file_object` does not exist yet**, so `import_run.file_object_id` is a
 *     plain `uuid` with **no FK** (deferred-FK convention, like
 *     `goods_receipt.evidence_file_id`). The platform slice that models
 *     `file_object` closes it later.
 * (c) `IMPORT_POSTING_POLICY` is exported but backs no check;
 *     `import_staging_row.linked_sales_line_id` stays a plain `uuid` with no FK
 *     even though `sales_line` now exists — closing that deferred FK belongs to
 *     the posting slice that writes it, not to this schema-only row.
 *
 * Slice-12:
 * (d) **Tolerance configuration (A3) is now a table.** `DEC-072` (accepted
 *     2026-09-20, migration `0024`) models the effective-dated FIN-owned config
 *     as `reconciliation_tolerance`, keyed `(organization_id, kind)` with a
 *     non-overlapping `[effective_from, effective_to)` window (the
 *     `reconciliation_tolerance_no_overlap` EXCLUDE in `0024`). The
 *     `reconciliation.tolerance` column stays a **per-row snapshot** of what was
 *     applied. Resolving the effective config and blocking close on a missing
 *     tolerance are application concerns, not enforced by the schema here.
 * (e) **`source_file_id` is a plain `uuid`** on `settlement` (`file_object` is
 *     absent), like `import_run.file_object_id` (open point (b)).
 * (f) **Close/lock/period tables are row 13** (`period_close`,
 *     `adjustment_period`, `daily_close`); none are authored here.
 * (g) **Sales-line reversal semantics (`DEC-028`) are not implemented**;
 *     `reversal_of_id` only records the self-reference, and the guard/trigger
 *     does not enforce a reversal pairing.
 * (h) **`tax_code_id` vs `tax_rule_id` naming and the `applied_tax_rate`
 *     authority (A4) are unresolved.** The draft (`:655`) spells the column
 *     `tax_code_id`; `DATA_DICTIONARY.md:709` and this task spell it
 *     `tax_rule_id`. `tax_rule_id` is used here (matching
 *     `channel_fee_rule.tax_rule_id`), and the naming/authority question is
 *     **left open**, not resolved.
 * (i) **No `settlement_status` vocabulary** exists in
 *     `schemas/domain-enums.yaml`, so `settlement.status` is unconstrained text.
 * (j) **`reconciliation.scope_type` values are unresolved.** The shared
 *     `scope_type` vocabulary (`organization`/`location`/`storage`/`channel`/
 *     `company_wide`) describes cost/ownership scopes, while `REC-001`/`005`
 *     reconcile **source-vs-posted totals** (sales source / settlement /
 *     supplier invoice per `DEC-026`); no authority pins which applies, so the
 *     column is unconstrained text rather than an invented check.
 */

export const importRun = pgTable(
  "import_run",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    // Open point (a): profiles are static config, so `source`/`profile_version`
    // are opaque labels (no profile table exists).
    source: text("source").notNull(),
    profileVersion: text("profile_version").notNull(),
    // Open point (b): `file_object` is not modelled yet, so this is a plain uuid.
    fileObjectId: uuid("file_object_id"),
    // `file_hash` is unique: 05_WORKFLOWS §5.9 step 2 rejects/recognises a
    // duplicate file by hash before it is parsed.
    fileHash: text("file_hash").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    status: text("status").notNull().default("uploaded"),
    rowCounts: jsonObject("row_counts"),
    diagnostics: jsonObject("diagnostics"),
    ...auditColumns(),
  },
  (t) => [
    check("import_run_status_check", enumCheck(t.status, IMPORT_STATUS)),
    check("import_run_period_check", sql`${t.periodEnd} >= ${t.periodStart}`),
    unique("import_run_file_hash_key").on(t.fileHash),
    index("import_run_org_source_idx").on(t.organizationId, t.source),
    index("import_run_org_status_idx").on(t.organizationId, t.status),
  ],
);

export const importStagingRow = pgTable(
  "import_staging_row",
  {
    id: uuidPk(),
    importRunId: uuid("import_run_id")
      .notNull()
      .references(() => importRun.id, { onDelete: "cascade" }),
    sourceRowNo: integer("source_row_no").notNull(),
    // `raw` is the parsed source row; `normalized` is the mapped shape. Both are
    // opaque jsonb — no authority pins their shape down.
    raw: jsonObject("raw"),
    normalized: jsonObject("normalized"),
    mappingState: text("mapping_state").notNull().default("unmapped"),
    errorCode: text("error_code"),
    // Open point (c): `sales_line` is row 12 (owner-gated), so this stays a
    // plain uuid with no FK.
    linkedSalesLineId: uuid("linked_sales_line_id"),
    ...auditColumns(),
  },
  (t) => [
    check("import_staging_row_mapping_state_check", enumCheck(t.mappingState, MAPPING_STATE)),
    // `(import_run_id, source_row_no)` is both the required read path and the
    // idempotency key: replaying a parse cannot duplicate a source row.
    unique("import_staging_row_run_row_no_key").on(t.importRunId, t.sourceRowNo),
  ],
);

/**
 * `external_mapping` (`DATA_DICTIONARY` §8, `SALE-002`). `sku` is the preferred
 * match key for sales/item lines, falling back to `external_id` and then name;
 * the unique key is `(source_system, entity_type, external_id, effective_from)`
 * so history is preserved. The `DEC-033` conflict rule (conflicting rows are
 * flagged and blocked for review, resolution creates an approved superseding
 * mapping) is an application concern; the schema only stores the facts.
 *
 * `entity_type`/`internal_entity_type` are unconstrained text: there is no
 * `schemas/domain-enums.yaml` key for them, and no authority enumerates them.
 */
export const externalMapping = pgTable(
  "external_mapping",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    sourceSystem: text("source_system").notNull(),
    entityType: text("entity_type").notNull(),
    externalId: text("external_id").notNull(),
    sku: text("sku"),
    internalEntityType: text("internal_entity_type").notNull(),
    // Polymorphic internal target (product variant, channel, tax code, item, …),
    // so this is a plain uuid with no FK.
    internalEntityId: uuid("internal_entity_id").notNull(),
    effectiveFrom: tstz("effective_from").notNull(),
    effectiveTo: tstz("effective_to"),
    ...auditColumns(),
  },
  (t) => [
    check("external_mapping_effective_range_check", rangeCheck(t.effectiveFrom, t.effectiveTo)),
    unique("external_mapping_key").on(t.sourceSystem, t.entityType, t.externalId, t.effectiveFrom),
  ],
);

/**
 * `sales_transaction` (`schemas/phase1_2_draft.sql:620`, `DATA_DICTIONARY` §8,
 * `SALE-003`; `DEC-041`). One imported POS/food-app transaction; the unique
 * `(source_system, external_transaction_id)` makes a replay unable to duplicate
 * a transaction. The money columns are nullable like the draft (a source may
 * report only some totals). `import_run_id` is a **real FK** to the row-11
 * `import_run` (it exists) rather than the plain uuid the draft anticipated;
 * `sales_transaction` is new and empty at apply, so the FK validates cheaply and
 * needs no `NOT VALID` → `VALIDATE`.
 */
export const salesTransaction = pgTable(
  "sales_transaction",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    locationId: uuid("location_id").references(() => location.id),
    channelId: uuid("channel_id").references(() => channel.id),
    sourceSystem: text("source_system").notNull(),
    externalTransactionId: text("external_transaction_id").notNull(),
    occurredAt: tstz("occurred_at").notNull(),
    grossAmount: money("gross_amount"),
    netAmount: money("net_amount"),
    taxAmount: money("tax_amount"),
    discountAmount: money("discount_amount"),
    refundAmount: money("refund_amount"),
    currency: currency().notNull(),
    importRunId: uuid("import_run_id").references(() => importRun.id),
    ...auditColumns(),
  },
  (t) => [
    // Replay cannot duplicate (SALE-003). `DATA_DICTIONARY.md:711` also lists a
    // `(source_system, external_transaction_id, external_line_id)` key, but that
    // triple differs from the draft's `(sales_transaction_id, external_line_id)`
    // on `sales_line`; the draft form is used (open point — not silently
    // resolved).
    unique("sales_transaction_external_key").on(t.sourceSystem, t.externalTransactionId),
    index("sales_transaction_org_occurred_idx").on(t.organizationId, t.occurredAt),
  ],
);

/**
 * `sales_line` (`schemas/phase1_2_draft.sql:638`, `DATA_DICTIONARY` §8,
 * `SALE-003`/`005`/`009`; `DEC-042`, `DEC-043`). `product_variant_id` stays
 * nullable until mapped; `external_product_ref`/`sku` identify the POS product.
 * `applied_tax_rate` records the VAT rate **actually applied** per line
 * (`DEC-042`/`DEC-045`); `option_kind` + `parent_line_id` normalize standalone vs
 * attached vs included add-ons (`DEC-043`). `reversal_of_id` is the self-FK for
 * reversals (`DEC-028` semantics not implemented — open point (g)).
 *
 * `tax_rule_id` follows `DATA_DICTIONARY.md:709` and this task, not the draft's
 * `tax_code_id` (open point (h)); `channel_fee_basis` is unconstrained text
 * because no `schemas/domain-enums.yaml` key enumerates it.
 */
export const salesLine = pgTable(
  "sales_line",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    salesTransactionId: uuid("sales_transaction_id")
      .notNull()
      .references(() => salesTransaction.id),
    productVariantId: uuid("product_variant_id").references(() => productVariant.id),
    externalProductRef: text("external_product_ref"),
    sku: text("sku"),
    externalLineId: text("external_line_id"),
    quantity: quantity("quantity").notNull(),
    unitPrice: money("unit_price"),
    grossAmount: money("gross_amount"),
    netAmount: money("net_amount"),
    taxAmount: money("tax_amount"),
    appliedTaxRate: rate("applied_tax_rate"),
    discountAmount: money("discount_amount"),
    refundAmount: money("refund_amount"),
    channelId: uuid("channel_id").references(() => channel.id),
    taxRuleId: uuid("tax_rule_id").references(() => taxRule.id),
    parentLineId: uuid("parent_line_id").references((): AnyPgColumn => salesLine.id),
    optionKind: text("option_kind").notNull().default("standalone"),
    channelFeeBasis: text("channel_fee_basis"),
    mappingState: text("mapping_state").notNull().default("unmapped"),
    reversalOfId: uuid("reversal_of_id").references((): AnyPgColumn => salesLine.id),
    ...auditColumns(),
  },
  (t) => [
    check("sales_line_option_kind_check", enumCheck(t.optionKind, OPTION_KIND)),
    check("sales_line_mapping_state_check", enumCheck(t.mappingState, MAPPING_STATE)),
    check(
      "sales_line_applied_tax_rate_check",
      sql`${t.appliedTaxRate} is null or ${t.appliedTaxRate} >= 0`,
    ),
    // Draft `:665`: an attached/included option must point at a parent line; a
    // standalone line must not (it may have no parent).
    check(
      "sales_line_option_parent_check",
      sql`${t.optionKind} = 'standalone' or ${t.parentLineId} is not null`,
    ),
    unique("sales_line_transaction_line_key").on(t.salesTransactionId, t.externalLineId),
    // At most one reversal per line (`DEC-073`): the partial unique index is the
    // DB-level backstop for `reverseSalesLine`'s pre-check, so two concurrent
    // reversals cannot both post. Rows with `reversal_of_id IS NULL` (every
    // ordinary line) are unconstrained.
    uniqueIndex("sales_line_reversal_of_id_key")
      .on(t.reversalOfId)
      .where(sql`${t.reversalOfId} is not null`),
    index("sales_line_transaction_idx").on(t.salesTransactionId),
    index("sales_line_sku_idx").on(t.organizationId, t.sku),
  ],
);

/**
 * `settlement` (`DATA_DICTIONARY.md:728`, `REC-001`/`002`; `DEC-026`,
 * `DEC-040`). A payment/channel payout report line: what the provider paid,
 * charged in fees and refunded over a period. `source_file_id` is a plain uuid
 * (`file_object` absent — open point (e)); `status` is unconstrained text
 * because `schemas/domain-enums.yaml` has no `settlement_status` key (open
 * point (i)).
 */
export const settlement = pgTable(
  "settlement",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    provider: text("provider").notNull(),
    channelId: uuid("channel_id").references(() => channel.id),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    paidAmount: money("paid_amount"),
    feeAmount: money("fee_amount"),
    refundAmount: money("refund_amount"),
    currency: currency().notNull(),
    sourceFileId: uuid("source_file_id"),
    status: text("status").notNull(),
    ...auditColumns(),
  },
  (t) => [
    check("settlement_period_check", sql`${t.periodEnd} >= ${t.periodStart}`),
    index("settlement_org_provider_period_idx").on(t.organizationId, t.provider, t.periodStart),
  ],
);

/**
 * `reconciliation` (`DATA_DICTIONARY.md:729`, `REC-001`/`005`; `DEC-026`,
 * `DEC-035`). One reconciliation of an expected amount against an actual one
 * over a period, with the tolerance snapshot and the resolution trail.
 * `scope_id` is a plain uuid (polymorphic target); `scope_type` is
 * unconstrained text (open point (j)); `owner_id` is a plain uuid (no authority
 * requires the `app_user` FK — deferred-FK convention). `tolerance` is a
 * per-row snapshot of what was applied; the effective-dated config lives in
 * `reconciliation_tolerance` (`DEC-072`).
 */
export const reconciliation = pgTable(
  "reconciliation",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    scopeType: text("scope_type").notNull(),
    scopeId: uuid("scope_id").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    expectedAmount: money("expected_amount").notNull(),
    actualAmount: money("actual_amount").notNull(),
    tolerance: money("tolerance").notNull(),
    difference: money("difference").notNull(),
    status: text("status").notNull().default("pending"),
    resolutionNote: text("resolution_note"),
    ownerId: uuid("owner_id"),
    dueDate: date("due_date"),
    ...auditColumns(),
  },
  (t) => [
    check("reconciliation_status_check", enumCheck(t.status, RECONCILIATION_STATUS)),
    check("reconciliation_period_check", sql`${t.periodEnd} >= ${t.periodStart}`),
    index("reconciliation_org_status_idx").on(t.organizationId, t.status),
    index("reconciliation_org_scope_idx").on(
      t.organizationId,
      t.scopeType,
      t.scopeId,
      t.periodStart,
    ),
  ],
);

/**
 * `reconciliation_tolerance` (`DEC-072`, migration `0024`; `REC-001`/`005`).
 * The effective-dated, FIN-owned tolerance configuration `DEC-026` describes:
 * keyed `(organization_id, kind)` with a non-overlapping effective window
 * `[effective_from, effective_to)`. The applied tolerance is
 * `max(rate × |expected|, floor_amount)` at money scale (HALF_UP), resolved by
 * the application — the schema stores the config row, not the resolved value
 * (`reconciliation.tolerance` remains the per-row snapshot).
 *
 * The non-overlap guarantee is the hand-written
 * `reconciliation_tolerance_no_overlap` EXCLUDE constraint in
 * `0024_reconciliation_tolerance.sql` (drizzle-kit cannot express
 * `EXCLUDE USING gist`), so `effective_from`/`effective_to` stay plain `date`
 * here (hand-written invariants convention).
 */
export const reconciliationTolerance = pgTable(
  "reconciliation_tolerance",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    kind: text("kind").notNull(),
    rate: rate("rate").notNull(),
    floorAmount: money("floor_amount").notNull(),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    ...auditColumns(),
  },
  (t) => [
    check("reconciliation_tolerance_kind_check", enumCheck(t.kind, RECONCILIATION_TOLERANCE_KIND)),
    check("reconciliation_tolerance_rate_check", sql`${t.rate} >= 0`),
    check("reconciliation_tolerance_floor_check", sql`${t.floorAmount} >= 0`),
    check(
      "reconciliation_tolerance_effective_range_check",
      rangeCheck(t.effectiveFrom, t.effectiveTo),
    ),
    index("reconciliation_tolerance_org_kind_idx").on(t.organizationId, t.kind),
  ],
);
