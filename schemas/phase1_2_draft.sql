-- Phase 1-2 schema draft (representative core, not exhaustive).
-- Companion to docs/phase0/DATA_DICTIONARY.md.
-- Target: PostgreSQL 16. Draft for technical review; policy fields marked [DEC-xxx].
-- ponytail: only the ledger + effective-dating + money/quantity + outbox cores are DDL'd here.
--           Remaining tables follow the same patterns and are added per slice.
--
-- COVERAGE: this is a representative core, not the full Phase 1-2 DDL. The tables below
--   are intentionally deferred to later slices (same patterns apply, not DDL'd here):
-- ponytail: deferred to slice "master data": unit_conversion, supplier, supplier_item, cost_center
-- ponytail: deferred to slice "cost allocation": operating_cost, labor_rate, asset, cost_pool, allocation_rule
-- ponytail: deferred to slice "allergens": allergen, recipe_allergen
-- ponytail: deferred to slice "pricing": price_version
-- ponytail: deferred to slice "receiving": purchase_order, purchase_order_line, goods_receipt, goods_receipt_line, reorder_policy
-- ponytail: deferred to slice "inventory operations": stock_count, stock_count_line, transfer
-- ponytail: deferred to slice "production": production_plan, production_batch, production_batch_input, production_batch_output
-- ponytail: deferred to slice "waste": waste_event
-- ponytail: deferred to slice "integration/sales": import_run, import_staging, external_mapping (sales_transaction/sales_line are declared below)
-- ponytail: deferred to slice "settlement": settlement, reconciliation
-- ponytail: deferred to slice "period close": period_close, adjustment_period, daily_close
-- ponytail: deferred to slice "platform": approval, task, job, file_object, data_quality_exception

create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists btree_gist; -- exclusion constraints on ranges

-- ---------------------------------------------------------------------------
-- Conventions / reusable checks
-- ---------------------------------------------------------------------------
-- Money: numeric(19,4) + ISO currency. Quantity: numeric(19,6) + unit_id.
-- Never float. Every mutable table carries organization_id.
-- Audit columns: each slice adds the standard columns (created_at, created_by,
--   updated_at, updated_by, version) per the repository convention. Ledger rows
--   are append-only instead and carry posted_by / posted_at (see stock_movement).

-- ---------------------------------------------------------------------------
-- Organization and identity
-- ---------------------------------------------------------------------------
create table organization (
  id          uuid primary key default gen_random_uuid(),
  legal_name  text not null,
  currency    char(3) not null default 'NOK',
  timezone    text not null default 'Europe/Oslo',
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create table location (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  code            text not null,
  name            text not null,
  kind            text not null default 'operating'
                    check (kind in ('operating','central_production','virtual_transit')),
  address         text,
  active_from     date not null default current_date,
  active_to       date,
  unique (organization_id, code),
  check (active_to is null or active_to > active_from)
);

create table storage_area (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  location_id     uuid not null references location(id),
  code            text not null,
  name            text not null,
  kind            text not null check (kind in
                    ('kitchen','dry_store','refrigerator','freezer','front_counter','transit','other')),
  is_transit      boolean not null default false,
  unique (location_id, code)
);

create table channel (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  code            text not null,
  name            text not null,
  is_delivery     boolean not null default false,
  unique (organization_id, code)
);

-- ---------------------------------------------------------------------------
-- Identity and authentication (DEC-013): internal auth, no external IdP.
-- Passwords: Argon2id (fallback bcrypt), ~250 ms cost, per-user salt; never MD5/SHA.
-- TOTP 2FA (RFC 6238): secret encrypted at rest, recovery codes hashed, single-use.
-- Sessions and reset tokens stored as hashes; sessions revoked server-side.
-- ---------------------------------------------------------------------------
create table app_user (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organization(id),
  username            text,                                  -- nullable: staff may lack a username
  email               text,                                  -- nullable: staff may lack an email
  display_name        text not null,
  password_hash       text not null,                         -- Argon2id, never MD5/SHA
  password_changed_at timestamptz,
  status              text not null default 'active'
                        check (status in ('invited','active','disabled','locked')),
  failed_login_count  integer not null default 0 check (failed_login_count >= 0),
  locked_until        timestamptz,
  last_login_at       timestamptz,
  totp_enabled        boolean not null default false,
  created_at          timestamptz not null default now(),
  created_by          uuid,
  updated_at          timestamptz,
  updated_by          uuid,
  version             integer not null default 1,
  check (username is not null or email is not null)   -- at least one identifier for login
);
-- Case-insensitive uniqueness within an organization; partial so the other identifier may be null.
create unique index app_user_username_key
  on app_user (organization_id, lower(username)) where username is not null;
create unique index app_user_email_key
  on app_user (organization_id, lower(email)) where email is not null;

-- ---------------------------------------------------------------------------
-- Assignable ownership (FND-007 -- DEC-014 clarification, 2026-09-14)
-- Ownership roles (product / technical / operational data) and per-data-area
-- business owners are assignable grants, not fixed fields: granted/revoked with
-- effective dates and audit. Paulo Paes is the initial holder, not a constant.
-- Placed after organization and app_user so both FKs are already declared:
-- no forward references.
-- ---------------------------------------------------------------------------
create table data_ownership (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  data_area       text not null check (data_area in
                    ('products_recipes_allergens','supplier_items_costs','prices_channels_tax',
                     'inventory_waste','sales_mappings_settlements','labor_assumptions',
                     'competitor_observations','user_access_audit')),
  owner_user_id   uuid not null references app_user(id),
  review_cadence  text,
  effective_from  timestamptz not null,
  effective_to    timestamptz,
  granted_by      uuid references app_user(id),
  granted_at      timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from)
);
create index data_ownership_org_area_idx on data_ownership (organization_id, data_area);

create table role (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  code            text not null check (code in
                    ('owner','gm','location_manager','kitchen','foh','purchasing','finance','admin','analyst')),
  name            text not null,
  description     text,
  unique (organization_id, code)
);

create table user_role (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references app_user(id) on delete cascade,
  role_id     uuid not null references role(id),
  location_id uuid references location(id),          -- null = all locations
  granted_by  uuid references app_user(id),
  granted_at  timestamptz not null default now(),
  unique nulls not distinct (user_id, role_id, location_id)
);

create table user_location_scope (
  user_id     uuid not null references app_user(id) on delete cascade,
  location_id uuid not null references location(id),
  primary key (user_id, location_id)
);

create table user_totp (
  user_id             uuid primary key references app_user(id) on delete cascade,
  secret_encrypted    text not null,                 -- encrypted at rest
  confirmed_at        timestamptz,
  recovery_codes_hash text[] not null default '{}'   -- hashed, single-use
);

create table auth_session (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references app_user(id) on delete cascade,
  token_hash  text not null unique,
  issued_at   timestamptz not null default now(),
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  user_agent  text,
  ip          inet,
  check (expires_at > issued_at)
);
create index auth_session_user_idx on auth_session (user_id) where revoked_at is null;

create table password_reset_token (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references app_user(id) on delete cascade,
  token_hash  text not null unique,                  -- hashed at rest, single-use
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_by  uuid references app_user(id),          -- admin-assisted reset; null = self-service
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Integrations and external publishing (Phase 3 -- DEC-015, ADR-0011)
-- Writes are permitted but governed per source and per operation; read-only
-- is no longer the universal default (a source stays read-only until each
-- operation is approved). Internal remains the system of record for approved
-- costs/prices (DEC-002). Credentials live in the managed secret store with a
-- named owner -- never in these rows (07.13, INTG-001/002).
-- Placed after organization and app_user so both FKs are already declared:
-- no forward references.
-- ---------------------------------------------------------------------------
create table integration_source (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organization(id),
  name                text not null,
  system_type         text not null check (system_type in
                        ('pos','medusa','sanity','wolt','fiken','other')),
  direction           text not null default 'read'
                        check (direction in ('read','write','read_write')),
  allowed_operations  text[] not null default '{}'
                        check (allowed_operations <@
                          array['read','write_price','write_menu_product','write_stock','write_accounting']::text[]),
  credentials_owner   text not null,                 -- named owner; secret itself is in the secret store
  rate_limit_note     text,
  terms_status        text not null default 'pending'
                        check (terms_status in ('pending','approved','rejected')),
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  created_by          uuid references app_user(id),
  updated_at          timestamptz,
  updated_by          uuid references app_user(id),
  version             integer not null default 1,
  -- no write operation is enabled until the source's terms are approved (DEC-015)
  check (terms_status = 'approved' or not (allowed_operations &&
    array['write_price','write_menu_product','write_stock','write_accounting']::text[]))
);
create index integration_source_org_idx on integration_source (organization_id);

create table publish_run (
  id                    uuid primary key default gen_random_uuid(),
  integration_source_id uuid not null references integration_source(id),
  entity_type           text not null,               -- published internal entity kind
  entity_id             uuid not null,               -- polymorphic; not FK'd
  operation             text not null check (operation in
                          ('write_price','write_menu_product','write_stock','write_accounting')),
  idempotency_key       text not null,
  status                text not null default 'pending'
                          check (status in ('pending','running','succeeded','failed','rolled_back')),
  request_snapshot      jsonb not null default '{}'::jsonb,
  response_snapshot     jsonb,                       -- source response / read-back evidence
  confirmed_at          timestamptz,                 -- confirmation read-back observed the write landed
  rollback_of_id        uuid references publish_run(id),
  error                 text,
  created_by            uuid not null references app_user(id),
  created_at            timestamptz not null default now(),
  unique (integration_source_id, idempotency_key),   -- retries/replays cannot double-write
  check (confirmed_at is null or status = 'succeeded')
);
create index publish_run_source_idx on publish_run (integration_source_id, created_at);

-- ---------------------------------------------------------------------------
-- Competitor intelligence (Phase 5 -- DEC-020)
-- Automated collection only for approved, permitted sources; restricted
-- sources (e.g. Instagram) are captured manually and never scraped. A
-- competitor may have several sources; observations carry provenance and
-- require human review before use; no personal data (07.12, COMP-001/003).
-- Placed after organization and app_user so the approver/reviewer FKs are
-- already declared: no forward references.
-- ---------------------------------------------------------------------------
create table competitor_source (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organization(id),
  competitor_name   text not null,
  competitor_id     uuid,                              -- internal competitor master (deferred slice); no FK yet
  source_type       text not null check (source_type in
                      ('website','wolt','instagram_manual','other')),
  url_or_identifier text not null,
  collection_mode   text not null check (collection_mode in ('automated','manual')),
  terms_status      text not null default 'pending'
                      check (terms_status in ('pending','approved','rejected')),
  approved_by       uuid references app_user(id),      -- per-source terms/legal approval
  approved_at       timestamptz,
  rate_limit_note   text,                              -- robots.txt / rate-limit and config notes
  active_from       date not null default current_date,
  active_to         date,
  created_at        timestamptz not null default now(),
  created_by        uuid references app_user(id),
  updated_at        timestamptz,
  updated_by        uuid references app_user(id),
  version           integer not null default 1,
  check (active_to is null or active_to > active_from),
  -- automated collection requires recorded approval
  check (collection_mode <> 'automated' or terms_status = 'approved'),
  -- an approval must record who approved it and when
  check (terms_status <> 'approved' or (approved_by is not null and approved_at is not null))
);
create index competitor_source_org_idx on competitor_source (organization_id);

create table competitor_observation (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references organization(id),
  competitor_source_id uuid not null references competitor_source(id),
  observed_date        date not null,
  captured_at          timestamptz not null default now(),
  capture_method       text not null check (capture_method in ('automated','manual')),
  source_url           text,
  offer                text,
  product_category     text,
  price                numeric(19,4) check (price is null or price >= 0),
  currency             char(3) default 'NOK',
  season               text,
  provenance           jsonb not null default '{}'::jsonb,   -- URL, capture time, method, content hash
  review_state         text not null default 'pending'
                         check (review_state in ('pending','reviewed','rejected')),
  reviewer_id          uuid references app_user(id),
  reviewed_at          timestamptz,
  created_at           timestamptz not null default now(),
  -- a review decision must record the reviewer and the time
  check (review_state = 'pending' or (reviewer_id is not null and reviewed_at is not null))
);
create index competitor_observation_source_idx on competitor_observation (competitor_source_id);

-- ---------------------------------------------------------------------------
-- Units and catalog
-- ---------------------------------------------------------------------------
create table unit (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  code            text not null,
  dimension       text not null check (dimension in ('mass','volume','count','time','package')),
  is_base         boolean not null default false,
  unique (organization_id, code)
);

create table item (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organization(id),
  code             text not null,
  sku              text not null,   -- business-controller-owned stable key; published to the POS; reconciliation key (DEC-041)
  name             text not null,
  item_type        text not null check (item_type in
                     ('ingredient','packaging','cleaning_supply','consumable',
                      'intermediate','finished_good','non_stock_supply')),
  base_unit_id     uuid not null references unit(id),
  inventory_policy text not null default 'stocked'
                     check (inventory_policy in ('stocked','non_stock','made_to_order')), -- [DEC-030]
  lot_tracked      boolean not null default false,
  shelf_life_days  integer check (shelf_life_days is null or shelf_life_days >= 0),
  standard_portion_size numeric(19,6)
                     check (standard_portion_size is null or standard_portion_size > 0),
  portion_unit_id  uuid references unit(id),
  current_cost     numeric(19,4) check (current_cost is null or current_cost >= 0),  -- manual fallback cost (DEC-047)
  current_cost_updated_at timestamptz,
  active_from      date not null default current_date,
  active_to        date,
  unique (organization_id, code),
  unique (organization_id, sku),
  check (active_to is null or active_to > active_from)
);

-- ---------------------------------------------------------------------------
-- Cost observations (DEC-047): receipt/manual/Excel cost catalogue for ad-hoc
-- grocery purchases with no supplier master. Cost selection precedence is
-- approved supplier_price -> latest cost_observation -> item.current_cost.
-- Placed after item and unit so both FKs are already declared: no forward
-- references. receipt_file_id is a plain uuid (file_object is a deferred slice).
-- ---------------------------------------------------------------------------
create table cost_observation (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organization(id),
  item_id          uuid not null references item(id),
  store_name       text,                              -- free-text store; supplier relationships are optional
  observed_at      date not null,
  pack_size        numeric(19,6) check (pack_size is null or pack_size > 0),
  pack_unit_id     uuid references unit(id),
  pack_price       numeric(19,4) check (pack_price is null or pack_price >= 0),
  currency         char(3) not null default 'NOK',
  source           text not null check (source in ('receipt','manual','excel')),
  receipt_file_id  uuid,                              -- FK file_object when that slice is declared
  notes            text,
  created_at       timestamptz not null default now()
);
create index cost_observation_item_idx
  on cost_observation (organization_id, item_id, observed_at);

-- ---------------------------------------------------------------------------
-- Tax / fees / FX (new entities required by DEC-003, DEC-022, DEC-023)
-- ---------------------------------------------------------------------------
create table tax_rule (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  code            text not null,
  name            text not null,
  rate_pct        numeric(9,6) not null check (rate_pct >= 0),
  tax_treatment   text not null default 'channel_overridable'
                    check (tax_treatment in ('fixed','channel_overridable')),   -- fixed item rate vs item default + channel override (DEC-045)
  tax_basis       text not null check (tax_basis in ('inclusive','exclusive')),
  recoverable     boolean not null default false,
  applies_to      text not null check (applies_to in ('product','service','fee','cost')),
  scope_type      text not null default 'company_wide'
                    check (scope_type in ('organization','location','storage','channel','company_wide')),
  location_id     uuid references location(id),
  channel_id      uuid references channel(id),
  effective_from  timestamptz not null,
  effective_to    timestamptz,
  created_at      timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from),
  unique (organization_id, code)   -- tax code identifiers are global per org; location/channel narrowing is data
);

create table channel_fee_rule (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  channel_id      uuid not null references channel(id),
  fee_kind        text not null check (fee_kind in
                    ('commission_pct','processing_pct','fixed_per_order','delivery_subsidy','discount_funding')),
  percentage_rate numeric(9,6) check (percentage_rate is null or percentage_rate >= 0),
  fixed_amount    numeric(19,4) check (fixed_amount is null or fixed_amount >= 0),
  fee_basis       text not null check (fee_basis in ('gross_price','net_price','per_order')), -- [DEC-022]
  tax_rule_id     uuid references tax_rule(id),
  effective_from  timestamptz not null,
  effective_to    timestamptz,
  check (effective_to is null or effective_to > effective_from),
  -- exactly one of percentage_rate / fixed_amount, matching the fee kind
  check (
    case fee_kind
      when 'commission_pct'   then percentage_rate is not null and fixed_amount is null
      when 'processing_pct'   then percentage_rate is not null and fixed_amount is null
      when 'fixed_per_order'  then fixed_amount is not null and percentage_rate is null
      when 'delivery_subsidy' then fixed_amount is not null and percentage_rate is null
      when 'discount_funding' then fixed_amount is not null and percentage_rate is null
      else false
    end
  )
);
alter table channel_fee_rule add constraint channel_fee_rule_no_overlap
  exclude using gist (
    channel_id with =,
    fee_kind with =,
    tstzrange(effective_from, effective_to) with &&
  );

create table exchange_rate (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  base_currency   char(3) not null,
  quote_currency  char(3) not null,
  rate            numeric(19,10) not null check (rate > 0),
  rate_date       date not null,
  source          text not null default 'norges_bank',
  unique (organization_id, base_currency, quote_currency, rate_date)
);

-- ---------------------------------------------------------------------------
-- Supplier pricing
-- ---------------------------------------------------------------------------
create table supplier_price (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organization(id),
  supplier_item_id    uuid not null,   -- FK supplier_item (deferred slice). Supplier relationships are OPTIONAL (DEC-047):
                                       -- most items are bought ad hoc from grocery stores, so ad-hoc costs are recorded as
                                       -- cost_observation rows instead. Convention: goods_receipt.supplier_id is likewise
                                       -- nullable and goods_receipt/goods_receipt_line may use store_name (free text) instead;
                                       -- goods_receipt is a deferred slice and is not declared in this file. No existing FK is
                                       -- broken by this convention.
  gross_pack_price    numeric(19,4) not null check (gross_pack_price >= 0),
  discount            numeric(19,4) not null default 0 check (discount >= 0),
  tax_basis           text not null check (tax_basis in ('inclusive','exclusive')),
  tax_rule_id         uuid references tax_rule(id),
  allocated_freight   numeric(19,4) not null default 0,
  import_fee          numeric(19,4) not null default 0,
  other_cost          numeric(19,4) not null default 0,
  net_pack_price      numeric(19,4) not null,
  landed_pack_cost    numeric(19,4) not null,
  landed_base_unit_cost numeric(19,4) not null,        -- rounding boundary B1
  currency            char(3) not null default 'NOK',
  source_receipt_id   uuid,
  effective_from      timestamptz not null,
  effective_to        timestamptz,
  check (effective_to is null or effective_to > effective_from)
);
alter table supplier_price add constraint supplier_price_no_overlap
  exclude using gist (
    supplier_item_id with =,
    tstzrange(effective_from, effective_to) with &&
  );

-- ---------------------------------------------------------------------------
-- Recipes and products
-- ---------------------------------------------------------------------------
create table recipe (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  code            text not null,
  name            text not null,
  output_item_id  uuid references item(id),
  created_at      timestamptz not null default now(),
  unique (organization_id, code)
);

create table recipe_version (
  id                    uuid primary key default gen_random_uuid(),
  recipe_id             uuid not null references recipe(id),
  version_no            integer not null,
  state                 text not null default 'draft'
                          check (state in ('draft','submitted','approved','rejected','retired')),
  planned_input_qty     numeric(19,6) not null check (planned_input_qty > 0),
  planned_output_qty    numeric(19,6) not null check (planned_output_qty > 0),
  approved_usable_output numeric(19,6) not null check (approved_usable_output > 0),
  yield_rate            numeric(9,6) not null check (yield_rate > 0 and yield_rate <= 1),
  preparation_minutes   integer check (preparation_minutes is null or preparation_minutes >= 0),
  effective_from        timestamptz not null,
  effective_to          timestamptz,
  approved_by           uuid,
  approved_at           timestamptz,
  notes                 text,
  unique (recipe_id, version_no),
  check (effective_to is null or effective_to > effective_from)
);
alter table recipe_version add constraint recipe_version_no_overlap
  exclude using gist (
    recipe_id with =,
    tstzrange(effective_from, effective_to) with &&
  );

create table recipe_line (
  id               uuid primary key default gen_random_uuid(),
  recipe_version_id uuid not null references recipe_version(id) on delete cascade,
  component_kind   text not null check (component_kind in ('ingredient','packaging','sub_recipe')),
  item_id          uuid references item(id),
  sub_recipe_id    uuid references recipe(id),
  quantity         numeric(19,6) not null check (quantity > 0),
  unit_id          uuid not null references unit(id),
  loss_factor      numeric(9,6) not null default 1 check (loss_factor > 0 and loss_factor <= 1),
  stage            text,
  substitution_group text,
  check ((item_id is not null)::int + (sub_recipe_id is not null)::int = 1)
);

create table product (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  code            text not null,
  name            text not null,
  category        text,
  product_kind    text not null default 'base'
                    check (product_kind in ('base','variant','add_on')),   -- platform taxonomy (DEC-044)
  active_from     date not null default current_date,
  active_to       date,
  unique (organization_id, code),
  check (active_to is null or active_to > active_from)
);

create table product_variant (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references organization(id),
  product_id           uuid not null references product(id),
  code                 text not null,
  sku                  text not null,   -- business-controller-owned stable key; unique per organization; reconciliation key (DEC-041)
  name                 text not null,
  size                 text,
  finished_good_item_id uuid references item(id),   -- [DEC-030] sellable may map to a stocked item
  active_from          date not null default current_date,
  active_to            date,
  unique (product_id, code),
  unique (organization_id, sku),   -- SKU is the org-wide reconciliation key (DEC-041), not product-scoped
  check (active_to is null or active_to > active_from)
);

-- Effective-dated link from an add-on product to the base products it may be added
-- to, with an optional price effect (DEC-044). Placed after product so the FKs are
-- already declared: no forward references. Add-on classification drives menu
-- engineering and costing, not automatic parentage reconstruction.
create table addon_applicability (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organization(id),
  addon_product_id uuid not null references product(id),
  base_product_id  uuid not null references product(id),
  price_effect     numeric(19,4),                 -- optional surcharge/delta; null = no price effect
  active_from      date not null default current_date,
  active_to        date,
  check (addon_product_id <> base_product_id),
  check (active_to is null or active_to > active_from)
);
create index addon_applicability_base_idx
  on addon_applicability (organization_id, base_product_id);

create table product_recipe_assignment (
  id                uuid primary key default gen_random_uuid(),
  product_variant_id uuid not null references product_variant(id),
  location_id       uuid not null references location(id),
  recipe_version_id uuid not null references recipe_version(id),
  effective_from    timestamptz not null,
  effective_to      timestamptz,
  check (effective_to is null or effective_to > effective_from)
);
alter table product_recipe_assignment add constraint pra_no_overlap
  exclude using gist (
    product_variant_id with =,
    location_id with =,
    tstzrange(effective_from, effective_to) with &&
  );

-- ---------------------------------------------------------------------------
-- Sales import and reconciliation (SALE-003/005 -- DEC-041, DEC-042, DEC-043)
-- SKU is the business-controller-owned stable key published to the POS and used
-- as the primary reconciliation key. The new Frontline POS charges dine-in at
-- 25% and takeaway/catering at 15% on the SAME product (no separate " T"
-- products), so channel_id and the applied_tax_rate actually applied are
-- captured per line. Add-ons may arrive as standalone lines or attached to a
-- parent product; option_kind + parent_line_id normalize both shapes on import.
-- Unmapped or invalid rows are retained in a review queue, never discarded
-- (SALE-004). Placed after product_variant/channel/location/tax_rule so every FK
-- is already declared: no forward references. import_run is a deferred slice,
-- so import_run_id is a plain uuid (no FK yet), matching the deferred-slice
-- convention used for employee.cost_center_id.
-- ---------------------------------------------------------------------------
create table sales_transaction (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null references organization(id),
  location_id             uuid references location(id),
  channel_id              uuid references channel(id),
  source_system           text not null,
  external_transaction_id text not null,
  occurred_at             timestamptz not null,
  gross_amount            numeric(19,4),
  net_amount              numeric(19,4),
  tax_amount              numeric(19,4),
  discount_amount         numeric(19,4),
  refund_amount           numeric(19,4),
  currency                char(3) not null default 'NOK',
  import_run_id           uuid,   -- FK import_run when that slice is declared
  unique (source_system, external_transaction_id)   -- replay cannot duplicate (SALE-003)
);

create table sales_line (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references organization(id),
  sales_transaction_id uuid not null references sales_transaction(id),
  product_variant_id   uuid references product_variant(id),   -- nullable until mapped
  external_product_ref text,
  sku                  text,
  external_line_id     text,
  quantity             numeric(19,6) not null,
  unit_price           numeric(19,4),
  gross_amount         numeric(19,4),
  net_amount           numeric(19,4),
  tax_amount           numeric(19,4),
  applied_tax_rate     numeric(9,6) check (applied_tax_rate is null or applied_tax_rate >= 0),  -- rate actually applied (DEC-042)
  discount_amount      numeric(19,4),
  refund_amount        numeric(19,4),
  channel_id           uuid references channel(id),
  tax_code_id          uuid references tax_rule(id),
  parent_line_id       uuid references sales_line(id),   -- set when this line is an attached option
  option_kind          text not null default 'standalone'
                         check (option_kind in ('standalone','attached','included')),
  channel_fee_basis    text,   -- fee basis used for the channel fee applied to this line
  mapping_state        text not null default 'unmapped'
                         check (mapping_state in ('unmapped','mapped','ignored','error')),
  reversal_of_id       uuid references sales_line(id),   -- self-reference for reversals
  unique (sales_transaction_id, external_line_id),
  -- attached/included lines must point at a parent line; standalone lines must not
  check (option_kind = 'standalone' or parent_line_id is not null)
);
create index sales_line_transaction_idx on sales_line (sales_transaction_id);
create index sales_line_sku_idx on sales_line (organization_id, sku);

-- ---------------------------------------------------------------------------
-- Cost cards and reproducible snapshots
-- ---------------------------------------------------------------------------
create table price_scenario (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organization(id),
  product_variant_id uuid not null references product_variant(id),
  location_id        uuid references location(id),
  channel_id         uuid references channel(id),
  gross_price        numeric(19,4),
  net_price          numeric(19,4),
  state              text not null default 'draft'
                       check (state in ('draft','submitted','approved','rejected')),
  created_at         timestamptz not null default now()
);

create table cost_card (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organization(id),
  product_variant_id uuid not null references product_variant(id),
  location_id       uuid not null references location(id),
  channel_id        uuid references channel(id),
  recipe_version_id uuid references recipe_version(id),
  state             text not null default 'draft'
                      check (state in ('draft','approved','superseded')),
  cost_selection_policy text not null default 'latest_approved_price', -- [DEC-021]
  calculated_at     timestamptz not null default now(),
  approved_by       uuid,
  approved_at       timestamptz,
  snapshot_id       uuid   -- fk added after calculation_snapshot (mutual reference)
);

create table calculation_snapshot (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organization(id),
  cost_card_id       uuid references cost_card(id) deferrable initially deferred,
  price_scenario_id  uuid references price_scenario(id),
  cost_selection_policy text not null,
  as_of              timestamptz not null,
  tax_rule_snapshot  jsonb not null default '{}'::jsonb,
  fx_rate_id         uuid references exchange_rate(id),
  rounding_method    text not null default 'HALF_UP',        -- [DEC-024]
  rounding_scales    jsonb not null default '{"qty":6,"money":4,"presented":2}'::jsonb,
  rule_version       text not null,
  totals             jsonb not null,
  created_at         timestamptz not null default now(),
  check ((cost_card_id is not null)::int + (price_scenario_id is not null)::int = 1)
);
-- cost_card.snapshot_id <-> calculation_snapshot.cost_card_id are mutually referential;
-- both FKs are deferrable initially deferred so either side can be inserted first.
alter table cost_card add constraint cost_card_snapshot_fk
  foreign key (snapshot_id) references calculation_snapshot(id)
  deferrable initially deferred;

create table snapshot_component (
  id               uuid primary key default gen_random_uuid(),
  snapshot_id      uuid not null references calculation_snapshot(id) on delete cascade,
  component_kind   text not null,
  item_id          uuid references item(id),
  quantity         numeric(19,6),
  unit_id          uuid references unit(id),
  unit_cost        numeric(19,4),
  amount           numeric(19,4),
  rounding_boundary text check (rounding_boundary in ('B0','B1','B2','B3','B4')),
  provenance       jsonb not null default '{}'::jsonb
);

-- ---------------------------------------------------------------------------
-- Inventory ledger (append-only) and projection
-- ---------------------------------------------------------------------------
create table stock_lot (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  item_id         uuid not null references item(id),
  location_id     uuid not null references location(id),
  lot_number      text,
  expiry_date     date,
  opened_date     date,
  received_at     timestamptz,
  source_movement_id uuid,
  unique (item_id, location_id, lot_number)
);

create table stock_movement (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organization(id),
  location_id       uuid not null references location(id),
  storage_area_id   uuid not null references storage_area(id),
  item_id           uuid not null references item(id),
  lot_id            uuid references stock_lot(id),
  movement_type     text not null check (movement_type in
                      ('receipt','receipt_reversal','production_consumption','production_output',
                       'sale_consumption','transfer_dispatch','transfer_receipt','waste',
                       'count_adjustment','correction','revaluation')),
  quantity_delta    numeric(19,6) not null
                      check (quantity_delta <> 0 or coalesce(value_delta, 0) <> 0),  -- signed; value-only revaluation/correction allowed
  unit_id           uuid not null references unit(id),
  unit_cost         numeric(19,4) check (unit_cost is null or unit_cost >= 0),
  value_delta       numeric(19,4),
  currency          char(3),
  source_type       text not null check (source_type in
                      ('goods_receipt','production_batch','transfer','stock_count',
                       'sales_line','waste_event','adjustment','revaluation','correction')),
  source_id         uuid not null,   -- polymorphic source, validated by trigger per slice
  reversal_of_id    uuid references stock_movement(id),
  occurred_at       timestamptz not null,
  posted_at         timestamptz not null default now(),
  posted_by         uuid not null,
  reason_code       text,
  idempotency_key   text,
  unique (idempotency_key)
);

-- Append-only enforcement: block UPDATE/DELETE/TRUNCATE regardless of application code.
create or replace function reject_posted_movement_change() returns trigger language plpgsql as $$
begin
  raise exception 'stock_movement is append-only; post a reversal/adjustment instead';
end $$;

create trigger stock_movement_immutable
  before update or delete on stock_movement
  for each row execute function reject_posted_movement_change();

-- Statement-level trigger closes the TRUNCATE bypass that row triggers leave open.
create trigger stock_movement_no_truncate
  before truncate on stock_movement
  for each statement execute function reject_posted_movement_change();

-- Shared immutability guard for append-only tables (snapshots, audit).
create or replace function reject_immutable_change() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only; % is not permitted', tg_table_name, tg_op;
end $$;

create trigger calculation_snapshot_immutable
  before update or delete on calculation_snapshot
  for each row execute function reject_immutable_change();
create trigger calculation_snapshot_no_truncate
  before truncate on calculation_snapshot
  for each statement execute function reject_immutable_change();

-- Balance is a projection, rebuilt from the ledger; never edited directly.
create table stock_balance (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organization(id),
  item_id          uuid not null references item(id),
  location_id      uuid not null references location(id),
  storage_area_id  uuid not null references storage_area(id),
  lot_id           uuid references stock_lot(id),
  quantity_on_hand numeric(19,6) not null default 0,
  value_on_hand    numeric(19,4) not null default 0,
  avg_unit_cost    numeric(19,4),
  as_of            timestamptz not null,
  constraint stock_balance_key
    unique nulls not distinct (item_id, location_id, storage_area_id, lot_id)
);

-- ---------------------------------------------------------------------------
-- Platform: outbox + audit (append-only)
-- ---------------------------------------------------------------------------
create table outbox_event (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  event_type      text not null,
  event_version   integer not null default 1,
  aggregate_type  text not null,
  aggregate_id    uuid not null,
  payload         jsonb not null,
  occurred_at     timestamptz not null default now(),
  published_at    timestamptz,
  attempts        integer not null default 0,
  dead_lettered_at timestamptz
);

create table audit_event (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  actor_id        uuid,
  impersonation_context jsonb,
  action          text not null,
  entity_type     text not null,
  entity_id       uuid,
  entity_version  integer,
  before          jsonb,
  after           jsonb,
  reason          text,
  request_id      text,
  correlation_id  text,
  occurred_at     timestamptz not null default now()
);

create trigger audit_event_immutable
  before update or delete on audit_event
  for each row execute function reject_immutable_change();
create trigger audit_event_no_truncate
  before truncate on audit_event
  for each statement execute function reject_immutable_change();

-- Representative indexes for as-of balance queries within the 10s posting budget (NFR 7.7).
create index stock_movement_balance_idx
  on stock_movement (organization_id, item_id, location_id, storage_area_id, lot_id, occurred_at, posted_at);
create index stock_movement_source_idx on stock_movement (source_type, source_id);
create index snapshot_component_snapshot_idx on snapshot_component (snapshot_id);
create index outbox_unpublished_idx on outbox_event (occurred_at) where published_at is null;

-- ---------------------------------------------------------------------------
-- Workforce scheduling (MVP -- DEC-037, DEC-038)
-- Personal data: permission-gated by role + location scope; costing never reads
-- these rows (DEC-012 -- hours + loaded rate only). Worked hours derive from
-- shifts with manager corrections; no clock-in in the MVP, but actual_start /
-- actual_end keep room for later actual time tracking without rework (DEC-038).
-- ponytail: cost_center is a deferred slice (see COVERAGE), so employee.cost_center_id
--           is a plain uuid rather than an FK, avoiding a forward reference.
-- ---------------------------------------------------------------------------
create table employee (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organization(id),
  user_id             uuid references app_user(id),   -- optional login; employee may exist without one
  name                text not null,
  role_code           text not null,
  employment_type     text not null
                        check (employment_type in ('permanent','temporary','part_time','casual')),
  base_hourly_rate    numeric(19,4) not null check (base_hourly_rate >= 0),
  cost_center_id      uuid,                           -- FK cost_center when that slice is declared
  primary_location_id uuid references location(id),
  active_from         date not null default current_date,
  active_to           date,
  retired_at          timestamptz,
  created_at          timestamptz not null default now(),
  created_by          uuid,
  updated_at          timestamptz,
  updated_by          uuid,
  version             integer not null default 1,
  check (active_to is null or active_to > active_from)
);

create table shift (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  location_id     uuid not null references location(id),
  role_code       text,                               -- null = any role
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  break_minutes   integer not null default 0 check (break_minutes >= 0),
  state           text not null default 'open'
                    check (state in ('open','published','assigned','cancelled')),
  published_at    timestamptz,
  created_by      uuid references app_user(id),
  actual_start    timestamptz,                        -- reserved: actual time tracking later (DEC-038)
  actual_end      timestamptz,
  created_at      timestamptz not null default now(),
  check (ends_at > starts_at),
  check (actual_end is null or actual_start is null or actual_end > actual_start)
);

create table shift_assignment (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  shift_id        uuid not null references shift(id),
  employee_id     uuid not null references employee(id),
  state           text not null default 'self_assigned'
                    check (state in ('self_assigned','approved')),
  assigned_by     uuid references app_user(id),       -- null = self-assigned
  assigned_at     timestamptz not null default now(),
  unique (shift_id, employee_id)
);

create table shift_adjustment (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organization(id),
  shift_assignment_id uuid not null references shift_assignment(id),
  adjusted_hours      numeric(9,2) not null check (adjusted_hours >= 0),
  reason              text not null,
  approved_by         uuid references app_user(id),
  approved_at         timestamptz,
  created_at          timestamptz not null default now()
);

create table payroll_report (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  period_start    date not null,
  period_end      date not null,
  generated_at    timestamptz not null default now(),
  generated_by    uuid references app_user(id),
  status          text not null default 'generated'
                    check (status in ('draft','generated','exported','superseded')),
  snapshot        jsonb not null default '{}'::jsonb,
  export_file_id  uuid,                               -- FK file_object when that slice is declared
  created_at      timestamptz not null default now(),
  check (period_end >= period_start)
);

create index shift_location_time_idx on shift (organization_id, location_id, starts_at);
create index shift_assignment_employee_idx on shift_assignment (employee_id);

-- ---------------------------------------------------------------------------
-- AI-assisted analysis and suggestions (Phase 4 -- DEC-039, ADR-0009)
-- Advisory only: scheduled jobs call an external LLM (OpenCode Go/Zen), but
-- outputs never auto-publish prices, place orders or change menus; every
-- suggestion requires human approval. Inputs exclude personal data
-- (aggregated/business data only). provider/model/prompt_version/input/output/
-- cost are stored per run for reproducibility; per-run + monthly cost limits,
-- rate limiting and a kill switch live in the job layer (07.11).
-- Placed here (not beside organization) so both FKs -- organization and
-- app_user -- are already declared: no forward references.
-- ---------------------------------------------------------------------------
create table ai_analysis_run (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  kind            text not null check (kind in ('forecast','menu','seasonal','other')),
  provider        text not null,
  model           text not null,
  prompt_version  text not null,
  input_snapshot  jsonb not null default '{}'::jsonb,   -- frozen inputs; never personal data
  output          jsonb not null default '{}'::jsonb,
  input_scope     jsonb not null default '{}'::jsonb,
  status          text not null default 'pending'
                    check (status in ('pending','running','succeeded','failed','cancelled')),
  token_counts    jsonb not null default '{}'::jsonb,
  cost_estimate   numeric(19,4) check (cost_estimate is null or cost_estimate >= 0),
  created_at      timestamptz not null default now()
);

create index ai_analysis_run_org_created_idx on ai_analysis_run (organization_id, created_at);

create table ai_suggestion (
  id              uuid primary key default gen_random_uuid(),
  analysis_run_id uuid not null references ai_analysis_run(id),
  scope_type      text not null,                        -- location, category, product, period
  scope_ref       uuid,
  suggestion      jsonb not null default '{}'::jsonb,
  state           text not null default 'proposed'
                    check (state in ('proposed','approved','rejected','superseded')),
  decided_by      uuid references app_user(id),
  decided_at      timestamptz,
  reason          text
);

