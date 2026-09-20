# Runbook — persistence migrations

How to generate and apply the PostgreSQL schema owned by
`packages/persistence`, and how to recover from a failed bootstrap.

Authority: `schemas/phase1_2_draft.sql`, `schemas/domain-enums.yaml`,
`docs/phase0/DATA_DICTIONARY.md` and ADR-0002 (Drizzle + drizzle-kit;
forward-only, transactional, rehearsed migrations; expand → migrate → contract
with a tested rollback/recovery path).

## Environment

Node is not on PATH in this repo; use nvm. Postgres 16 runs locally via Docker
Compose (user/password/database all `aquarela`, `localhost:5432`):

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22
docker compose up -d postgres            # add /Applications/Docker.app/Contents/Resources/bin to PATH if `docker` is not found
DATABASE_URL=postgres://aquarela:aquarela@localhost:5432/aquarela npm run db:migrate
```

`drizzle.config.ts` and `scripts/migrate.mjs` both resolve
`DATABASE_MIGRATIONS_URL ?? DATABASE_URL` (the direct/session URL wins) and have
no default. Copy `.env.example` to `.env` for local work (git-ignored), or pass
it inline.

## Layout

- Schema modules: `packages/persistence/src/schema/*.ts`, re-exported by
  `packages/persistence/src/schema/index.ts` (the `drizzle.config.ts` `schema`
  entry point) and `packages/persistence/src/index.ts`.
- Controlled vocabularies: `packages/persistence/src/schema/vocabularies.ts`.
  `schemas/domain-enums.yaml` is the authority; the SQL `check` constraints are
  generated from these arrays (`enumCheck` in `columns.ts`).
- Migrations: `packages/persistence/drizzle/`, ordered by
  `packages/persistence/drizzle/meta/_journal.json`.

## Generate a migration

From the repo root:

```bash
npm run db:generate -- --name=<name>            # DDL diffed from the schema
npm run db:generate -- --custom --name=<name>   # empty file for hand-written SQL
```

- `drizzle-kit generate` never touches the database; it diffs the TypeScript
  schema against `drizzle/meta/` snapshots.
- Hand-written SQL is only for what drizzle-kit cannot express: extensions,
  exclusion constraints, expression/partial indexes, deferrable FKs, triggers.
  The columns those constraints reference are modelled as plain `uuid` in the
  TypeScript schema so `generate` never fights them.
- Review the generated SQL before committing; migrations are schema code.

## Raw-SQL objects are invisible to drizzle-kit

The four exclusion constraints (`channel_fee_rule`, `supplier_price`,
`recipe_version`, `product_recipe_assignment`), the two deferrable mutual FKs
(`cost_card` ↔ `calculation_snapshot`) and the six append-only trigger
functions/triggers (`stock_movement`, `calculation_snapshot`, `audit_event`)
live only in `0002_invariants.sql`; the two `unit_conversion` exclusion
constraints (`unit_conversion_global_no_overlap`, `unit_conversion_item_no_overlap`)
and its `NULLS NOT DISTINCT` `unit_conversion_version_key` live only in
`0005_unit_conversion_invariants.sql`; the three slice-6 cost-allocation
exclusion constraints (`cost_pool_no_overlap`, `labor_rate_no_overlap`,
`allocation_rule_no_overlap`) live only in
`0012_cost_allocation_invariants.sql`; the slice-7
`cost_card_approved_scope_key` partial unique index (`NULLS NOT DISTINCT` on
`(organization_id, product_variant_id, location_id, channel_id)` `WHERE state =
'approved'`) lives only in `0016_cost_card_approved_scope.sql`; the slice-8
`stock_movement_source_guard` trigger/function (the per-`source_type`
validation of `stock_movement.source_id`) lives only in
`0017_stock_ledger_invariants.sql`, and its **body is replaced** by
`0020_slice9_counts_transfers_waste.sql` to also validate the slice-9
`stock_count`, `transfer` and `waste_event` sources and again by
`0021_slice10_production.sql` to add the `production_batch` source (the
`goods_receipt`/`stock_count`/`transfer`/`waste_event` branches are kept; the
remaining source types stay documented no-ops); the
`goods_receipt_line_accept_qty_guard` trigger/function (an accepted receipt's
line must have `accepted_pack_qty > 0`; a plain CHECK cannot read the parent
status) lives only in `0007_goods_receipt_line_checks.sql`; and the
`recipe_version_no_overlap` exclusion constraint from `0002` is **replaced** by
a state-gated version in `0010_recipe_version_draft_overlap.sql` (approved /
submitted only, so drafts may overlap; `DEC-053`). This is the
**hand-written invariants convention**: anything drizzle-kit cannot express
(extensions, exclusion constraints, expression/partial indexes, deferrable FKs,
triggers, `NULLS NOT DISTINCT` keys) goes in a hand-written `*_invariants.sql`
or `*_checks.sql` file that mirrors `0002`, and its columns stay plain
`uuid`/`text` in the TypeScript schema so `generate` never fights it. All of
these objects are **not** represented in `drizzle/meta/*_snapshot.json`, so
`drizzle-kit generate` cannot see, protect or recreate them: it does not diff
against them, a later generated migration will never include them, and dropping
them manually is invisible to the tool.

> **Never run `drizzle-kit push` against a shared or live database.** `push`
> diffs the live database against the TypeScript schema and, because the raw
> objects are invisible to it, will silently drop the exclusion constraints, the
> two deferrable FKs, the append-only triggers, the `unit_conversion`
> constraints, the state-gated `recipe_version_no_overlap`, the
> `goods_receipt_line` guard, the three cost-allocation exclusion
> constraints, the `cost_card_approved_scope_key` approval index and the
> `stock_movement_source_guard` validation trigger (extended in `0020` and
> `0021`). Those
> objects live only in
> `0002_invariants.sql`, `0005_unit_conversion_invariants.sql`,
> `0007_goods_receipt_line_checks.sql`,
> `0010_recipe_version_draft_overlap.sql`,
> `0012_cost_allocation_invariants.sql`,
> `0016_cost_card_approved_scope.sql`,
> `0017_stock_ledger_invariants.sql`,
> `0020_slice9_counts_transfers_waste.sql` and
> `0021_slice10_production.sql`; use `generate` + `migrate` and the
> guard below.

**Guard:** before committing any future generated migration, diff the database
schema against the previous revision (`pg_dump --schema-only` before/after, or
an introspection query over `pg_constraint`, `pg_trigger` and `pg_extension`)
and confirm the raw objects are still present. Never rely on a `No schema
changes` generate result alone for them — drizzle-kit cannot report on what it
cannot see.

## Adding a deferred FK later

Deferred columns (see the data dictionary) get their FK constraints added
additively in two steps, so a large backfill or any orphan rows never take a
long lock or fail the migration:

```sql
ALTER TABLE <table> ADD CONSTRAINT <name> FOREIGN KEY (<col>)
  REFERENCES <ref_table>(<id>) NOT VALID;  -- metadata-only, no full-table scan/lock
ALTER TABLE <table> VALIDATE CONSTRAINT <name>;  -- separate step/transaction
```

`NOT VALID` skips the existing-row check (new writes are still checked);
`VALIDATE CONSTRAINT` takes only a weaker lock and can be re-run if it fails.
This applies to: `supplier_price.supplier_item_id`, `supplier_price.source_receipt_id`,
`cost_observation.receipt_file_id`, `stock_lot.source_movement_id`,
`stock_movement.source_id`, `stock_movement.posted_by`, `recipe_version.approved_by`,
`recipe_allergen.verified_by`,
`cost_card.approved_by`, `audit_event.actor_id`, `goods_receipt.purchase_order_id`,
`goods_receipt.accepted_by`, `goods_receipt.evidence_file_id`,
`goods_receipt_line.supplier_item_id`, `operating_cost.evidence_file_id`,
`waste_event.production_batch_id`.

`stock_lot.source_movement_id` was closed by `0017_stock_ledger_invariants.sql`
as an ordinary validating FK (drizzle-kit generated it) because `stock_lot` is
empty at first apply. `waste_event.production_batch_id` was closed by
`0021_slice10_production.sql` using the `NOT VALID` → `VALIDATE` form above
(the `waste_event` table may already hold rows). `stock_movement.source_id`
is guarded by the `0017` `stock_movement_source_guard` trigger rather than an FK,
because its target table varies by `source_type`.

## Pre-apply preflight for validating constraints and indexes

Migrations 0014, 0016, 0017, 0018, 0019, 0020 and 0021 add objects that
validate or build, so a failure aborts the whole transactional migration
(drizzle-kit runs each file in one transaction). Run the matching preflight
against the target database **before** applying and reconcile any hits;
drizzle-kit cannot detect them because these files diff against existing data.

- **`0021_slice10_production.sql`** — four new, empty tables
  (`production_plan`, `production_batch`, `production_batch_input`,
  `production_batch_output`) with their checks, FKs and indexes (cheap: the
  tables are empty on first apply), plus the hand-written
  `ALTER TABLE "waste_event" ADD CONSTRAINT … FOREIGN KEY ("production_batch_id")
  … NOT VALID` followed by `VALIDATE CONSTRAINT` in the same transactional file.
  The `NOT VALID` step is metadata-only; the `VALIDATE` scans `waste_event`, so
  on a large `waste_event` table it is the only lock to schedule. Preflight for
  orphans before applying:

  ```sql
  SELECT id, production_batch_id
  FROM waste_event
  WHERE production_batch_id IS NOT NULL
    AND production_batch_id NOT IN (SELECT id FROM production_batch);
  ```

  Any hit must be repaired before the `VALIDATE` (or the FK added `NOT VALID`
  and left unvalidated, per the pattern above). The
  `CREATE OR REPLACE FUNCTION "stock_movement_source_guard"` that adds the
  `production_batch` branch is metadata-only and scans nothing.

- **`0020_slice9_counts_transfers_waste.sql`** — four new, empty tables
  (`stock_count`, `stock_count_line`, `stock_transfer`, `waste_event`) with
  their checks and indexes, plus the `ALTER TABLE "stock_movement" ADD COLUMN
  "transfer_id" uuid`. `ADD COLUMN` with no `DEFAULT` is metadata-only in
  PostgreSQL 11+, and the column is null on every existing row, so the
  generated `stock_movement_transfer_id_stock_transfer_id_fk` validates cheaply
  (a plain, validating FK takes a `ShareLock` on `stock_movement` for the
  duration of the scan, which is proportional to the table size). The
  `CREATE OR REPLACE FUNCTION "stock_movement_source_guard"` that extends the
  `0017` guard to the slice-9 sources is metadata-only and scans nothing. No
  duplicate preflight is needed; on a large `stock_movement` table the FK
  validation is the only lock to schedule.

- **`0019_stock_movement_asof_index.sql`** — the journaled, non-concurrent
  `CREATE INDEX "stock_movement_org_occurred_idx" ON "stock_movement"
  USING btree ("organization_id","occurred_at","posted_at","id")` builds the
  whole table and takes a write lock, so it cannot use `CONCURRENTLY`. It adds
  no constraint and cannot fail on existing data, but on a large `stock_movement`
  table it blocks writes for the duration of the build; schedule it accordingly.
  No duplicate preflight is needed.

- **`0018_stock_movement_org_idempotency_key.sql`** — the generated
  `ADD CONSTRAINT "stock_movement_org_idempotency_key_key" UNIQUE
  ("organization_id","idempotency_key")` validates existing rows and fails if two
  movements in one organization already share an idempotency key (the pre-0018
  global unique made that impossible across orgs, but the migration is safe only
  after checking). Preflight before applying:

  ```sql
  SELECT organization_id, idempotency_key, count(*)
  FROM stock_movement
  WHERE idempotency_key IS NOT NULL
  GROUP BY 1, 2
  HAVING count(*) > 1;
  ```

  Any hit must be reconciled first. The `DROP CONSTRAINT
  "stock_movement_idempotency_key_key"` is metadata-only.

- **`0017_stock_ledger_invariants.sql`** — the generated
  `ALTER TABLE "stock_lot" ADD CONSTRAINT
  "stock_lot_source_movement_id_stock_movement_id_fk" …` is a plain, validating
  FK. `stock_lot` is populated only by this slice, so at first apply the table
  is empty and the validate is cheap. A plain `ADD CONSTRAINT … FOREIGN KEY`
  validation takes a `ShareLock` on `stock_lot` (blocking writes while it scans);
  if the table may already hold rows, use the `NOT VALID` → `VALIDATE` form
  documented above instead of the generated statement. If `stock_lot` may already
  hold rows, preflight for orphans before applying:

  ```sql
  SELECT id, source_movement_id
  FROM stock_lot
  WHERE source_movement_id IS NOT NULL
    AND source_movement_id NOT IN (SELECT id FROM stock_movement);
  ```

  Any hit must be repaired (or the FK added `NOT VALID` per the pattern above)
  before the first apply. The `stock_movement_source_guard` trigger creation is
  metadata-only and does not scan either table.

- **`0016_cost_card_approved_scope.sql`** — the non-concurrent
  `CREATE UNIQUE INDEX cost_card_approved_scope_key` is journaled, so it cannot
  use `CONCURRENTLY` and takes a write lock, and it fails if duplicate
  `state = 'approved'` rows already exist for a scope:

  ```sql
  SELECT organization_id, product_variant_id, location_id, channel_id, count(*)
  FROM cost_card
  WHERE state = 'approved'
  GROUP BY 1, 2, 3, 4
  HAVING count(*) > 1;
  ```

  Any hit must be reconciled before the index is built: keep the row with the
  newest `calculated_at` and supersede the rest (the same rule `approveCostCard`
  applies, `DEC-060`).

- **`0014_cost_card_pricing.sql`** — `snapshot_component_kind_check` is added with
  a plain, validating `ADD CONSTRAINT … CHECK`. `snapshot_component` is populated
  only by this slice, so at first apply the table is empty and the validate is
  cheap. If the table may already hold rows, preflight for out-of-vocabulary
  values first:

  ```sql
  SELECT DISTINCT component_kind
  FROM snapshot_component
  WHERE component_kind NOT IN
    ('ingredient', 'packaging', 'direct_labor', 'channel_variable',
     'other_variable', 'allocated_overhead');
  ```

  Any hit must be repaired before the check is added; prefer the
  `NOT VALID` → `VALIDATE CONSTRAINT` pattern above rather than a validating
  `ADD CONSTRAINT` in that case, so the first apply never holds a full-table
  validation lock.

## Once data exists, the destructive recovery is no longer permitted

`DROP SCHEMA public CASCADE; DROP SCHEMA drizzle CASCADE; CREATE SCHEMA public;`
is valid **only while the database is empty** (bootstrap). From the first real
datum onward it is forbidden: migrations must be additive and follow
expand → migrate → contract with a tested, data-preserving down path (ADR-0002,
AGENTS.md Rule 2).

Down migrations follow the naming convention `<index>_<name>_down.sql`,
alongside the forward file in `packages/persistence/drizzle/` (or a documented
equivalent if the convention changes). A rollback must be rehearsed against a
production-like copy before release — "tested" means it has actually been run
and verified to restore the prior state without data loss. A `_down.sql` file is
**never** added to `meta/_journal.json`; drizzle-kit applies journal entries
only, so the down file is an explicit operator action, not an automatic one.

- **0000–0002 are bootstrap-generated and have no down companion.** They create
  the schema from nothing (`0000` extensions, `0001` generated core DDL, `0002`
  hand-written invariants); their only rollback while the database is empty is
  the destructive replay in "Recovery / rollback" below.
- **0003 is the first expand/additive migration and follows the down
  convention:** `DROP COLUMN "last_used_counter"` drops no other data, so it is
  safe to run once 0003's feature is not in use. Apply it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0003_user_totp_last_used_counter_down.sql`
  (never `drizzle-kit`, and not via `db:migrate`).
- **0004 adds the four slice-3 master-data tables and follows the down
  convention:** `0004_master_data_down.sql` drops only the tables 0004 created
  (`supplier_item` → `supplier` → `unit_conversion` → `cost_center`, FK-safe
  order) inside one `BEGIN;`/`COMMIT;`, with `DROP TABLE IF EXISTS` so a
  half-applied manual run cannot wedge. Apply it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0004_master_data_down.sql`.
  Only run it once no master-data rows are needed: the drops are destructive and
  financial/stock facts are append-only (AGENTS.md Rule 2).
- **0005 adds the `unit_conversion` invariants and follows the down
  convention:** `0005_unit_conversion_invariants_down.sql` drops the two
  exclusion constraints and the version key (no table, no row), so it is safe to
  run whenever the hand-written invariants must be removed (for example before a
  data repair). Apply it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0005_unit_conversion_invariants_down.sql`.
  Apply 0005's down **before** 0004's down: its constraints live on
  `unit_conversion`, which 0004's down drops.
- **0006 adds the two slice-4 receiving tables and follows the down
  convention:** `0006_goods_receipt_down.sql` drops only the tables 0006 created
  (`goods_receipt_line` → `goods_receipt`, FK-safe order) inside one
  `BEGIN;`/`COMMIT;`, with `DROP TABLE IF EXISTS` so a half-applied manual run
  cannot wedge. The append-only `audit_event` rows that recorded acceptance are
  left in place; apply it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0006_goods_receipt_down.sql`.
  Only run it once no receipt rows are needed: the drops are destructive and
  financial/stock facts are append-only (AGENTS.md Rule 2).
- **0007 adds the hand-written `goods_receipt_line` guard and follows the down
  convention:** `0007_goods_receipt_line_checks_down.sql` drops the
  `goods_receipt_line_accept_qty_guard` trigger and its function (no table, no
  row), so it is safe to run whenever the guard must be removed. Apply it
  manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0007_goods_receipt_line_checks_down.sql`.
- **0008 relaxes `supplier_price_effective_range_check` to `effective_to >=
  effective_from`** (half-open `[)` history allows an empty same-instant
  window) and follows the down convention:
  `0008_supplier_price_effective_range_down.sql` restores the strict `>`. The
  down VALIDATES existing rows, so close/remove any degenerate empty windows
  first. Apply it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0008_supplier_price_effective_range_down.sql`.
  Apply 0008's down **before** 0005's/0004's down, since the constraint lives on
  `supplier_price`.
- **0009 adds the two slice-5 allergen tables and follows the down
  convention:** `0009_recipe_allergens_down.sql` drops only the tables 0009
  created (`recipe_allergen` → `allergen`, FK-safe order) inside one
  `BEGIN;`/`COMMIT;`, with `DROP TABLE IF EXISTS` so a half-applied manual run
  cannot wedge. The recipe tables the declarations point at (`recipe`,
  `recipe_version`, `recipe_line`) were created by the 0001 core and are left
  untouched. Apply it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0009_recipe_allergens_down.sql`.
  Only run it once no allergen declarations are needed: the drops are
  destructive and master records referenced by versions are retired, not
  deleted (AGENTS.md Rule 2).
- **0010 gates `recipe_version_no_overlap` by state and follows the down
  convention:** `0010_recipe_version_draft_overlap.sql` drops the ungated
  constraint from `0002` and recreates it with `WHERE ("state" IN ('approved',
  'submitted'))`, so two **draft** versions of one recipe may overlap in time
  while approved/submitted versions still may not (`DEC-053`).
  `0010_recipe_version_draft_overlap_down.sql` restores the original ungated
  constraint inside one `BEGIN;`/`COMMIT;`. The down **re-add validates every
  existing row**, so it fails (and rolls back, leaving 0010 in place) if
  overlapping drafts exist — resolve or delete them first. Apply it manually
  with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0010_recipe_version_draft_overlap_down.sql`.
  It touches no table and no row, only the constraint, so it is safe once the
  draft overlaps are resolved.
- **0011 adds the four slice-6 cost-allocation tables and follows the down
  convention:** `0011_cost_allocation.sql` is generated DDL for `allocation_rule`,
  `cost_pool`, `labor_rate` and `operating_cost` (checks, FKs and the
  `allocation_rule_cost_pool_idx`, `cost_pool_organization_id_code_idx` and
  `operating_cost_lookup_idx` indexes). `0011_cost_allocation_down.sql` drops only
  the tables 0011 created (`allocation_rule` → `cost_pool` → `labor_rate` →
  `operating_cost`, FK-safe order) inside one `BEGIN;`/`COMMIT;`, with
  `DROP TABLE IF EXISTS` so a half-applied manual run cannot wedge. Its header
  notes that the three `0012` exclusion constraints live on these tables and are
  dropped with them (run `0012_cost_allocation_invariants_down.sql` first only to
  drop them explicitly). Apply it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0011_cost_allocation_down.sql`.
  Only run it once no cost rows are needed: the drops are destructive and
  financial facts are append-only, with operating-cost reversals rather than
  edits (AGENTS.md Rule 2).
- **0012 adds the cost-allocation invariants and follows the down convention:**
  `0012_cost_allocation_invariants.sql` adds the three hand-written effective-dated
  exclusions (`cost_pool_no_overlap`, `labor_rate_no_overlap`,
  `allocation_rule_no_overlap`) that drizzle-kit cannot express; `operating_cost`
  deliberately has no overlap exclusion, since concurrent overheads in one cost
  centre/period are legitimate.
  `0012_cost_allocation_invariants_down.sql` drops the three constraints (no
  table, no row), so it is safe to run whenever the hand-written invariants must
  be removed (for example before a data repair). Apply it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0012_cost_allocation_invariants_down.sql`.
  Apply 0012's down **before** 0011's down: its constraints live on tables 0011's
  down drops.
  The three slice-6 range checks (`cost_pool_effective_range_check`,
  `labor_rate_effective_range_check`, `operating_cost_effective_range_check`)
  stay strict (`effective_to > effective_from`), so an empty same-day window is
  rejected on the slice-6 tables — unlike `supplier_price`, whose check 0008
  relaxed to `effective_to >= effective_from` for a same-instant re-record.
- **0013 adds the `labor_rate` lookup index and follows the down convention:**
  `0013_labor_rate_lookup_index.sql` is generated DDL for
  `labor_rate_lookup_idx` on
  `(organization_id, cost_center_id, role_code, effective_from)`, covering the
  `findEffectiveLaborRate` as-of query.
  `0013_labor_rate_lookup_index_down.sql` drops the index (no table, no row), so
  it is safe to run whenever the index must be removed (for example before a
  data repair). Apply it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0013_labor_rate_lookup_index_down.sql`.
  Apply 0013's down **before** 0011's down: its index lives on `labor_rate`,
  which 0011's down drops.
- **0014 adds the slice-7 pricing columns and the snapshot-component vocabulary
  and follows the down convention:** `0014_cost_card_pricing.sql` is generated
  DDL that adds the four `price_scenario` columns deferred from the Phase 1–2
  core (`target_contribution_pct numeric(9,6)`, `volume_assumption
  numeric(19,6)`, `fee_breakdown jsonb not null default '{}'`, `outcome jsonb
  not null default '{}'` — `DATA_DICTIONARY` §price_scenario) and the
  `snapshot_component_kind_check` on `snapshot_component.component_kind`
  (`SNAPSHOT_COMPONENT_KIND`), closing the controlled-vocabulary obligation
  tracked below. It adds no table.
  `0014_cost_card_pricing_down.sql` drops the four columns and the check inside
  one `BEGIN;`/`COMMIT;`, with `DROP COLUMN IF EXISTS`/`DROP CONSTRAINT IF
  EXISTS` so a half-applied manual run cannot wedge. Unlike 0013's no-row down,
  it is **destructive** — the four columns carry data — so run it only while
  that scenario data need not be preserved (AGENTS.md Rule 2). Apply it manually
  with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0014_cost_card_pricing_down.sql`.
- **0015 adds the `calculation_snapshot` cost-card lookup index and follows the
  down convention:** `0015_calculation_snapshot_cost_card_index.sql` is generated
  DDL for `calculation_snapshot_cost_card_idx` on
  `(cost_card_id, created_at)`, covering the cost-card snapshot history read. It
  adds no table.
  `0015_calculation_snapshot_cost_card_index_down.sql` drops the index (no table,
  no row), so it is safe to run whenever the index must be removed (for example
  before a data repair). Apply it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0015_calculation_snapshot_cost_card_index_down.sql`.
  It touches no table and no row, only the index, so the ordering constraint is
  just that it runs before any drop of the `calculation_snapshot` table.
- **0016 adds the cost-card approved-scope invariant and follows the down
  convention:** `0016_cost_card_approved_scope.sql` is hand-written DDL for
  `cost_card_approved_scope_key`, a partial unique index (`NULLS NOT DISTINCT`
  on `(organization_id, product_variant_id, location_id, channel_id)` `WHERE
  state = 'approved'`) that guarantees at most one approved card per scope —
  the database-level backstop for `approveCostCard`'s supersede rule
  (`DEC-060`). It adds no table and no row.
  `0016_cost_card_approved_scope_down.sql` drops the index (no table, no row), so
  it is safe to run whenever the invariant must be removed (for example before a
  data repair); the application supersede rule remains the only guard while it is
  dropped. Apply it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0016_cost_card_approved_scope_down.sql`.
- **0017 adds the slice-8 stock-ledger invariants and follows the down
  convention:** `0017_stock_ledger_invariants.sql` is the generated FK
  `stock_lot_source_movement_id_stock_movement_id_fk`
  (`stock_lot.source_movement_id` → `stock_movement.id`, closing that deferred
  FK) plus a hand-written `stock_movement_source_guard` BEFORE INSERT trigger
  that asserts, for `source_type = 'goods_receipt'`, that a matching
  `goods_receipt` row in the same organization exists and rejects the movement
  otherwise. Every other `source_type` is a documented no-op until its source
  table is modelled (production/sales/transfer/count are their own slices). It
  adds no table and no row.
  `0017_stock_ledger_invariants_down.sql` drops the trigger, its function and
  the `stock_lot` FK (no table, no row), so it is safe to run whenever the
  invariants must be removed (for example before a data repair); while dropped,
  `stock_movement.source_id` is validated only by the application and the lot's
  source-movement link is unenforced. Apply it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0017_stock_ledger_invariants_down.sql`.
- **0018 scopes the idempotency key per organization and follows the down
  convention:** `0018_stock_movement_org_idempotency_key.sql` is generated DDL
  that drops the global `stock_movement_idempotency_key_key` and adds the
  composite `stock_movement_org_idempotency_key_key` unique on
  `(organization_id, idempotency_key)`, so one organization's key no longer
  blocks another's posting while a retry within an organization still collides.
  It adds no table. This **narrows** `DATA_DICTIONARY` §6's global "unique where
  not null" wording to an organization-scoped namespace; that deviation is
  recorded as a slice-8 open point in `docs/BUILD_ROADMAP.md` §5 (do not silently
  ignore it).
  `0018_stock_movement_org_idempotency_key_down.sql` drops the composite unique
  and restores the global one inside one `BEGIN;`/`COMMIT;`. No table is touched,
  but the restored global constraint **validates existing rows**, so the down
  fails (and rolls back, leaving 0018 in place) if two organizations already
  share an idempotency key — resolve those duplicates first. Apply it manually
  with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0018_stock_movement_org_idempotency_key_down.sql`.
- **0019 adds the stock-movement as-of index and follows the down convention:**
  `0019_stock_movement_asof_index.sql` is generated DDL for
  `stock_movement_org_occurred_idx` on
  `(organization_id, occurred_at, posted_at, id)`, covering the bounded as-of
  aggregation (`sumStockMovementsAsOf`) behind `getStockBalanceAsOf`. It adds no
  table and no row.
  `0019_stock_movement_asof_index_down.sql` drops the index (no table, no row),
  so it is safe to run whenever the index must be removed (for example before a
  data repair); while dropped, `sumStockMovementsAsOf` falls back to a
  sequential scan. Apply it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0019_stock_movement_asof_index_down.sql`.
- **0020 adds the slice-9 count/transfer/waste tables and follows the down
  convention:** `0020_slice9_counts_transfers_waste.sql` is generated DDL for
  the four tables (`stock_count`, `stock_count_line`, `stock_transfer`,
  `waste_event`, with their status/timestamp/quantity checks and indexes) plus
  the `stock_movement.transfer_id` column, its FK and its partial index, and a
  hand-written `CREATE OR REPLACE FUNCTION "stock_movement_source_guard"` that
  extends the `0017` guard so `source_type in ('stock_count', 'transfer',
  'waste_event')` is validated against the matching table (same organization),
  keeping the `goods_receipt` branch. The status-consistency checks
  (`stock_count_approved_check`,
  `stock_transfer_dispatched_check`/`stock_transfer_received_check`) are
  generated in the `CREATE TABLE` statements.
  `0020_slice9_counts_transfers_waste_down.sql` is **destructive**: it restores
  the `0017` guard body, drops `stock_movement.transfer_id` (with its FK and
  partial index) and drops the four tables (FK-safe order: `waste_event`,
  `stock_count_line`, `stock_count`, `stock_transfer`), so it is only safe
  while those tables carry nothing that must be preserved. Apply it manually
  with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0020_slice9_counts_transfers_waste_down.sql`.
- **0021 adds the slice-10 production tables and follows the down
  convention:** `0021_slice10_production.sql` is generated DDL for the four
  tables (`production_plan`, `production_batch`, `production_batch_input`,
  `production_batch_output`, with their status/quantity/kind checks, FKs —
  including the batch→line `ON DELETE cascade` and the batch self-reversal FK —
  and indexes), plus two hand-written statements: the deferred
  `waste_event.production_batch_id` FK (`NOT VALID` → `VALIDATE`, because
  `waste_event` may already hold rows) and a
  `CREATE OR REPLACE FUNCTION "stock_movement_source_guard"` adding the
  `production_batch` branch (keeping the existing branches). The output-kind
  vocabulary (`PRODUCTION_OUTPUT_KIND`) is a provisional local constant with no
  `schemas/domain-enums.yaml` key (open point (h)).
  `0021_slice10_production_down.sql` is **destructive**: it restores the `0020`
  guard body, drops the `waste_event.production_batch_id` FK (the column stays)
  and drops the four tables (FK-safe order: `production_batch_input`,
  `production_batch_output`, `production_batch`, `production_plan`), so it is
  only safe while those tables carry nothing that must be preserved. Apply it
  manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0021_slice10_production_down.sql`.

**Re-applying after a manual down:** drizzle-kit tracks applied migrations in
`drizzle.__drizzle_migrations`, not by comparing the schema, so a plain
`npm run db:migrate` after any down file is a no-op — the migration is still
recorded. To re-apply one, delete its ledger row and migrate again. The ledger
row is identified by `created_at` (the `_journal.json` `when`):
`DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1789847649193;`
for 0003, `… = 1789850858806` for 0004, `… = 1789851925634` for 0005,
`… = 1789853260355` for 0006, `… = 1789853887846` for 0007 and
`… = 1789853918031` for 0008, `… = 1789854468899` for 0009,
`… = 1789855382064` for 0010, `… = 1789862475550` for 0011 and
`… = 1789862630158` for 0012, `… = 1789864504597` for 0013,
`… = 1789866859108` for 0014, `… = 1789867750326` for 0015,
`… = 1789867797172` for 0016, `… = 1789895339462` for 0017,
`… = 1789902579323` for 0018, `… = 1789904976754` for 0019,
`… = 1789911710033` for 0020 and `… = 1789913486015` for 0021, then
`npm run db:migrate` (0003 verified 2026-09-19; 0005 rehearsed in the slice-3
review follow-up; 0006 rehearsed with the slice-4 receiving work; 0007 and
0008 rehearsed with the slice-4 review follow-up; 0009 rehearsed with the
slice-5 recipe work; 0010 rehearsed with the slice-5 review follow-up; 0011
rehearsed with the slice-6 costing work; 0013 rehearsed with the slice-6
code-review follow-up; 0014 rehearsed with the slice-7 pricing work; 0015 and
0016 rehearsed with the slice-7 review follow-up; 0017 rehearsed with the
slice-8 stock-ledger work; 0018 rehearsed with the slice-8 finding-fix work;
0019 rehearsed with the slice-8 review-fix work; 0020 rehearsed with the
slice-9 counts/transfers/waste work; 0021 rehearsed with the slice-10
production work).
A **full 0011 down** drops the tables the three 0012 constraints live on, so its
replay must clear **both** ledger rows, not just 0011's:
`DELETE FROM drizzle.__drizzle_migrations WHERE created_at IN (1789862475550, 1789862630158);`
then `npm run db:migrate` re-applies 0011 (the four tables) followed by 0012 (the
three exclusion constraints). Verified on the local dev database 2026-09-20:
after the down the four tables are gone, and after the replay the database has
all 55 tables with `cost_pool_no_overlap`, `labor_rate_no_overlap` and
`allocation_rule_no_overlap` present (the count is 55 once `0020`'s four
slice-9 tables and `0021`'s four slice-10 tables exist; it was 47 before
`0020` and 51 before `0021`).
Re-applying is only safe
while the removed objects carry no data that must be preserved — once real
master data, TOTP counters or conversions exist, prefer the additive forward
path over re-running the down.

## Known follow-up obligations

Tracked here so they are not forgotten; each is owned by the slice that
implements it:

- ~~`stock_movement.source_id` needs a **per-`source_type` validation trigger**
  (the draft's "validated by trigger per slice"); the check constraint today
  only enumerates allowed `source_type` values.~~
  **Closed in `0017_stock_ledger_invariants.sql`:** `stock_movement_source_guard`
  validates `source_type = 'goods_receipt'` against `goods_receipt` (same
  organization) and is a documented no-op for every other `source_type` until
  its source table is modelled; those slices extend the same trigger.
  **Extended in `0020_slice9_counts_transfers_waste.sql`:** the same function
  body now also validates the `stock_count`, `transfer` and `waste_event`
  sources.
  **Extended in `0021_slice10_production.sql`:** it now also validates the
  `production_batch` source; `sales_line`, `adjustment`, `revaluation` and
  `correction` remain documented no-ops until their slices land.
- ~~`snapshot_component.component_kind` needs a **controlled vocabulary**
  (`vocabularies.ts` + check constraint) to be defined in the costing slice.~~
  **Closed in `0014_cost_card_pricing.sql`:** `SNAPSHOT_COMPONENT_KIND`
  (`vocabularies.ts`) is enforced by `snapshot_component_kind_check`. Its
  `schemas/domain-enums.yaml` entry is still owned by the domain slice
  (`vocabularies.test.ts` carries an explicit, self-clearing exemption until it
  lands).
- `stock_balance` is a **projection** whose only legitimate writer is the
  rebuild process. The database deliberately does not block writes to it
  (a rebuild must write it); the append-only ledger (`stock_movement`) is the
  enforcement point, not a trigger on `stock_balance`.
- **Slice-10 production open (owner/TECH) points — recorded, do not resolve
  silently** (also in the `packages/persistence/src/schema/production.ts`
  comment block; record each resolution in `12_OPEN_DECISIONS.md`, next free id
  `DEC-066`):
  - **(a)** No `batch_number`/`code` exists on `production_plan` or
    `production_batch`, so there is no natural key and no `findOrCreate`
    idempotency path (unlike `findOrCreateStockCountLine`).
  - **(b)** `DEC-036` partial-portion handling has no column: the standard
    portion size and the partial-portion representation are undefined, so the
    lines store base-unit quantities only.
  - **(c)** Output **cost allocation across multiple outputs** is undefined; no
    allocation column is invented.
  - **(d)** Planned-vs-actual variance posting vs **waste double-count**
    (`WASTE-002`): posting the actual movements and also a linked `waste_event`
    may double-count the loss; the posting policy is undecided.
  - **(e)** There is no WIP / **source-draw storage area**; `production_batch`
    has only a nullable `destination_storage_area_id`.
  - **(f)** `production_plan` has no line/quantity table and **no status
    vocabulary authority** (`production_status` describes the batch workflow),
    so `production_plan.status` is unconstrained.
  - **(g)** No **yield-variance tolerance or exception store**
    (`PROD-003`); `yield_variance_pct` is stored as a fact with no check and no
    exception rows.
  - **(h)** The **output-kind vocabulary has no Phase-0 yaml key**; the
    provisional local constant `PRODUCTION_OUTPUT_KIND` backs
    `production_batch_output_kind_check` until the yaml key is added.
- **Slice-9 open (owner/TECH) points — recorded, do not resolve silently**
  (also in the `packages/persistence/src/schema/transfers.ts` /
  `waste.ts` comment blocks; record each resolution in `12_OPEN_DECISIONS.md`,
  next free id `DEC-066`):
  - **(a)** No transfer **line** table exists in any authority; the model is the
    `stock_transfer` header plus paired `stock_movement` rows linked by
    `stock_movement.transfer_id`, so per-item dispatched-vs-received
    discrepancies live on the movements (and `discrepancy_note`), not on lines.
  - **(b)** A positive/open count variance needs a `unit_cost` to be valued and
    its source is undecided; no valuation column is stored on
    `stock_count_line`.
  - **(c)** `waste_event.value_method`/`value` may contradict the ledger's
    moving-average outbound `value_delta` for the linked waste movement; which
    wins (and whether the difference is booked) is undecided.
  - **(d)** The `stock_count.scope` jsonb shape and the recount thresholds are
    undefined; `scope` is stored as opaque jsonb.
  - **(e)** Per-source reversal semantics (`DEC-028`) are not implemented in
    `reverseStockMovement` for the slice-9 sources (count adjustment, transfer,
    waste); the downstream-sales reconciliation gate is deferred to the sales
    slice.
  - **(f)** There is no exception table for transfer discrepancies
    (`data_quality_exception` is deferred); `discrepancy_note` is the only
    recorded difference today.

## Extensions are idempotent

`0000_enable_extensions.sql` uses `CREATE EXTENSION IF NOT EXISTS pgcrypto` /
`btree_gist`, making re-bootstrap safe: the `IF NOT EXISTS` guard turns the
re-run into a no-op instead of an error. The extensions are schema-scoped —
installed in `public` — so the destructive recovery's `DROP SCHEMA public
CASCADE` drops them with the tables, and the next `db:migrate` recreates them
from 0000. Verified during bootstrap replay (see Recovery below).

## Apply a migration

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22
DATABASE_URL=postgres://aquarela:aquarela@localhost:5432/aquarela npm run db:migrate
```

Migrations are forward-only. drizzle-kit records applied migrations in the
`drizzle.__drizzle_migrations` ledger and skips any already recorded.

## Advisory lock and the direct/session connection

`npm run db:migrate` runs `packages/persistence/scripts/migrate.mjs`, which:

1. resolves `DATABASE_MIGRATIONS_URL ?? DATABASE_URL`, preferring the
   direct/session URL;
2. connects and takes a Postgres **session** advisory lock, key **`8675309`**;
3. runs `npx --no-install drizzle-kit migrate` as a child with that URL;
4. always releases the lock and propagates the child's exit code.

The lock serialises overlapping migrators: App Platform pre-deploy jobs can
overlap when a previous deploy is still finishing, and Spaces has no Terraform
state locking, so exactly one migration must run at a time. Missing both URLs
exits 1 with a message naming both variables and prints **no** URL.

The lock is **session-scoped**. A transaction-mode pooler (DO's pooled
`DATABASE_URL`) hands each statement a different backend, so the lock, the child
connection and the DDL would not share one session. `DATABASE_MIGRATIONS_URL`
therefore **MUST be a direct/session connection, never the transaction pool**.

`npm run db:migrate` is the **only sanctioned migration command**. A manual
operator who runs `drizzle-kit migrate` directly must take the same `8675309`
session advisory lock first (e.g. `SELECT pg_advisory_lock(8675309);` in the
same psql session), otherwise a manual run and an in-flight App Platform
pre-deploy job can interleave. Manual operators must use the same key,
**8675309** — do not invent a different one, or the wrapper and the manual
session will not serialise against each other.

## Current order (bootstrap)

| # | File | Contents |
| --- | --- | --- |
| 0000 | `0000_enable_extensions.sql` | `create extension pgcrypto` (uuid defaults) and `btree_gist` (exclusion constraints) |
| 0001 | `0001_phase1_core.sql` | Generated DDL for the 35 Phase 1–2 core tables, checks, uniques, FKs and indexes |
| 0002 | `0002_invariants.sql` | `app_user` case-insensitive partial unique indexes; `channel_fee_rule`, `supplier_price`, `recipe_version`, `product_recipe_assignment` exclusion constraints; `cost_card.snapshot_id` ↔ `calculation_snapshot.cost_card_id` deferrable FKs; append-only trigger functions/triggers for `stock_movement`, `calculation_snapshot` and `audit_event` |
| 0003 | `0003_user_totp_last_used_counter.sql` | Generated: adds nullable `user_totp.last_used_counter` (`integer`, check `null or >= 0`) for TOTP replay protection. Down companion: `0003_user_totp_last_used_counter_down.sql` (`ALTER TABLE "user_totp" DROP COLUMN "last_used_counter";`; the check drops with the column) |
| 0004 | `0004_master_data.sql` | Generated: the four slice-3 master-data tables — `cost_center`, `unit_conversion`, `supplier`, `supplier_item` — with their checks, uniques, FKs and the `unit_conversion_lookup_idx`. Down companion: `0004_master_data_down.sql` (transactional `DROP TABLE IF EXISTS` in FK-safe order) |
| 0005 | `0005_unit_conversion_invariants.sql` | Hand-written: two gist exclusion constraints on `unit_conversion` (`unit_conversion_global_no_overlap` for `item_id IS NULL`, `unit_conversion_item_no_overlap` for `item_id IS NOT NULL`) and the `NULLS NOT DISTINCT` `unit_conversion_version_key`. Down companion: `0005_unit_conversion_invariants_down.sql` (drops the three constraints) |
| 0006 | `0006_goods_receipt.sql` | Generated: the two slice-4 receiving tables — `goods_receipt` and `goods_receipt_line` — with their checks (status, supplier-or-store, accepted, quantities, factor, money, `base_qty_accepted > 0`), FKs, the self-reversal FK and the two indexes. No hand-written invariants migration is needed (drizzle-kit expresses every constraint). Down companion: `0006_goods_receipt_down.sql` (transactional `DROP TABLE IF EXISTS` in FK-safe order) |
| 0007 | `0007_goods_receipt_line_checks.sql` | Hand-written: `goods_receipt_line_accept_qty_guard`, a BEFORE INSERT/UPDATE trigger that rejects `accepted_pack_qty <= 0` when the parent receipt is `accepted` (a CHECK cannot read the parent status). Down companion: `0007_goods_receipt_line_checks_down.sql` (drops the trigger and function) |
| 0008 | `0008_supplier_price_effective_range.sql` | Generated: relaxes `supplier_price_effective_range_check` to `effective_to >= effective_from`, so the half-open `[)` history can represent a same-instant re-record as an empty window (non-overlapping under `supplier_price_no_overlap`). Down companion: `0008_supplier_price_effective_range_down.sql` (restores the strict `>`) |
| 0009 | `0009_recipe_allergens.sql` | Generated: the two slice-5 allergen tables — `allergen` and `recipe_allergen` — with their checks, unique key, composite primary key, FKs and the `recipe_allergen_allergen_idx`. The recipe tables (`recipe`, `recipe_version`, `recipe_line`) already exist from the 0001 core (with `recipe_version_no_overlap` in 0002), so 0009 adds only the allergen declarations. Down companion: `0009_recipe_allergens_down.sql` (transactional `DROP TABLE IF EXISTS` in FK-safe order) |
| 0010 | `0010_recipe_version_draft_overlap.sql` | Hand-written: drops the ungated `recipe_version_no_overlap` from `0002` and recreates it gated to `WHERE ("state" IN ('approved','submitted'))`, so two draft versions of one recipe may overlap while approved/submitted versions may not (`DEC-053`). Down companion: `0010_recipe_version_draft_overlap_down.sql` (restores the original ungated constraint; re-add validates existing rows) |
| 0011 | `0011_cost_allocation.sql` | Generated: the four slice-6 cost-allocation tables — `allocation_rule`, `cost_pool`, `labor_rate`, `operating_cost` — with their checks, FKs and the `allocation_rule_cost_pool_idx`, `cost_pool_organization_id_code_idx` and `operating_cost_lookup_idx` indexes. Down companion: `0011_cost_allocation_down.sql` (transactional `DROP TABLE IF EXISTS` in FK-safe order) |
| 0012 | `0012_cost_allocation_invariants.sql` | Hand-written: the three FND-004 effective-dated exclusions drizzle-kit cannot express — `cost_pool_no_overlap` on `(organization_id, code)`, `labor_rate_no_overlap` on `(organization_id, cost_center_id, role_code)` and `allocation_rule_no_overlap` on `(cost_pool_id)`, each a `[)` `daterange`. `operating_cost` deliberately has no overlap exclusion (concurrent overheads are legitimate). Down companion: `0012_cost_allocation_invariants_down.sql` (drops the three constraints) |
| 0013 | `0013_labor_rate_lookup_index.sql` | Generated: adds `labor_rate_lookup_idx` on `(organization_id, cost_center_id, role_code, effective_from)`, covering the `findEffectiveLaborRate` as-of lookup. Down companion: `0013_labor_rate_lookup_index_down.sql` (drops the index) |
| 0014 | `0014_cost_card_pricing.sql` | Generated: adds the four slice-7 `price_scenario` columns (`target_contribution_pct` numeric(9,6), `volume_assumption` numeric(19,6), `fee_breakdown` jsonb not null default `'{}'`, `outcome` jsonb not null default `'{}'`) and `snapshot_component_kind_check` on `snapshot_component.component_kind`. No table. Down companion: `0014_cost_card_pricing_down.sql` (drops the four columns and the constraint; destructive — the columns carry data) |
| 0015 | `0015_calculation_snapshot_cost_card_index.sql` | Generated: adds `calculation_snapshot_cost_card_idx` on `(cost_card_id, created_at)`, covering the cost-card snapshot history read. No table. Down companion: `0015_calculation_snapshot_cost_card_index_down.sql` (drops the index) |
| 0016 | `0016_cost_card_approved_scope.sql` | Hand-written: adds `cost_card_approved_scope_key`, a partial unique index (`NULLS NOT DISTINCT` on `(organization_id, product_variant_id, location_id, channel_id)` `WHERE state = 'approved'`) so at most one approved card exists per scope — the database backstop for `approveCostCard`'s supersede rule (`DEC-060`). No table. Down companion: `0016_cost_card_approved_scope_down.sql` (drops the index) |
| 0017 | `0017_stock_ledger_invariants.sql` | Generated + hand-written: the `stock_lot_source_movement_id_stock_movement_id_fk` FK (`stock_lot.source_movement_id` → `stock_movement.id`) plus the `stock_movement_source_guard` BEFORE INSERT trigger validating `source_type = 'goods_receipt'` against `goods_receipt` (same organization), a no-op for the source types whose tables are not modelled yet. No table. Down companion: `0017_stock_ledger_invariants_down.sql` (drops the trigger, its function and the FK) |
| 0018 | `0018_stock_movement_org_idempotency_key.sql` | Generated: replaces the global `stock_movement_idempotency_key_key` unique with the per-organization composite `stock_movement_org_idempotency_key_key` on `(organization_id, idempotency_key)`, so one organization's key does not block another's posting while a retry within an organization still collides. No table. Down companion: `0018_stock_movement_org_idempotency_key_down.sql` (restores the global unique; re-add validates existing rows) |
| 0019 | `0019_stock_movement_asof_index.sql` | Generated: adds `stock_movement_org_occurred_idx` on `(organization_id, occurred_at, posted_at, id)`, covering the bounded as-of aggregation (`sumStockMovementsAsOf`). No table. Down companion: `0019_stock_movement_asof_index_down.sql` (drops the index) |
| 0020 | `0020_slice9_counts_transfers_waste.sql` | Generated + hand-written: the four slice-9 tables — `stock_count`, `stock_count_line`, `stock_transfer`, `waste_event` — with their status/timestamp/quantity checks and indexes, plus `stock_movement.transfer_id` (column, FK and partial `stock_movement_transfer_idx`). Hand-written: `CREATE OR REPLACE FUNCTION stock_movement_source_guard` extending the `0017` guard to the `stock_count`/`transfer`/`waste_event` sources. Down companion: `0020_slice9_counts_transfers_waste_down.sql` (restores the `0017` guard, drops `transfer_id`, drops the four tables — destructive) |
| 0021 | `0021_slice10_production.sql` | Generated + hand-written: the four slice-10 tables — `production_plan`, `production_batch`, `production_batch_input`, `production_batch_output` — with their status/quantity/kind checks, FKs (including the batch→line cascade and the batch self-reversal FK) and indexes (the `production_batch_org_location_status_idx` plus the FK/line indexes). Hand-written: the deferred `waste_event.production_batch_id` FK (`NOT VALID` → `VALIDATE`) and `CREATE OR REPLACE FUNCTION stock_movement_source_guard` adding the `production_batch` branch. Down companion: `0021_slice10_production_down.sql` (restores the `0020` guard, drops the `waste_event` FK, drops the four tables — destructive) |

Order matters: extensions before DDL that calls `gen_random_uuid()`, and before
the exclusion constraints. Verify with:

```bash
grep -o '"tag": "[^"]*"' packages/persistence/drizzle/meta/_journal.json
```

## Recovery / rollback (tested)

> **Destructive.** This deletes **all** data in the target database. Only use it
> on a local, disposable database, or after confirming a backup. There is no
> data yet in the bootstrap phase, so this is the documented down path.

```sql
DROP SCHEMA public CASCADE;
DROP SCHEMA drizzle CASCADE;
CREATE SCHEMA public;
```

```bash
DATABASE_URL=postgres://aquarela:aquarela@localhost:5432/aquarela npm run db:migrate
```

**Why both schemas.** drizzle-kit keeps its migration ledger in the separate
`drizzle` schema (`drizzle.__drizzle_migrations`), not in `public`. Dropping
`public` alone leaves the ledger intact, so `db:migrate` reports success while
restoring nothing. `DROP SCHEMA drizzle CASCADE` clears the ledger so all
migrations replay from 0000. Verified: after this sequence `db:migrate`
re-applies 0000–0021 and the database has all 55 tables plus both extensions
(0004 adds the four slice-3 master-data tables; 0006 adds the two slice-4
receiving tables; 0007 adds the `goods_receipt_line` guard trigger — no table;
0008 relaxes the `supplier_price` range check — no table; 0009 adds the two
slice-5 allergen tables; 0010 replaces the `recipe_version` exclusion
constraint — no table; 0011 adds the four slice-6 cost-allocation tables; 0012
adds the three cost-allocation exclusion constraints — no table; 0013 adds the
`labor_rate` lookup index — no table; 0014 adds the four slice-7
`price_scenario` columns and the `snapshot_component` kind check — no table;
0015 adds the `calculation_snapshot_cost_card_idx` index — no table; 0016 adds
the `cost_card_approved_scope_key` approval index — no table; 0017 adds the
`stock_lot` source-movement FK and the `stock_movement_source_guard` trigger —
no table; 0018 replaces the global `stock_movement` idempotency unique with the
per-organization composite one — no table; 0019 adds the `stock_movement`
as-of aggregation index — no table; 0020 adds the four slice-9
count/transfer/waste tables, the `stock_movement.transfer_id` column/FK/index
and replaces the `stock_movement_source_guard` body — four tables; 0021 adds the
four slice-10 production tables, the deferred `waste_event.production_batch_id`
FK and replaces the `stock_movement_source_guard` body again — four tables).
0013–0019 were added after this replay was verified; all are additive and
table-count-neutral. `0020` and `0021` are the only migrations after the replay
was written to add tables (four each), so the 55-table figure above is the
expected post-`0021` count (51 after `0020`); `0014`–`0021`'s
apply/re-run/down/re-apply was rehearsed on the local dev database 2026-09-20.

Once real data exists, this path is no longer acceptable: use small atomic
commits, expand → migrate → contract for schema changes, and a tested
data-preserving rollback before touching production (ADR-0002, AGENTS.md
Rule 2).

## Invariant checks (bootstrap)

After applying to an empty database the following were verified with `psql`:

- `stock_movement`: `UPDATE`, `DELETE` and `TRUNCATE` are rejected by
  `reject_posted_movement_change` (row and statement triggers).
- `audit_event`: `UPDATE` rejected by `reject_immutable_change`.
- `supplier_price`: an overlapping `tstzrange(effective_from, effective_to)` for
  the same `supplier_item_id` is rejected by `supplier_price_no_overlap`.
- `unit_conversion` (0005): an overlapping effective window for the same
  `(organization_id, from_unit_id, to_unit_id)` with `item_id IS NULL` is
  rejected by `unit_conversion_global_no_overlap`; the same overlap with a
  non-null `item_id` is rejected by `unit_conversion_item_no_overlap`; an exact
  duplicate version tuple is rejected by `unit_conversion_version_key` (or by
  the matching exclusion constraint, which fires first for an identical window).
- `NULLS NOT DISTINCT`: duplicate `stock_balance` rows with a null `lot_id`, and
  duplicate `user_role` rows with a null `location_id`, are rejected.
- `goods_receipt` / `goods_receipt_line` (0006): an `accepted` receipt without
  `accepted_by`/`accepted_at`, or with neither `supplier_id` nor a non-blank
  `store_name`, is rejected; a line with `accepted_pack_qty > received_pack_qty`,
  a non-positive `pack_to_base_factor` or `base_qty_accepted <= 0` is rejected.
- `supplier_price` (0008): `effective_to >= effective_from` is permitted (an
  empty `[effective_from, effective_from)` window), while `effective_to <
  effective_from` is still rejected by `supplier_price_effective_range_check`.
- `goods_receipt_line` (0007): inserting a line with `accepted_pack_qty = 0`
  against an `accepted` receipt is rejected by
  `goods_receipt_line_accept_qty_guard`; the same line against a `rejected`
  receipt is allowed.
- `app_user`: case-insensitive duplicate `email` is rejected
  (`app_user_email_key` on `lower(btrim(email))`); whitespace variants
  (`'alice '` when `'alice'` exists) are also rejected.
- `user_totp`: a negative `last_used_counter` is rejected by
  `user_totp_last_used_counter_check` (null or `>= 0`).
- `allergen` (0009): a duplicate `(organization_id, code)` is rejected by
  `allergen_organization_id_code_key`.
- `recipe_allergen` (0009): a duplicate `(recipe_version_id, allergen_id)` is
  rejected by the composite primary key; a `source` outside
  `{derived, verified}` is rejected by `recipe_allergen_source_check`; a
  `verified` declaration without `verified_by` is rejected by
  `recipe_allergen_verified_check`.
- `recipe_version` (0010): two overlapping **draft** versions of one recipe are
  accepted, while two overlapping **approved** (or **submitted**) versions are
  rejected by the state-gated `recipe_version_no_overlap`. A draft may overlap an
  approved version; an approved overlapping another approved is the failure the
  constraint exists to catch.
- `cost_pool` (0012): an overlapping `daterange(effective_from, effective_to)`
  `[)` window for the same `(organization_id, code)` is rejected by
  `cost_pool_no_overlap` (a pool that closes at `2026-06-01` and one that opens
  the same day is not an overlap).
- `labor_rate` (0012): an overlapping window for the same
  `(organization_id, cost_center_id, role_code)` is rejected by
  `labor_rate_no_overlap`; a different `role_code` in the same cost centre may
  occupy the same window.
- `labor_rate` (0013): the `labor_rate_lookup_idx` index on
  `(organization_id, cost_center_id, role_code, effective_from)` covers the
  `findEffectiveLaborRate` as-of lookup.
- `allocation_rule` (0012): an overlapping window for the same `cost_pool_id` is
  rejected by `allocation_rule_no_overlap`. `operating_cost` deliberately has
  **no** overlap exclusion: two concurrent costs in one cost centre and period
  (rent and insurance) are accepted.
- `calculation_snapshot` (0015): the `calculation_snapshot_cost_card_idx` index on
  `(cost_card_id, created_at)` covers the cost-card snapshot history read.
- `cost_card` (0016): a second `approved` card in the same
  `(organization_id, product_variant_id, location_id, channel_id)` scope is
  rejected by `cost_card_approved_scope_key`; a `NULL` `channel_id` is **not**
  treated as distinct (`NULLS NOT DISTINCT`), so a second company-wide approved
  card is also rejected.
- `stock_lot` (0017): a `source_movement_id` that does not name an existing
  `stock_movement` row is rejected by
  `stock_lot_source_movement_id_stock_movement_id_fk`.
- `stock_movement` (0017): a `source_type = 'goods_receipt'` movement whose
  `source_id` is not a `goods_receipt` in the same `organization_id` is rejected
  by `stock_movement_source_guard`; a matching receipt is accepted, and every
  other `source_type` is a no-op.
- `stock_movement` (0018): two movements in the **same** organization with the
  same `idempotency_key` are rejected by
  `stock_movement_org_idempotency_key_key`; the same key in **different**
  organizations is accepted (two rows, each returned by the org-scoped
  `findStockMovementByIdempotencyKey`).
- `stock_movement` (0019): the `stock_movement_org_occurred_idx` index on
  `(organization_id, occurred_at, posted_at, id)` covers the bounded
  `sumStockMovementsAsOf` aggregation behind `getStockBalanceAsOf`.
- `stock_movement` (0020): a `source_type = 'stock_count'`, `'transfer'` or
  `'waste_event'` movement whose `source_id` is not the matching row in the
  same `organization_id` is rejected by `stock_movement_source_guard`; a
  matching row is accepted. A `transfer_id` that does not name a
  `stock_transfer` is rejected by
  `stock_movement_transfer_id_stock_transfer_id_fk`; the
  `stock_movement_transfer_idx` partial index covers the paired-leg read.
- `stock_count` / `stock_count_line` (0020): an `approved` count without
  `approved_by`/`approved_at` is rejected by `stock_count_approved_check`; a
  duplicate `(stock_count_id, item_id, storage_area_id, lot_id)` is rejected by
  the `NULLS NOT DISTINCT` `stock_count_line_key`, including two lot-less lines
  (null `lot_id`) for the same key.
- `stock_transfer` (0020): a `dispatched` transfer without `dispatched_at`, or a
  `received` transfer without both `dispatched_at` and `received_at`, is
  rejected by `stock_transfer_dispatched_check` /
  `stock_transfer_received_check`.
- `waste_event` (0020): a row with neither `item_id` nor `product_variant_id`
  is rejected by `waste_event_item_or_variant_check`, `quantity <= 0` by
  `waste_event_quantity_check`, and a negative `value` by
  `waste_event_value_check`.
- `stock_movement` (0021): a `source_type = 'production_batch'` movement whose
  `source_id` is not a `production_batch` in the same `organization_id` is
  rejected by `stock_movement_source_guard`; a matching batch is accepted.
- `production_batch` (0021): a `status` outside the `production_status`
  vocabulary is rejected by `production_batch_status_check`; an `actual_finish`
  before `actual_start` is rejected by `production_batch_actual_range_check`;
  deleting a batch cascades to its `production_batch_input` /
  `production_batch_output` rows (the batch→line FKs are `ON DELETE cascade`).
- `production_batch_output` (0021): a `kind` outside the provisional
  `PRODUCTION_OUTPUT_KIND` set is rejected by
  `production_batch_output_kind_check`.
- `waste_event` (0021): a non-null `production_batch_id` that does not name a
  `production_batch` is rejected by
  `waste_event_production_batch_id_production_batch_id_fk`.
- Deferrable FKs: a `calculation_snapshot` and its `cost_card` can be inserted
  in the same transaction in either order and commit together.
- `calculation_snapshot`: a plain `TRUNCATE` is blocked first by the FK from
  `cost_card`; only `TRUNCATE ... CASCADE` reaches the statement-level
  `calculation_snapshot_no_truncate` trigger, which rejects it. The table is
  blocked either way.
