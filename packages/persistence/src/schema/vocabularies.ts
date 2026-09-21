// Controlled vocabularies for the Phase 1-2 core schema.
//
// Single source of truth in TypeScript: `schemas/domain-enums.yaml` is the
// authority for the domain vocabulary, and the SQL `check` constraints in the
// table modules are built from these arrays (see `enumCheck` in `./columns`),
// so a value cannot drift between the schema and the checks.

export const DOCUMENT_STATUS = ["draft", "submitted", "approved", "rejected", "retired"] as const;

// Values from `schemas/domain-enums.yaml` (`receipt_status`): per-entity
// workflow states take precedence over the generic `document_status`.
export const RECEIPT_STATUS = ["draft", "submitted", "accepted", "rejected", "reversed"] as const;

export const ITEM_TYPE = [
  "ingredient",
  "packaging",
  "cleaning_supply",
  "consumable",
  "intermediate",
  "finished_good",
  "non_stock_supply",
] as const;

export const INVENTORY_POLICY = ["stocked", "non_stock", "made_to_order"] as const;

export const LOCATION_KIND = ["operating", "central_production", "virtual_transit"] as const;

export const STORAGE_AREA_KIND = [
  "kitchen",
  "dry_store",
  "refrigerator",
  "freezer",
  "front_counter",
  "transit",
  "other",
] as const;

export const RECIPE_COMPONENT_KIND = ["ingredient", "packaging", "sub_recipe"] as const;

// `recipe_allergen.source`: a declaration that was derived from a source
// ingredient versus one a human explicitly verified.
export const ALLERGEN_SOURCE = ["derived", "verified"] as const;

export const PRODUCT_KIND = ["base", "variant", "add_on"] as const;

export const COST_CARD_STATE = ["draft", "approved", "superseded"] as const;

export const STOCK_MOVEMENT_TYPE = [
  "receipt",
  "receipt_reversal",
  "production_consumption",
  "production_output",
  "sale_consumption",
  "transfer_dispatch",
  "transfer_receipt",
  "waste",
  "count_adjustment",
  "correction",
  "revaluation",
] as const;

export const MOVEMENT_SOURCE_TYPE = [
  "goods_receipt",
  "production_batch",
  "transfer",
  "stock_count",
  "sales_line",
  "waste_event",
  "adjustment",
  "revaluation",
  "correction",
] as const;

export const TAX_BASIS = ["inclusive", "exclusive"] as const;

export const TAX_TREATMENT = ["fixed", "channel_overridable"] as const;

export const TAX_APPLIES_TO = ["product", "service", "fee", "cost"] as const;

// Values from `schemas/domain-enums.yaml` (`scope_type`). Used by `allocation_rule`,
// where the split is by driver: `organization`/`company_wide` are org-wide scopes and
// `location`/`storage`/`channel` are narrower ones. The `equal_share` fallback is only
// meaningful for an `organization`/`company_wide` rule, since a narrower scope would
// need its own eligible-entity set; enforcing that structurally is deferred, so the
// rule and the fallback are validated separately today.
export const SCOPE_TYPE = [
  "organization",
  "location",
  "storage",
  "channel",
  "company_wide",
] as const;

export const ROUNDING_METHOD = ["HALF_UP", "HALF_EVEN"] as const;

export const ROUNDING_BOUNDARY = ["B0", "B1", "B2", "B3", "B4"] as const;

// `snapshot_component.component_kind`: which cost layer a stored intermediate
// belongs to. Defined by the slice-7 persistence work to close the runbook's
// "controlled vocabulary" obligation for the column; the matching
// `schemas/domain-enums.yaml` entry is owned by the domain slice.
export const SNAPSHOT_COMPONENT_KIND = [
  "ingredient",
  "packaging",
  "direct_labor",
  "channel_variable",
  "other_variable",
  "allocated_overhead",
] as const;

export const COST_SELECTION_POLICY = [
  "latest_approved_price",
  "moving_weighted_average",
  "standard_cost",
] as const;

export const COST_SOURCE = ["receipt", "manual", "excel"] as const;

export const FEE_KIND = [
  "commission_pct",
  "processing_pct",
  "fixed_per_order",
  "delivery_subsidy",
  "discount_funding",
] as const;

export const FEE_BASIS = ["gross_price", "net_price", "per_order"] as const;

export const UNIT_DIMENSION = ["mass", "volume", "count", "time", "package"] as const;

// Values from `schemas/domain-enums.yaml` (`cost_center_kind`).
export const COST_CENTER_KIND = [
  "company_shared",
  "location",
  "kitchen",
  "front_of_house",
  "project",
] as const;

export const ROLE_CODE = [
  "owner",
  "general_manager",
  "location_manager",
  "kitchen",
  "front_of_house",
  "purchasing",
  "finance",
  "admin",
  "analyst",
  "product_owner",
  "technical_owner",
  "data_owner",
] as const;

export const DATA_AREA = [
  "products_recipes_allergens",
  "supplier_items_costs",
  "prices_channels_tax",
  "inventory_waste",
  "sales_mappings_settlements",
  "labor_assumptions",
  "competitor_observations",
  "user_access_audit",
] as const;

// Values from `schemas/domain-enums.yaml` (`app_user_status`).
export const APP_USER_STATUS = ["invited", "active", "disabled", "locked"] as const;

/** Narrow type for `app_user.status`, so comparisons cannot drift into typos. */
export type UserStatus = (typeof APP_USER_STATUS)[number];

// Values from `schemas/domain-enums.yaml` (`price_scenario_state`): a subset of
// `document_status`, minus `retired`.
export const PRICE_SCENARIO_STATE = ["draft", "submitted", "approved", "rejected"] as const;

// Slice 6 (operating costs + labour + allocation), from
// `schemas/domain-enums.yaml`: how an operating cost behaves as volume changes,
// how often it recurs, what an `allocation_rule` is driven by, and what happens
// when the driver denominator is missing or zero.
export const COST_BEHAVIOR = ["fixed", "variable", "mixed"] as const;

export const OPERATING_COST_RECURRENCE = [
  "one_off",
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "annual",
] as const;

export const ALLOCATION_DRIVER = [
  "direct_location_assignment",
  "occupied_area",
  "equipment_use",
  "production_hours",
  "production_minutes",
  "operating_hours",
  "transactions",
  "revenue",
  "recorded_time",
  "eligible_products",
  "equal_share",
] as const;

export const ALLOCATION_FALLBACK = ["stop", "equal_share"] as const;

// Slice 9 (counts + transfers + waste), from `schemas/domain-enums.yaml`: the
// stock-count workflow state, the transfer workflow state, the nine
// blame-free waste stages (DEC-018) and the waste valuation method. These were
// present in the yaml but deliberately unexported until a table needed them;
// `vocabularies.test.ts`'s `UNEXPORTED_YAML_KEYS` guard shrinks accordingly.
export const COUNT_STATUS = ["draft", "counting", "submitted", "approved", "cancelled"] as const;

export const TRANSFER_STATUS = [
  "draft",
  "requested",
  "approved",
  "dispatched",
  "received",
  "cancelled",
] as const;

export const WASTE_STAGE = [
  "receiving",
  "storage_expiry",
  "preparation",
  "production",
  "display",
  "unsold_finished_goods",
  "customer_return",
  "count_discovered",
  "other",
] as const;

export const WASTE_VALUE_METHOD = [
  "cost_selection",
  "moving_average",
  "latest_price",
  "manual",
] as const;

// Slice 10 (production planning + batches), from `schemas/domain-enums.yaml`:
// the `production_batch` workflow state (`planned` → `cancelled`). It governs
// the batch, not the `production_plan`; the plan has no status vocabulary
// authority (recorded as an open point in `./production.ts`).
export const PRODUCTION_STATUS = [
  "planned",
  "released",
  "in_progress",
  "completed",
  "cancelled",
] as const;

// Slice 11 (import framework + external mappings), from
// `schemas/domain-enums.yaml`: the `import_run` workflow state
// (`uploaded` → `superseded`, `05_WORKFLOWS.md` §5.9) and the
// `import_staging_row` mapping state. `IMPORT_POSTING_POLICY` is the posting
// policy (`DEC-035`); it now backs `import_profile_posting_policy_check` on
// `import_profile.posting_policy` (`DEC-081`, migration `0031`).
export const IMPORT_STATUS = [
  "uploaded",
  "parsed",
  "needs_review",
  "validated",
  "posted",
  "partially_posted",
  "failed",
  "superseded",
] as const;

export const MAPPING_STATE = ["unmapped", "mapped", "ignored", "error", "conflict"] as const;

export const IMPORT_POSTING_POLICY = ["all_or_nothing", "allow_partial"] as const;

// `DEC-083`: the approved-disposition vocabulary for a non-posted import row
// (`DEC-035`), from `schemas/domain-enums.yaml` (`import_disposition`). Backs
// the `import_disposition_disposition_check` constraint; the application
// constant (`packages/application/src/imports/vocabularies.ts`) derives from
// this rather than redeclaring it.
export const IMPORT_DISPOSITION = ["unmapped", "rejected", "ignored"] as const;

// Slice 12 (sales + settlements + reconciliation), from
// `schemas/domain-enums.yaml`: the `reconciliation` workflow state
// (`pending` → `approved`, `REC-001`/`005`) and the `sales_line.option_kind`
// add-on shape (`DEC-043`). Both were present in the yaml but deliberately
// unexported until a table needed them; `vocabularies.test.ts`'s
// `UNEXPORTED_YAML_KEYS` guard shrinks accordingly.
export const RECONCILIATION_STATUS = [
  "pending",
  "within_tolerance",
  "exception",
  "resolved",
  "approved",
] as const;

export const OPTION_KIND = ["standalone", "attached", "included"] as const;

// `DEC-072`: the `reconciliation_tolerance.kind` an effective-dated tolerance
// config applies to — a settlement reconciliation (`sales_settlement`) or a
// supplier-invoice reconciliation (`supplier_invoice`). From
// `schemas/domain-enums.yaml` (`reconciliation_tolerance_kind`).
export const RECONCILIATION_TOLERANCE_KIND = ["sales_settlement", "supplier_invoice"] as const;

// `DEC-078` (a): the `settlement.status` state of a payout-report fact
// (`received` → `paid`, with `void` for a superseded/erroneous payout because
// financial facts are append-only — reversals, not deletes). From
// `schemas/domain-enums.yaml` (`settlement_status`); the column defaults to
// `received`.
export const SETTLEMENT_STATUS = ["received", "paid", "void"] as const;

// `DEC-078` (b): the `reconciliation.scope_type` — what a reconciliation
// compares source-vs-posted totals for (`REC-001`/`005`). Deliberately distinct
// from the cost/ownership `SCOPE_TYPE`, so an unknown scope is rejected rather
// than accepted as free text. From `schemas/domain-enums.yaml`
// (`reconciliation_scope_type`).
export const RECONCILIATION_SCOPE_TYPE = [
  "import_run",
  "sales_source",
  "settlement",
  "supplier_invoice",
] as const;

// `stock_movement.reason_code` for count/adjustment postings (`adjustment_reason`
// in `schemas/domain-enums.yaml`). Exported here because the count-adjustment
// and waste slices need a closed vocabulary for the reason code.
export const ADJUSTMENT_REASON = [
  "count_variance",
  "spoilage",
  "breakage",
  "staff_meal",
  "supplier_credit",
  "data_correction",
  "revaluation",
  "transfer_discrepancy",
  "other",
] as const;

// `DEC-080` (`DQ-001`): the `data_quality_exception` severity and lifecycle
// state. `severity` defaults to `medium`; `status` defaults to `open` and moves
// through acknowledgement to a resolution or dismissal. `rule_code` is
// deliberately left as provisional free text (no closed vocabulary yet, the
// `DEC-071` precedent). From `schemas/domain-enums.yaml` (`exception_severity`,
// `exception_status`).
export const EXCEPTION_SEVERITY = ["low", "medium", "high", "critical"] as const;

export const EXCEPTION_STATUS = ["open", "acknowledged", "resolved", "dismissed"] as const;

// `DEC-089` (`HMS-002`): the HMS monitoring-point kind and how often a reading
// is due. From `schemas/domain-enums.yaml` (`monitoring_point_kind`,
// `check_frequency`). `kind` backs the `monitoring_point_kind_check` and
// `check_frequency` the `monitoring_point_check_frequency_check`; a point's
// `unit` stays provisional free text (no closed vocabulary yet, `DEC-071`).
export const MONITORING_POINT_KIND = [
  "refrigerator",
  "freezer",
  "cooler",
  "hot_holding",
  "other",
] as const;

export const CHECK_FREQUENCY = ["daily", "twice_daily", "weekly", "monthly", "other"] as const;

// `DEC-090` / `DEC-095` (`HMS-003`, `HMS-004`): the HMS incident register and
// its corrective actions. `category` and `status` back the
// `hms_incident_category_check` / `hms_incident_status_check`, and
// `corrective_action.status` backs `corrective_action_status_check`. The
// `DEC-095` clarification adds `incident_severity` as its own vocabulary
// (NOT NULL, no default) backing `hms_incident_severity_check`; it deliberately
// reuses the same four levels as `EXCEPTION_SEVERITY` but is a separate yaml key
// so the two can diverge. From `schemas/domain-enums.yaml` (`incident_category`,
// `incident_severity`, `incident_status`, `corrective_action_status`).
export const INCIDENT_CATEGORY = [
  "work_accident",
  "electrical",
  "equipment",
  "fire",
  "near_miss",
  "other",
] as const;

export const INCIDENT_SEVERITY = ["low", "medium", "high", "critical"] as const;

export const INCIDENT_STATUS = ["open", "investigating", "resolved", "closed"] as const;

export const CORRECTIVE_ACTION_STATUS = ["open", "in_progress", "done", "verified"] as const;
