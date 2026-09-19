# Phase 1–2 Data Dictionary (draft)

Status: **Draft for technical + data-owner review.** Companion to `schemas/phase1_2_draft.sql`.
Entity names are snake_case tables; `[DECIDE: DEC-xxx]` marks a field whose policy is still open.
Requirement IDs cite `11_REQUIREMENTS_CATALOG.md`.

> **SCHEMA INPUTS.** DEC-027 (period-lock granularity) is accepted as of 2026-09-14; this dictionary reflects the accepted policy.

> **Reconciled 2026-09-18.** `schemas/domain-enums.yaml` is the authoritative controlled
> vocabulary; this dictionary was reconciled to it (role_code, employment_type, shift_state,
> shift_assignment_state) where they conflicted. The Phase 1–2 core has been implemented and
> migrated (35 tables, `packages/persistence`, migrations 0000–0002); all other entities
> (workforce, integrations, competitor, AI, deferred slices) remain deferred per slice.
> Columns that exist only in this dictionary and are absent from
> `schemas/phase1_2_draft.sql` (for example `channel.external_ref`,
> `item.reorder_policy_id` / `item.allergen_metadata` / `item.location_id`,
> `recipe.owner_role` / `recipe.status`, the extra `price_scenario` fields, and
> `calculation_snapshot.tax_rule_version`) are **deferred** and will be added
> per slice; for implemented tables the DDL draft is authoritative.

## 0. Conventions

- **Identity:** `id uuid primary key default gen_random_uuid()` (UUIDv7 preferred where available).
- **Scope:** every mutable business table carries `organization_id uuid not null`.
  Location-scoped tables carry `location_id uuid` (null = company-wide).
- **Audit columns:** `created_at timestamptz not null default now()`, `created_by uuid not null`,
  `updated_at timestamptz`, `updated_by uuid`, `version integer not null default 1` (optimistic
  concurrency / ETag).
- **Soft delete:** `retired_at timestamptz`; master records referenced by transactions are retired,
  never deleted (`03:165-167`).
- **Effective dating:** `effective_from timestamptz not null`, `effective_to timestamptz` (null = open),
  with `EXCLUDE USING gist (scope_col WITH =, tstzrange(effective_from, effective_to) WITH &&)` and
  `check (effective_to is null or effective_to > effective_from)` (`02:68`, FND-004).
- **Money:** `amount numeric(19,4)` + `currency char(3)`. **Quantity:** `numeric(19,6)` + `unit_id`.
  No floats (`02:66`, `13:87`).
- **Polymorphic source refs** use `(source_type text, source_id uuid)` plus a check constraint
  enumerating allowed source types.

## 1. Organization and identity

### organization
| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| id | uuid | no | PK |
| legal_name | text | no | |
| currency | char(3) | no | default `NOK` |
| timezone | text | no | default `Europe/Oslo` |
| settings | jsonb | no | default `{}` |

### location
| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| id | uuid | no | PK |
| organization_id | uuid | no | FK |
| code | text | no | unique per org |
| name | text | no | |
| kind | text | no | `operating` / `central_production` / `virtual_transit` [DEC-029] |
| address | text | yes | |
| active_from | date | no | |
| active_to | date | yes | |

### storage_area
| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| id, organization_id, location_id | uuid | no | PK / FK / FK |
| code, name | text | no | |
| kind | text | no | kitchen, dry_store, refrigerator, freezer, front_counter, transit |
| is_transit | boolean | no | default false; true only on the virtual transit location [DEC-029] |

### channel
| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| id, organization_id | uuid | no | |
| code, name | text | no | dine_in, takeaway, wolt, direct_online, other |
| is_delivery | boolean | no | |
| external_ref | text | yes | |

### cost_center
| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| id, organization_id | uuid | no | |
| location_id | uuid | yes | null = company shared |
| code, name | text | no | |
| kind | text | no | `cost_center_kind` enum: company_shared, location, kitchen, front_of_house, project |

### app_user / role / user_role / user_location_scope / user_totp / auth_session / password_reset_token

Internal authentication (DEC-013): the application is its own identity provider, so credentials,
roles, scopes, sessions and TOTP live in this database. No external IdP.

| Table | Key columns | Notes |
| --- | --- | --- |
| app_user | id, organization_id, username, email, display_name, password_hash, password_changed_at, status, failed_login_count, locked_until, last_login_at, totp_enabled, created_by/at, updated_by/at, version | `username`/`email` both nullable (staff may lack email); at least one identifies the account. `password_hash` is Argon2id (fallback bcrypt), per-user salt. (2026-09-18) Uniqueness is per organization on `lower(btrim(username))` / `lower(btrim(email))`; trimming was added to prevent whitespace-variant duplicate identifiers. |
| role | id, organization_id, code, name, description | `code` uses the `role_code` enum: owner, general_manager, location_manager, kitchen, front_of_house, purchasing, finance, admin, analyst, product_owner, technical_owner, data_owner |
| user_role | user_id, role_id, location_id (null=all), granted_by, granted_at | scope on grant |
| user_location_scope | user_id, location_id | explicit location allow-list (FND-002) |
| user_totp | user_id, secret_encrypted, confirmed_at, recovery_codes_hash[] | TOTP (RFC 6238); secret encrypted at rest; recovery codes stored hashed and single-use |
| auth_session | id, user_id, token_hash, issued_at, expires_at, revoked_at, user_agent, ip | `token_hash` unique; revoked server-side on logout/role change |
| password_reset_token | id, user_id, token_hash, expires_at, used_at, created_by | single-use, short-expiry token hashed at rest; admin-assisted reset for staff without email |

Authorization is enforced in application services/queries, never by UI hiding (`07:5`, `13:91`).
Passwords are hashed with Argon2id; TOTP secrets and signing keys are encrypted at rest / held in the
secret manager, never in ordinary configuration rows.

### data_ownership (FND-007 — DEC-014 clarification)

Ownership is assignable, not a fixed field: roles and accountability are granted to and revoked from
users with effective dates and audit, so access can be handed over as staffing changes. Paulo Paes is
the initial holder, not a hard-coded constant. The system-level ownership roles (product owner,
technical owner, operational-data owner) can be represented as role grants through `role`/`user_role`
and/or dedicated role codes (`product_owner`, `technical_owner`, `data_owner`), assigned and revoked
with audit; the per-data-area business owners use this table.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| id | uuid | no | PK |
| organization_id | uuid | no | FK organization |
| data_area | text | no | `data_area` enum: products_recipes_allergens, supplier_items_costs, prices_channels_tax, inventory_waste, sales_mappings_settlements, labor_assumptions, competitor_observations, user_access_audit |
| owner_user_id | uuid | no | FK `app_user`; the accountable holder |
| review_cadence | text | yes | expected ownership / data-quality review cadence |
| effective_from | timestamptz | no | grant becomes effective |
| effective_to | timestamptz | yes | null = open; revocation closes the grant |
| granted_by | uuid | yes | FK `app_user`; who granted the ownership |
| granted_at | timestamptz | no | default `now()` |

Grant and revocation are audited (`07.3`, FND-005); only authorized roles may grant or revoke ownership
(`07.1`). Index on `(organization_id, data_area)`.

## 2. Units and catalog

### unit
| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| id, organization_id | uuid | no | |
| code | text | no | g, ml, piece, m, dose, pack |
| dimension | text | no | mass, volume, count, time, package [new enum] |
| is_base | boolean | no | |

### unit_conversion
| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| id, organization_id | uuid | no | |
| from_unit_id, to_unit_id | uuid | no | dimension must match unless package↔base |
| factor | numeric(19,6) | no | `> 0`; package conversion may be item-scoped |
| item_id | uuid | yes | null = global; set for pack/density-specific |
| effective_from / effective_to | timestamptz | no / yes | effective-dated (pack resizes) |

Invariant (FND-003): conversion graph rejects ambiguity, inconsistent cycles, zero/negative factors
and incompatible dimensions (`03:42`).

### item
| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| id, organization_id | uuid | no | |
| code | text | no | unique per org |
| sku | text | no | business-controller-owned stable item code; globally unique per organization (`unique (organization_id, sku)`) and shared with `product_variant`; published to the POS and used as the **primary reconciliation key** (DEC-041) |
| name | text | no | |
| item_type | text | no | ingredient, packaging, cleaning_supply, consumable, intermediate, finished_good, non_stock_supply |
| base_unit_id | uuid | no | INVENTORY base unit (PROC-001) |
| inventory_policy | text | no | `stocked` / `non_stock` / `made_to_order` [DEC-030] |
| lot_tracked | boolean | no | default false; expiry/traceability |
| shelf_life_days | integer | yes | |
| standard_portion_size | numeric(19,6) | yes | common portion size for batch-made intermediates (e.g. 550 g); stock is still tracked in the base unit and partial portions are allowed [DEC-036] |
| portion_unit_id | uuid | yes | unit of the standard portion; FK unit [DEC-036] |
| reorder_policy_id | uuid | yes | FK reorder_policy |
| allergen_metadata | jsonb | yes | |
| current_cost | numeric(19,4) | yes | manually maintained fallback cost, used only when no approved supplier price or cost observation exists (DEC-047) |
| current_cost_updated_at | timestamptz | yes | when `current_cost` was last maintained |
| active_from / active_to | date | no / yes | |
| location_id | uuid | yes | null = org-wide |

### supplier
| id, organization_id | uuid | no |
| code, name, contact, terms | text | |
| currency | char(3) | no | default NOK |
| active | boolean | no | |

### supplier_item
| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| id, organization_id | uuid | no | |
| supplier_id, item_id | uuid | no | FK |
| supplier_sku | text | no | unique per supplier |
| pack_unit_id | uuid | no | e.g. case/bottle |
| pack_to_base_unit_factor | numeric(19,6) | no | `> 0` |
| min_order_qty | numeric(19,6) | yes | |
| lead_time_days | integer | yes | |
| preferred | boolean | no | default false |

### supplier_price (PROC-004)
| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| id, organization_id | uuid | no | |
| supplier_item_id | uuid | no | |
| gross_pack_price | numeric(19,4) | no | |
| discount | numeric(19,4) | no | default 0 |
| tax_basis | text | no | inclusive/exclusive [DEC-022] |
| tax_code_id | uuid | yes | FK tax_rule |
| allocated_freight, import_fee, other_cost | numeric(19,4) | no | default 0 |
| net_pack_price, landed_pack_cost, landed_base_unit_cost | numeric(19,4) | no | computed at B1 |
| currency | char(3) | no | |
| source_receipt_id | uuid | yes | provenance |
| effective_from / effective_to | timestamptz | no / yes | effective-dated, no overlap per supplier_item |

`supplier_price` only covers items bought from a real, known supplier. Ad-hoc grocery purchases with no
supplier master are recorded as `cost_observation` rows instead (DEC-047); supplier relationships are optional.

### cost_observation (DEC-047 — receipt / manual / Excel cost catalogue)
| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| id, organization_id | uuid | no | |
| item_id | uuid | no | FK item |
| store_name | text | yes | free-text store the purchase came from; the supplier association is optional and a real supplier price belongs in `supplier_price` |
| observed_at | date | no | date the cost was observed / the receipt dated |
| pack_size | numeric(19,6) | yes | pack size as bought |
| pack_unit_id | uuid | yes | FK unit |
| pack_price | numeric(19,4) | yes | pack price (state the tax basis in `notes`, as receipts vary) |
| currency | char(3) | no | default `NOK` |
| source | text | no | `cost_source` enum: receipt, manual, excel |
| receipt_file_id | uuid | yes | FK file_object (deferred slice); receipt/Excel evidence |
| notes | text | yes | free text — VAT basis, pack comments, source file name |

Index on `(organization_id, item_id, observed_at)` so the latest observation per item is cheap to resolve.
The `cost_source` enum values (`receipt`, `manual`, `excel`) must be added to `schemas/domain-enums.yaml`.

## 3. Recipes and products

### recipe / recipe_version / recipe_line (COST-001/002)
| Table | Key columns | Notes |
| --- | --- | --- |
| recipe | id, organization_id, code, name, output_item_id (nullable), owner_role, status | stable identity |
| recipe_version | id, recipe_id, version_no (unique per recipe), state (draft/submitted/approved/rejected/retired), planned_input_qty, planned_output_qty, approved_usable_output, yield_rate, preparation_minutes, effective_from, effective_to, approved_by, approved_at, notes | immutable after approval |
| recipe_line | id, recipe_version_id, item_id (or sub_recipe_id), component_kind (ingredient/packaging/sub_recipe), quantity, unit_id, loss_factor, stage, substitution_group | exactly one of item_id/sub_recipe_id |

Invariants: no draft dependency; no cycles; non-overlapping effective windows (COST-002, FND-004).

### product / product_variant / product_recipe_assignment
| Table | Key columns | Notes |
| --- | --- | --- |
| product | id, organization_id, code, name, category, product_kind text not null default 'base' (`base` / `variant` / `add_on`), active_from, active_to | commercial grouping; the platform owns the taxonomy and the SKU catalogue (DEC-044) |
| product_variant | id, organization_id, product_id, code, sku, name, size, finished_good_item_id (nullable), active_from/to | size/channel/location-relevant sellable [DEC-030]; `sku` is business-controller-owned, globally unique per organization (`unique (organization_id, sku)`, matching `item`), published to the POS and used as the primary reconciliation key (DEC-041) |
| product_recipe_assignment | id, product_variant_id, location_id, recipe_version_id, effective_from, effective_to | effective-dated, no overlap |

### addon_applicability (DEC-044)

Links an add-on product to the base products it may be added to, with an optional price effect.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| id | uuid | no | PK |
| organization_id | uuid | no | FK organization |
| addon_product_id | uuid | no | FK product; the add-on (`product_kind = add_on`) |
| base_product_id | uuid | no | FK product; the base product it can be added to |
| price_effect | numeric(19,4) | yes | optional surcharge/delta; null = no price effect |
| active_from | date | no | default `current_date` |
| active_to | date | yes | null = open |

Invariant: `addon_product_id <> base_product_id`; `active_to is null or active_to > active_from`. Category-level
applicability is a future extension; the MVP links product-to-product. Add-on classification drives menu
engineering and costing, not automatic parentage: a sales line's parent is set only from POS parent/child data.

### allergen / recipe_allergen
| Table | Key columns |
| --- | --- |
| allergen | id, organization_id, code, name, is_derived |
| recipe_allergen | recipe_version_id, allergen_id, source (`derived`/`verified`), verified_by |

## 4. Costs and pricing

### operating_cost (COST-003)
| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| id, organization_id | uuid | no | |
| location_id | uuid | yes | |
| cost_center_id | uuid | no | |
| amount | numeric(19,4) | no | |
| currency | char(3) | no | |
| recurrence | text | no | one_off, daily, weekly, monthly, quarterly, annual [new enum] |
| behavior | text | no | fixed, variable, mixed |
| tax_basis | text | no | |
| effective_from / effective_to | date | no / yes | |
| vendor, evidence_file_id | text/uuid | yes | |

### labor_rate (COST-004)
| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| id, organization_id, cost_center_id | uuid | | |
| role_code | text | no | **no named employee** by default (DEC-012) |
| loaded_hourly_rate | numeric(19,4) | no | |
| productive_hours_pct | numeric(6,4) | yes | |
| effective_from / effective_to | date | no / yes | |

### asset
| id, organization_id, location_id, cost_center_id | uuid |
| description, kind | text |
| purchase_or_lease_value | numeric(19,4) |
| useful_life_months | integer |
| depreciation_policy | text |
| active_from / active_to | date |

### cost_pool / allocation_rule (COST-007)
| Table | Key columns | Notes |
| --- | --- | --- |
| cost_pool | id, organization_id, code, name, effective_from/to | |
| allocation_rule | id, cost_pool_id, driver, scope_type, denominator_source, fallback_behavior, effective_from/to | driver enum: direct_location_assignment, occupied_area, equipment_use, production_hours, production_minutes, operating_hours, transactions, revenue, recorded_time, eligible_products, equal_share [new enum] |

Missing/zero denominator stops allocation or invokes the configured fallback (`04:97`).

### tax_rule (new — DEC-003/022/045)
| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| id, organization_id | uuid | no | |
| code, name | text | no | `code` unique per organization; e.g. NO_VAT_FOOD, NO_VAT_STANDARD, NO_VAT_EXEMPT |
| rate_pct | numeric(9,6) | no | |
| tax_basis | text | no | inclusive/exclusive |
| recoverable | boolean | no | input VAT recoverability |
| tax_treatment | text | no | `fixed` / `channel_overridable`; default `channel_overridable` (DEC-045) |
| applies_to | text | no | product / service / fee / cost |
| scope_type | text | no | org, location, storage, channel, company_wide |
| location_id, channel_id | uuid | yes | optional narrowing; narrowing is data, not schema |
| effective_from / effective_to | timestamptz | no / yes | |

Resolution order (DEC-045): a line takes a **fixed** rate where `tax_treatment = fixed` (for example a book at
0 %, retail packs such as flour mixes and coffee bean bags at 15 %); otherwise it uses the item default rate with
the channel override (`channel_overridable`: eat-in 25 % / takeaway 15 %). The resolved rate is stored as
`sales_line.applied_tax_rate` for reconciliation.

> **Frontline mapping (2026-09-18).** Frontline's **"Alternative price / Alternative VAT"** (the default 25 %
> vs alternative 15 % pair on one product, eat-in/takeaway) maps to a **channel-scoped `price_version`** plus a
> **channel-overridable `tax_rule`** — not to a second product. The **applied** rate must be stored on the
> **sales line** (`sales_line.applied_tax_rate`, with `channel_id`/`tax_code_id`) because the same item can post
> at either rate; the export must supply the applied price/VAT per line (DEC-042/045, `SAMPLE_ANALYSIS.md §10`).

### channel_fee_rule (new — PRICE-001, `04:48`)
| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| id, organization_id, channel_id | uuid | no | |
| fee_kind | text | no | commission_pct, processing_pct, fixed_per_order, delivery_subsidy, discount_funding |
| percentage_rate | numeric(9,6) | yes | |
| fixed_amount | numeric(19,4) | yes | |
| fee_basis | text | no | gross_price, net_price, per_order [DEC-022] |
| tax_rule_id | uuid | yes | |
| effective_from / effective_to | timestamptz | no / yes | |

### exchange_rate (new — DEC-023)
| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| id, organization_id | uuid | no | |
| base_currency, quote_currency | char(3) | no | |
| rate | numeric(19,10) | no | |
| rate_date | date | no | |
| source | text | no | `norges_bank` default |
| unique | (base_currency, quote_currency, rate_date) | | |

### cost_card / calculation_snapshot / snapshot_component (COST-005/008)
| Table | Key columns | Notes |
| --- | --- | --- |
| cost_card | id, organization_id, product_variant_id, location_id, channel_id, recipe_version_id, state (draft/approved/superseded), calculated_at, approved_by/at, snapshot_id | |
| calculation_snapshot | id, cost_card_id or price_scenario_id (exactly one), cost_selection_policy, as_of timestamptz, tax_rule_version, fx_rate_id, rounding_method, rounding_scales jsonb, rule_version, totals jsonb, created_at | immutable |
| snapshot_component | id, snapshot_id, component_kind, item_id, quantity, unit_id, unit_cost, amount, rounding_boundary, provenance jsonb | one row per stored intermediate (B0–B4) |

**Cost selection precedence (DEC-047).** The base-unit cost for an item resolves in strict order:
(1) the latest **approved supplier price** effective on or before `as_of`; failing that, (2) the latest
**cost observation** (`cost_observation`) effective on or before `as_of`; failing that, (3) the item's
manually maintained **`current_cost`**. The snapshot stores the resolved `source_type` and `observed_at`
alongside the value so a calculation shows which source supplied it (see `CALCULATION_CONTRACT.md §3`).

### price_scenario / price_version (PRICE-001/002/003)
| Table | Key columns | Notes |
| --- | --- | --- |
| price_scenario | id, organization_id, product_variant_id, location_id, channel_id, gross_price, net_price, target_contribution_pct, volume_assumption, fee_breakdown jsonb, outcome jsonb, state, created_by | |
| price_version | id, organization_id, product_variant_id, location_id, channel_id, gross_price, net_price, effective_from, effective_to, approved_by/at, source_scenario_id | approved only; no overlap per scope |

## 4A. Workforce (MVP — DEC-037, DEC-038)

Employee names, shifts and hours are personal data, permission-gated by role and location scope.
Costing never reads these tables: it uses productive hours plus the loaded role/cost-centre rate only
(DEC-012). Worked hours derive from registered shifts with manager corrections; there is no
clock-in/clock-out in the MVP, but the schema keeps room for actual time tracking (DEC-038).

### employee (WF-001)
| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| id, organization_id | uuid | no | |
| user_id | uuid | yes | optional FK `app_user`; an employee may exist without a login (WF-001) |
| name | text | no | personal data; restricted, audited access |
| role_code | text | no | `role_code` enum (see `role`); used for shift matching |
| employment_type | text | no | `employment_type` enum: full_time, part_time, on_call, temporary, apprentice |
| base_hourly_rate | numeric(19,4) | no | rate only; costing reads loaded role/cost-centre rate, not this employee (DEC-012) |
| cost_center_id | uuid | yes | FK cost_center (deferred slice) |
| primary_location_id | uuid | yes | FK location |
| active_from / active_to | date | no / yes | |
| retired_at | timestamptz | yes | master record: retire, never delete (`03.10`) |
| created_by/at, updated_by/at, version | | | standard audit columns |

### shift (WF-002)
| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| id, organization_id, location_id | uuid | no | |
| role_code | text | yes | null = any role |
| starts_at / ends_at | timestamptz | no | `ends_at > starts_at` |
| break_minutes | integer | no | default 0; `>= 0` |
| state | text | no | `shift_state` enum: open, published, assigned, cancelled, completed |
| published_at | timestamptz | yes | set when published |
| created_by | uuid | no | FK `app_user` |
| actual_start / actual_end | timestamptz | yes | reserved for later actual time tracking (DEC-038); null in MVP |
| created_at | timestamptz | no | |

### shift_assignment (WF-003)
| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| id, organization_id | uuid | no | |
| shift_id | uuid | no | FK shift |
| employee_id | uuid | no | FK employee |
| state | text | no | `shift_assignment_state` enum: self_assigned, pending_approval, approved, withdrawn, rejected |
| assigned_by | uuid | yes | FK `app_user`; null = self-assigned |
| assigned_at | timestamptz | no | |
| unique (shift_id, employee_id) | | | one assignment per employee per shift |

### shift_adjustment (WF-004 — manual correction, DEC-038)
| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| id, organization_id | uuid | no | |
| shift_assignment_id | uuid | no | FK shift_assignment |
| adjusted_hours | numeric(9,2) | no | `>= 0`; corrects derived worked hours |
| reason | text | no | required |
| approved_by / approved_at | uuid / timestamptz | yes | manager approval |
| created_at | timestamptz | no | |

### payroll_report (WF-005)
| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| id, organization_id | uuid | no | |
| period_start / period_end | date | no | monthly period |
| generated_at | timestamptz | no | about 3 days before month-end (DEC-037) |
| generated_by | uuid | no | FK `app_user` |
| status | text | no | `payroll_report_status` enum: draft, generated, exported, superseded [new enum] |
| snapshot | jsonb | no | frozen employee/hours/rate/expected-pay lines; makes the report reproducible |
| export_file_id | uuid | yes | FK file_object (deferred slice); restricted export |
| created_at | timestamptz | no | |

Worked hours are derived from registered shifts; corrections are recorded as `shift_adjustment` rows,
never by editing the shift (DEC-038). `payroll_report` is a payroll-**input** report only: statutory
payroll processing, tax withholding and payslips remain out of scope. These enums (`shift_state`,
`shift_assignment_state`, `employment_type`, `payroll_report_status`) are now defined in
`schemas/domain-enums.yaml`, which is authoritative (reconciled 2026-09-18).

## 4B. AI-assisted analysis (Phase 4 — DEC-039, ADR-0009)

Scheduled background jobs call an LLM provider and produce **advisory** outputs that require human
approval (FCST-004). Inputs must exclude personal data: only aggregated/business data is sent, and
`input_scope` records exactly what was used. Provider, model, prompt version, input snapshot, output
and cost are stored per run for reproducibility (see `07.11`).

### ai_analysis_run
| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| id | uuid | no | PK |
| organization_id | uuid | no | FK organization |
| kind | text | no | `forecast` / `menu` / `seasonal` / `other` |
| provider | text | no | e.g. OpenCode Go/Zen; adapter target, not hard-coded |
| model | text | no | model ID resolved from env/secret manager |
| prompt_version | text | no | identifies the exact prompt template used |
| input_snapshot | jsonb | no | frozen inputs for reproducibility; **must exclude personal data** |
| output | jsonb | no | raw advisory output from the provider |
| input_scope | jsonb | no | what the run covered (org/location/category/product/period) |
| status | text | no | run outcome, e.g. `pending` / `running` / `succeeded` / `failed` |
| token_counts | jsonb | no | prompt/completion/total tokens |
| cost_estimate | numeric(19,4) | yes | provider cost estimate; `>= 0` |
| created_at | timestamptz | no | standard default `now()` |

### ai_suggestion
| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| id | uuid | no | PK |
| analysis_run_id | uuid | no | FK ai_analysis_run |
| scope_type | text | no | e.g. location, category, product, period |
| scope_ref | uuid | yes | referenced entity id for the scope |
| suggestion | jsonb | no | one advisory suggestion |
| state | text | no | `proposed` / `approved` / `rejected` / `superseded` |
| decided_by | uuid | yes | FK `app_user`; set on approval/rejection |
| decided_at | timestamptz | yes | set on approval/rejection |
| reason | text | yes | required on rejection/supersession |

Outputs are advisory only and never auto-publish prices, place orders or change menus; every approval
or rejection is audited (`07.3`, `07.11`).

## 4C. Competitor intelligence (Phase 5 — DEC-020)

Automated monitoring runs only for approved, permitted sources; restricted sources (for example
Instagram) are captured manually in-app (URL/screenshot/note) and never scraped. A competitor may have
several sources. Observations carry provenance (source URL + capture time/method) and require human
review before use; no personal data is collected. Reviewed observations feed AI-assisted analysis
(§4B, DEC-039). New enums `source_type`, `collection_mode`, `terms_status` and `review_state` must be
added to `schemas/domain-enums.yaml`.

### competitor_source
| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| id, organization_id | uuid | no | |
| competitor_name | text | no | competitor label; several sources per competitor allowed |
| competitor_id | uuid | yes | optional link to an internal competitor master (deferred slice) |
| source_type | text | no | `source_type` enum: website, wolt, instagram_manual, other |
| url_or_identifier | text | no | public URL or source-specific identifier |
| collection_mode | text | no | `collection_mode` enum: automated, manual; automated only for approved permitted sources |
| terms_status | text | no | `terms_status` enum: pending, approved, rejected; default `pending`; automation requires `approved` |
| approved_by / approved_at | uuid / timestamptz | yes | per-source terms/legal approval; required before automated collection |
| rate_limit_note | text | yes | `robots.txt`/rate-limit and collection config notes |
| active_from / active_to | date | no / yes | source active window |
| created_by/at, updated_by/at, version | | | standard audit columns |

### competitor_observation (COMP-001)
| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| id, organization_id | uuid | no | |
| competitor_source_id | uuid | no | FK competitor_source |
| observed_date | date | no | date the offer/price was observed |
| captured_at | timestamptz | no | capture timestamp |
| capture_method | text | no | `collection_mode` enum: automated, manual |
| source_url | text | yes | exact URL/evidence reference |
| offer | text | yes | competitor offer/product |
| product_category | text | yes | |
| price | numeric(19,4) | yes | `>= 0` |
| currency | char(3) | yes | default `NOK` |
| season | text | yes | planning season/period |
| provenance | jsonb | no | default `{}`; URL, capture time, method and any content hash |
| review_state | text | no | `review_state` enum: pending, reviewed, rejected; default `pending` |
| reviewer_id / reviewed_at | uuid / timestamptz | yes | human review before use |

Observations are advisory input only: they are not used until `review_state = reviewed`, automated
collection is allowed only for `terms_status = approved` sources, and no personal data is stored
(DEC-020, COMP-001; `07.12`).

## 4D. Integrations and external publishing (Phase 3 — DEC-015, ADR-0011)

External writes are permitted but governed **per source and per operation**; read-only ingestion is no
longer the universal default, and internal remains the system of record for approved costs/prices
(DEC-002). Each integration declares an allowed-operations registry and a named credentials owner; no
write operation is enabled until it is explicitly approved and its terms confirmed. Publishing is
push-only from an approved internal change, as an idempotent job with confirmation read-back, audit,
rollback and failure alerts (`07.13`, INTG-001..003). The enums `allowed_operation` and
`publish_status` are now defined in `schemas/domain-enums.yaml`.

### integration_source (INTG-001)
| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| id | uuid | no | PK |
| organization_id | uuid | no | FK organization |
| name | text | no | human label; e.g. "Main POS", "Medusa storefront" |
| system_type | text | no | `pos` / `medusa` / `sanity` / `wolt` / `fiken` / `other` |
| direction | text | no | `read` / `write` / `read_write`; default `read` (read-only until approved) |
| allowed_operations | text[] | no | default `{}`; subset of `allowed_operation`: read, write_price, write_menu_product, write_stock, write_accounting; empty = no write permitted |
| credentials_owner | text | no | named owner accountable for credentials/rotation |
| rate_limit_note | text | yes | source rate-limit and retry/backoff notes |
| terms_status | text | no | `terms_status` enum: pending, approved, rejected; default `pending`; a write operation requires `approved` |
| active | boolean | no | default true |
| created_by/at, updated_by/at, version | | | standard audit columns (credentials themselves live in the secret manager, never here) |

### publish_run (INTG-002)
| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| id | uuid | no | PK |
| integration_source_id | uuid | no | FK integration_source |
| entity_type | text | no | published internal entity kind (e.g. price_version, product_variant, stock state, accounting doc) |
| entity_id | uuid | no | published entity id (polymorphic; not FK'd) |
| operation | text | no | `allowed_operation` write value: write_price / write_menu_product / write_stock / write_accounting |
| idempotency_key | text | no | unique per integration; `unique (integration_source_id, idempotency_key)`; retries/replays cannot double-write |
| status | text | no | `publish_status` enum: pending, running, succeeded, failed, rolled_back; default `pending` |
| request_snapshot | jsonb | no | default `{}`; exact request payload sent to the source |
| response_snapshot | jsonb | yes | source response / read-back evidence |
| confirmed_at | timestamptz | yes | when a confirmation read-back observed the write landed |
| rollback_of_id | uuid | yes | self-FK; set on a rollback job to reference the original run |
| error | text | yes | failure detail when `status = failed` |
| created_by | uuid | no | FK `app_user` |
| created_at | timestamptz | no | default now() |

Each publish attempt and outcome is audited (`07.3`, FND-005); a failed, unconfirmed or rolled-back
run raises a failure alert to the integration owner (`07.13`).

## 5. Procurement

### purchase_order / purchase_order_line (PROC-006, Should)
| Table | Key columns |
| --- | --- |
| purchase_order | id, organization_id, supplier_id, location_id, reference, status, ordered_at, expected_at, created_by |
| purchase_order_line | id, purchase_order_id, supplier_item_id, item_id, ordered_pack_qty, unit_id, agreed_unit_price, currency |

### goods_receipt / goods_receipt_line (PROC-002, `05.2`)
| Table | Key columns |
| --- | --- |
| goods_receipt | id, organization_id, supplier_id, location_id, purchase_order_id (nullable), delivery_ref, received_at, status (draft/submitted/accepted/rejected/reversed), accepted_by/at, reversal_of_id, evidence_file_id |
| goods_receipt_line | id, goods_receipt_id, supplier_item_id (nullable), item_id, received_pack_qty, accepted_pack_qty, rejected_pack_qty, unit_id, pack_to_base_factor, price, discount, tax_basis, tax_code_id, allocated_freight, import_fee, lot_number, expiry_date, base_qty_accepted, landed_base_unit_cost |

`goods_receipt.supplier_id` is **nullable** and `goods_receipt.store_name` may be used instead: an ad-hoc
grocery purchase has no supplier master (DEC-047). Likewise `goods_receipt_line.supplier_item_id` is nullable.

Acceptance posts stock movements + supplier_price history atomically (`02:77`, `05:19`).

## 6. Inventory (Phase 2)

### stock_movement (INV-001) — the ledger
| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| id | uuid | no | PK |
| organization_id, location_id, storage_area_id | uuid | no | |
| item_id | uuid | no | |
| lot_id | uuid | yes | |
| transfer_id | uuid | yes | added with the transfer slice (DEC-029); not yet in the draft DDL — pairs dispatch/receipt for consolidation elimination |
| movement_type | text | no | receipt, receipt_reversal, production_consumption, production_output, sale_consumption, transfer_dispatch, transfer_receipt, waste, count_adjustment, correction, revaluation [add] |
| quantity_delta | numeric(19,6) | no | **signed**; negative = out |
| unit_id | uuid | no | must equal item base unit |
| unit_cost | numeric(19,4) | yes | cost at posting (outbound retains) |
| value_delta | numeric(19,4) | yes | signed |
| currency | char(3) | yes | |
| source_type | text | no | goods_receipt, production_batch, transfer, stock_count, sales_line, waste_event, adjustment, revaluation, correction [DEC-028] |
| source_id | uuid | no | FK to source (polymorphic, check-constrained) |
| reversal_of_id | uuid | yes | self-FK for reversals |
| occurred_at | timestamptz | no | business event time |
| posted_at | timestamptz | no | default now() |
| posted_by | uuid | no | |
| reason_code | text | yes | required for adjustments/waste |
| idempotency_key | text | yes | unique where not null |

Append-only: no UPDATE/DELETE (enforced by trigger/role grants). Every posted movement has exactly
one business source (`03:102`). Reversal references the original and offsets it (DEC-028).

Consumption of a batch-made intermediate (DEC-036) is posted in the item's base unit and may draw a
whole or partial portion; the unconsumed remainder stays in stock and is only recorded as waste if it
is actually discarded/spoiled.

### stock_lot
| id, organization_id, item_id, location_id, lot_number, expiry_date, opened_date, received_at, source_movement_id | |

### stock_balance (projection)
| Column | Notes |
| --- | --- |
| id | uuid surrogate PK |
| item_id, location_id, storage_area_id, lot_id | natural key (lot-less bucket representable) |
| quantity_on_hand numeric(19,6), value_on_hand numeric(19,4), avg_unit_cost numeric(19,4), as_of timestamptz | rebuilt from ledger; never edited directly (`02:70`) |

Key: `unique nulls not distinct (item_id, location_id, storage_area_id, lot_id)` with surrogate `id`,
so the lot-less balance bucket is representable.

Invariant: `quantity_on_hand = Σ quantity_delta from stock_movement at cutoff` (`09:33`).

### stock_count / count_line (INV-004)
| Table | Key columns |
| --- | --- |
| stock_count | id, organization_id, location_id, scope jsonb, blind boolean, cutoff timestamptz, status (draft/counting/submitted/approved/cancelled), approved_by/at |
| count_line | id, stock_count_id, item_id, storage_area_id, lot_id, expected_qty, counted_qty, variance_qty, reason_code, recount boolean |

### transfer (INV-005)
| id, organization_id, from_location_id, from_storage_area_id, to_location_id, to_storage_area_id, status (draft/requested/approved/dispatched/received/cancelled), dispatched_at, received_at, dispatch_movement_id, receipt_movement_id, discrepancy_note |

Dispatch: source→transit + source reduction; receipt: transit→destination (DEC-029).

### reorder_policy (INV-006 for low-stock/expiry alerting; PLAN-001 for reorder suggestions)
| id, organization_id, item_id, location_id, lead_time_days, safety_stock_qty, review_cadence, order_multiple, min_order_qty, preferred_supplier_id, effective_from/to |

DEC-019 model: a simple per-item/location reorder threshold (quantity or package count) plus optional
safety stock now; per-item consumption, lead-time and reorder-outcome history is captured from day one
so later advisory reorder suggestions from history, trend and seasonality can be derived (PLAN-003).

Packaging items (takeaway boxes, cups, cutlery) are counted per package (piece/pack) and reorder
triggers fire when the package count reaches a per-item threshold (DEC-004).

## 7. Production and waste (Phase 2)

### production_plan
| id, organization_id, location_id, production_date, status, created_by |

### production_batch (PROD-001..003, `05.5`)
| id, organization_id, location_id, workstation, recipe_version_id, plan_id (nullable), status (planned/released/in_progress/completed/cancelled), planned_start, actual_start, actual_finish, operator_id, destination_storage_area_id, planned_output_qty, actual_output_qty, yield_variance_pct, reversal_of_id |

### production_batch_input / production_batch_output (new — DEC-031)
| Table | Key columns |
| --- | --- |
| production_batch_input | id, production_batch_id, item_id, unit_id, planned_qty, actual_qty, variance_qty, lot_id, reason_code, movement_id |
| production_batch_output | id, production_batch_id, item_id, unit_id, kind (finished/intermediate/by_product/waste), planned_qty, actual_qty, variance_qty, lot_id, expiry_date, movement_id |

Completion atomically posts consumption, output and linked waste movements (`02:78`, `05:53`).

Portions (DEC-036): a `production_batch_output` for a batch-made intermediate is recorded in the
item's base unit, optionally as N standard portions; a consumption may be a whole or partial portion.
Consuming a partial portion is not waste: the unconsumed remainder stays in stock and is only
recorded as waste when it is actually discarded/spoiled.

### waste_event (WASTE-001/002)
| id, organization_id, location_id, storage_area_id, item_id (or product_variant_id), production_batch_id, quantity, unit_id, stage, reason_code, value_method, value, currency, occurred_at, actor_id, photo_file_id, corrective_action, snapshot_id |

`value_method` enum: `cost_selection`, `moving_average`, `latest_price`, `manual` [new enum, resolves
the undefined "value method" in `03:99`].

## 8. Sales, imports and reconciliation (Phase 3)

### import_run / import_staging_row (SALE-001)
| Table | Key columns |
| --- | --- |
| import_run | id, organization_id, source, profile_version, file_object_id, file_hash (unique), period_start/end, status (uploaded/parsed/needs_review/validated/posted/partially_posted/failed/superseded), row_counts jsonb, diagnostics jsonb, created_by |
| import_staging_row | id, import_run_id, source_row_no, raw jsonb, normalized jsonb, mapping_state (unmapped/mapped/ignored/error), error_code, linked_sales_line_id |

### external_mapping (SALE-002)
| id, organization_id, source_system, entity_type, external_id, sku, internal_entity_type, internal_entity_id, effective_from, effective_to | `sku` is the **preferred match key** for sales/item lines, falling back to `external_id` and then name when no SKU is present; unique (source_system, entity_type, external_id, effective_from); conflict rule (DEC-033): conflicting rows (same external ID → two internal products, or two external IDs → one internal) are flagged and blocked for review; resolution creates an approved superseding `ExternalMapping` with effective dates, history is preserved and posted facts are never silently remapped |

### sales_transaction / sales_line (SALE-003/005)
| Table | Key columns |
| --- | --- |
| sales_transaction | id, organization_id, location_id, channel_id, source_system, external_transaction_id, occurred_at, gross_amount, net_amount, tax_amount, discount_amount, refund_amount, currency, import_run_id |
| sales_line | id, organization_id, sales_transaction_id, product_variant_id (nullable until mapped), external_product_ref, sku, quantity, unit_price, gross_amount, net_amount, tax_amount, applied_tax_rate, discount_amount, refund_amount, channel_id, tax_code_id, parent_line_id (self-FK), option_kind, channel_fee_basis, mapping_state, reversal_of_id |

Unique: `(source_system, external_transaction_id)` and `(source_system, external_transaction_id,
external_line_id)` so replay cannot duplicate (`03:115`, SALE-003).

`applied_tax_rate` records the VAT rate **actually applied** on the line (alongside `tax_code_id`): the POS
charges 25 % dine-in and 15 % takeaway/catering on the same product, with no separate " T" products, so the
same item carries a different rate by channel. `option_kind` (`standalone` / `attached` / `included`) plus
`parent_line_id` (self-FK, set when the line is an option attached to a parent product) normalize add-ons
that may arrive as separate standalone lines or as attached options. The `option_kind` enum values are
`standalone`, `attached`, `included` and must be added to `schemas/domain-enums.yaml` (DEC-041, DEC-042, DEC-043).
Lines with `option_kind = 'included'` are the pre-selected included option lines: they carry **zero price**
and are **retained for consumption/costing but excluded from revenue and margin**. Where a topping is both
included and paid, **distinct items/SKUs are required** (or Frontline must pre-select without pricing); the
per-flavour included-topping mapping is operational data still to be supplied.

### settlement / reconciliation (REC-001/002)
| Table | Key columns |
| --- | --- |
| settlement | id, organization_id, provider, channel_id, period_start/end, paid_amount, fee_amount, refund_amount, currency, source_file_id, status |
| reconciliation | id, organization_id, scope_type, scope_id, period_start/end, expected_amount, actual_amount, tolerance, difference, status (pending/within_tolerance/exception/resolved/approved), resolution_note, owner_id, due_date |

### period_close / adjustment_period / daily_close (REC-003/004, DEC-027)
| Table | Key columns |
| --- | --- |
| period_close | id, organization_id, scope_type (location/company), scope_id, period_start/end, checklist jsonb, snapshot jsonb, locked boolean, locked_by/at, correction_policy, reopened_by/at, reopen_reason |
| adjustment_period | id, organization_id, opened_from, opened_to, reason, approved_by/at, status |
| daily_close | id, organization_id, location_id, business_date, checklist jsonb, snapshot_id, approved_by/at, locked |

## 9. Workflow, governance, platform

| Table | Key columns | Requirement |
| --- | --- | --- |
| approval | id, organization_id, entity_type, entity_id, entity_version, requested_by/at, decided_by/at, decision (approved/rejected), comment | FND-005 |
| task | id, organization_id, type, linked_entity_type/id, owner_id, due_date, priority, status, resolution, created_from_event_id | `05:9` |
| audit_event | id, organization_id, actor_id, impersonation_context, action, entity_type, entity_id, entity_version, before jsonb, after jsonb, reason, request_id, correlation_id, occurred_at | FND-005, `07:32` |
| outbox_event | id, organization_id, event_type, event_version, aggregate_type, aggregate_id, payload jsonb, occurred_at, published_at, attempts, dead_lettered_at | `02:85`, OPS-002 |
| job | id, organization_id, queue, kind, payload jsonb, status, attempts, max_attempts, scheduled_at, started_at, finished_at, error, idempotency_key | OPS-001 |
| file_object | id, organization_id, storage_key, filename, mime, size_bytes, checksum_sha256, retention_policy, uploaded_by/at, linked_entity_type/id | SEC-002 |
| data_quality_exception | id, organization_id, rule_code, severity, entity_type/id, detected_at, owner_id, due_date, status, resolution | DQ-001 |

## 10. Cross-cutting invariants (must hold in schema and tests)

1. `stock_balance ≡ Σ stock_movement` at any cutoff (`09:33`).
2. Posted movements are immutable; corrections are reversals/adjustments (`09:32`).
3. Effective-dated versions never overlap in the same scope (`09:31`).
4. Reversals reference and offset the original; ledger stays balanced at every cutoff (DEC-028).
5. `(source_system, external_transaction_id[, external_line_id])` unique → replay-safe (SALE-003).
6. Locked period facts cannot change without an authorized correction workflow (`09:37`, REC-004).
7. Snapshot reproducibility at B0–B4 from stored components (`09:38`, COST-008).
8. Money/quantity are `numeric`, never float (`02:66`, `13:87`).

## 11. Open items

- DEC-028 fixes reversal per source type and the revaluation movement.
- Enum values in `schemas/domain-enums.yaml` must be approved alongside this dictionary.
- New enums `product_kind` (`base` / `variant` / `add_on`) and `tax_treatment` (`fixed` /
  `channel_overridable`) must be added to `schemas/domain-enums.yaml` (DEC-044, DEC-045).
- New enum `cost_source` (`receipt` / `manual` / `excel`) for `cost_observation` must be added to
  `schemas/domain-enums.yaml` (DEC-047).
