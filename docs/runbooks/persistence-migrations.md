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
  exclusion constraints, expression indexes, deferrable FKs, triggers. A
  **partial** index is expressible — `uniqueIndex(...).on(...).where(sql\`…\`)`
  is generated (see `0026_sales_line_reversal_unique.sql`) — while an
  expression index is not. The columns raw constraints reference are modelled as
  plain `uuid` in the TypeScript schema so `generate` never fights them.
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
`0012_cost_allocation_invariants.sql`; the `DEC-072` tolerance exclusion
(`reconciliation_tolerance_no_overlap`) lives only in
`0024_reconciliation_tolerance.sql`; the `DEC-077` price-version exclusion
(`price_version_no_overlap`, whose null-scope sentinel normalizes a null
`location_id`/`channel_id` to a single "any" scope) lives only in
`0027_price_version.sql`; the slice-7
`cost_card_approved_scope_key` partial unique index (`NULLS NOT DISTINCT` on
`(organization_id, product_variant_id, location_id, channel_id)` `WHERE state =
'approved'`) lives only in `0016_cost_card_approved_scope.sql`; the slice-8
`stock_movement_source_guard` trigger/function (the per-`source_type`
validation of `stock_movement.source_id`) lives only in
`0017_stock_ledger_invariants.sql`, and its **body is replaced** by
`0020_slice9_counts_transfers_waste.sql` to also validate the slice-9
`stock_count`, `transfer` and `waste_event` sources, again by
`0021_slice10_production.sql` to add the `production_batch` source and again by
`0023_row12_sales_settlements_reconciliation.sql` to add the `sales_line`
source (the `goods_receipt`/`stock_count`/`transfer`/`waste_event`/
`production_batch` branches are kept; the remaining source types
(`adjustment`/`revaluation`/`correction`) stay documented no-ops); the
`goods_receipt_line_accept_qty_guard` trigger/function (an accepted receipt's
line must have `accepted_pack_qty > 0`; a plain CHECK cannot read the parent
status) lives only in `0007_goods_receipt_line_checks.sql`; and the
`recipe_version_no_overlap` exclusion constraint from `0002` is **replaced** by
a state-gated version in `0010_recipe_version_draft_overlap.sql` (approved /
submitted only, so drafts may overlap; `DEC-053`). This is the
**hand-written invariants convention**: anything drizzle-kit cannot express
(extensions, exclusion constraints, expression indexes, deferrable FKs,
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
> constraints, the `reconciliation_tolerance_no_overlap` exclusion, the
> `price_version_no_overlap` exclusion, the
> `cost_card_approved_scope_key` approval index and the
> `stock_movement_source_guard` validation trigger (extended in `0020`, `0021`
> and `0023`). Those
> objects live only in
> `0002_invariants.sql`, `0005_unit_conversion_invariants.sql`,
> `0007_goods_receipt_line_checks.sql`,
> `0010_recipe_version_draft_overlap.sql`,
> `0012_cost_allocation_invariants.sql`,
> `0016_cost_card_approved_scope.sql`,
> `0017_stock_ledger_invariants.sql`,
> `0020_slice9_counts_transfers_waste.sql`,
> `0021_slice10_production.sql`,
> `0023_row12_sales_settlements_reconciliation.sql`,
> `0024_reconciliation_tolerance.sql` and
> `0027_price_version.sql`; use `generate` + `migrate`
> and the guard below.

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
`cost_card.approved_by`, `price_version.approved_by`, `audit_event.actor_id`,
`goods_receipt.purchase_order_id`,
`goods_receipt.accepted_by`, `goods_receipt.evidence_file_id`,
~~`goods_receipt_line.supplier_item_id`~~, `operating_cost.evidence_file_id`,
`waste_event.production_batch_id`.

`stock_lot.source_movement_id` was closed by `0017_stock_ledger_invariants.sql`
as an ordinary validating FK (drizzle-kit generated it) because `stock_lot` is
empty at first apply. `goods_receipt_line.supplier_item_id` was closed by
`0029_org_coherence_guards.sql` using the `NOT VALID` → `VALIDATE` form above
(the table may already hold rows). `waste_event.production_batch_id` was closed
by `0021_slice10_production.sql` using the same form (the `waste_event` table may
already hold rows). `stock_movement.source_id`
is guarded by the `0017` `stock_movement_source_guard` trigger rather than an FK,
because its target table varies by `source_type`.

## Pre-apply preflight for validating constraints and indexes
Migrations 0014, 0016, 0017, 0018, 0019, 0020, 0021, 0022, 0023, 0024, 0025,
0026, 0027, 0028, 0029, 0030, 0031, 0032, 0033, 0035, 0037, 0040, 0041, 0042,
0043, 0044, 0045, 0046, 0047, 0048, 0049, 0051, 0053, 0057 and 0059 add objects that validate or build, so a failure
aborts the whole transactional migration (drizzle-kit runs each file in one
transaction). Run the matching preflight against the target database **before**
applying and reconcile any hits; drizzle-kit cannot detect them because these
  files diff against existing data.

- **`0057_period_close.sql`** — one new, empty table (`period_close`) with its six
  checks (`period_close_status_check`, `period_close_scope_type_check`,
  `period_close_period_range_check`, `period_close_granularity_check`,
  `period_close_locked_check`, `period_close_reopened_check`), the
  `period_close_org_scope_period_key` unique on
  `(organization_id, scope_type, scope_id, period_start)`, the organization FK
  and the `period_close_org_scope_idx` / `period_close_org_status_idx` org-first
  indexes. All are cheap at first apply because the table starts empty: the checks
  validate nothing existing, the unique builds an empty table and the organization
  FK validates an empty child table. The granularity check's
  `date_trunc('month', date)` is an immutable expression, so the CHECK is legal.
  The migration adds no hand-written statement and no backfill is needed.
  `0058_period_close_org_guard.sql` (below) adds triggers only, so it scans no
  existing row either. No separate preflight query is needed.

- **`0059_adjustment_period.sql`** — one new, empty table (`adjustment_period`)
  with its three checks (`adjustment_period_status_check`,
  `adjustment_period_range_check`, `adjustment_period_approved_check`), the
  organization FK, the partial unique `adjustment_period_open_key` on
  `(organization_id) WHERE status = 'open'` and the
  `adjustment_period_org_status_idx` / `adjustment_period_org_opened_idx`
  org-first indexes. All are cheap at first apply because the table starts empty:
  the checks validate nothing existing, the unique and the indexes build an empty
  table and the organization FK validates an empty child table. The migration adds
  no hand-written statement and no backfill is needed. It has no companion
  org-guard migration (the table carries no cross-organization reference and no
  location scope). No separate preflight query is needed.

- **`0051_shift_scheduling.sql`** — two new, empty tables (`shift`,
  `shift_assignment`) with their checks, the `shift_assignment_shift_employee_key`
  unique, FKs and the org-first indexes. All are cheap at first apply because
  both tables start empty: the `shift_state_check` / `shift_time_range_check` /
  `shift_break_minutes_check` / `shift_actual_range_check` /
  `shift_assignment_state_check` checks validate nothing existing, the unique
  builds an empty table and the organization/location/shift/employee FKs
  validate empty child tables. The migration adds no hand-written statement and
  no backfill is needed. `0052_shift_scheduling_org_guard.sql` (below) adds
  triggers only, so it scans no existing row either. No separate preflight query
  is needed.

- **`0053_shift_adjustment.sql`** — one new, empty table (`shift_adjustment`) with
  its two checks (`shift_adjustment_adjusted_hours_check`,
  `shift_adjustment_approved_check`), the organization FK, the `shift_assignment`
  FK and the `shift_adjustment_org_assignment_idx` org-first index. All are cheap
  at first apply because the table starts empty: the checks validate nothing
  existing, the FKs validate an empty child table and the index builds an empty
  table. The migration adds no hand-written statement and no backfill is needed.
  `0054_shift_adjustment_org_guard.sql` (below) adds triggers only, so it scans no
  existing row either. No separate preflight query is needed.

- **`0050_workflow_platform.sql`** — two new, empty tables (`task`, `approval`)
  with their checks, FKs and org-first indexes. All are cheap at first apply
  because both tables start empty: the `task_status_check` /
  `task_linked_entity_check` / `approval_decision_check` /
  `approval_decided_check` checks validate nothing existing and the organization
  FKs validate empty child tables. The migration adds no hand-written statement
  and no backfill is needed. It has no companion org-guard migration. No
  separate preflight query is needed.

- **`0048_staff_documents.sql`** — three new, empty tables (`document`,
  `document_version`, `document_acknowledgement`) with their checks, uniques,
  FKs and org-first indexes. All are cheap at first apply because the tables
  start empty: the `document_category_check` / `document_audience_check` /
  `document_status_check` / `document_version_version_no_check` /
  `document_version_published_check` checks validate nothing existing, the
  `document_version_document_version_key` and
  `document_acknowledgement_version_user_key` uniques build empty tables and the
  organization/document/file-object FKs validate empty child tables. The
  migration adds no hand-written statement and no backfill is needed.
  `0049_staff_documents_org_guard.sql` (below) adds triggers only, so it scans
  no existing row either. No separate preflight query is needed.

- **`0046_workforce.sql`** — two new, empty tables (`employee`,
  `employee_document`) with their checks, FKs and the org-first indexes. All are
  cheap at first apply because both tables start empty: the
  `employee_employment_type_check` / `employee_base_hourly_rate_check` /
  `employee_active_range_check` / `employee_document_kind_check` checks validate
  nothing existing, and the organization/`app_user`/location/employee/`file_object`
  FKs validate empty child tables. The migration adds no hand-written statement
  and no backfill is needed. No separate preflight query is needed.

- **`0037_hms_monitoring.sql`** — two new, empty tables (`monitoring_point`,
  `monitoring_reading`) with their checks, uniques, FKs and the
  `monitoring_reading_org_point_measured_idx` index. All are cheap at first
  apply because both tables start empty: the `monitoring_point_kind_check` /
  `monitoring_point_check_frequency_check` /
  `monitoring_point_target_range_check` checks validate nothing existing, the
  `monitoring_point_organization_id_code_key` unique builds an empty table and
  the organization/location/storage-area/point FKs validate empty child tables.
  The migration adds no hand-written statement, the tables are new and empty at
  first apply (no validating constraint on an existing row, no full-table lock),
and `0038_hms_monitoring_append_only.sql` (below) adds triggers only, so it
scans no existing row either. No separate preflight query is needed.

- **`0035_file_object.sql`** — one new, empty table (`file_object`) with its
  `file_object_size_bytes_check` check, the `file_object_org_storage_key_key`
  unique on `(organization_id, storage_key)` and the organization FK (all cheap
  at first apply: the table is empty), plus the hand-edited deferred
  `import_run.file_object_id` FK (`import_run_file_object_id_file_object_id_fk`):
  `ADD CONSTRAINT … NOT VALID` (metadata-only, still enforced for new writes)
  followed by `VALIDATE CONSTRAINT` in the same transactional file — the
  `0029`/`0031` pattern — because `import_run.file_object_id` may already hold
  values while `file_object` starts empty. The `VALIDATE` scans `import_run`, so
  preflight for non-null `file_object_id` values with no matching `file_object`
  row before applying and reconcile every hit (repair the value, or leave the FK
  added `NOT VALID`, per the pattern above):

  ```sql
  SELECT id, file_object_id
  FROM import_run
  WHERE file_object_id IS NOT NULL
    AND file_object_id NOT IN (SELECT id FROM file_object);
  ```

  `file_object` is new and empty at apply, so any non-null link is an orphan
  until its file row is inserted, and the table's own checks, unique and FK
  cannot fail on existing rows.

- **`0034_import_disposition_contract.sql`** — the `DEC-083` contract step is
  **data-only** and hand-written: it adds no table, index or validating
  constraint, so it cannot fail on an existing row, but it **drops the
  retained-frozen `diagnostics.dispositions` key from every `import_run` that
  still carries it** (`SET "diagnostics" = "diagnostics" - 'dispositions' WHERE
  "diagnostics" ? 'dispositions'`). Every jsonb record the `0033` backfill did
  not move into `import_disposition` — the ones it **skipped** (malformed
  `stagingRowId`/`actorId`, an out-of-vocabulary `disposition`, an orphaned
  staging row, or a malformed `at`) or **superseded** (an earlier duplicate per
  staging row) — is **permanently lost** when the key is dropped. Preflight the
  two counts below before applying and reconcile every hit (repair the record or
  accept the loss). Runs still carrying the key:

  ```sql
  SELECT count(*) AS runs_with_dispositions
  FROM import_run
  WHERE diagnostics ? 'dispositions';
  ```

  Records that will be permanently lost — every jsonb record with no matching
  `import_disposition` row, i.e. exactly the ones the `0033` backfill skipped or
  superseded:

  ```sql
  SELECT ir.id AS import_run_id,
         element ->> 'stagingRowId' AS staging_row_id,
         element AS lost_record
  FROM import_run ir
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ir.diagnostics -> 'dispositions', '[]'::jsonb)) AS element
  WHERE NOT EXISTS (
    SELECT 1
    FROM import_disposition d
    WHERE d.import_staging_row_id::text = element ->> 'stagingRowId'
  );
  ```

  After `0033` the table is the source of truth, so a record the table does not
  hold is a loss to repair (re-run `0033`'s backfill insert, or copy the record
  out) or to accept before `0034` drops it.

- **`0033_import_disposition.sql`** — one new, empty table (`import_disposition`)
  with its `import_disposition_disposition_check` check, the
  `import_disposition_staging_row_key` unique and the cascade FK to
  `import_staging_row` (all cheap at first apply: the table is empty), plus a
  hand-appended `INSERT … SELECT` backfill from
  `import_run.diagnostics.dispositions`. The backfill itself **skips** records
  with a malformed `stagingRowId`/`actorId`, an out-of-vocabulary `disposition`
  or a staging row that no longer exists, but it takes a validating unique key
  and FK inside the transactional migration, so preflight which records will be
  skipped before applying and reconcile every hit (repair the record, or accept
  the loss — the jsonb keys stay frozen either way). Note the backfill's
  `ORDER BY … (element ->> 'at')::timestamptz` casts every record that passes
  the uuid/vocabulary filters, so a record with a malformed `at` string would
  abort the whole migration; its `at` must be a valid timestamp. The skip query
  below flags those records too; it compares ids and `at` as
  text, so the preflight itself cannot abort on a malformed cast:

  ```sql
  SELECT ir.id AS import_run_id, element AS skipped_record
  FROM import_run ir
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ir.diagnostics -> 'dispositions', '[]'::jsonb)) AS element
  WHERE (element ->> 'stagingRowId') IS NULL
     OR (element ->> 'actorId') IS NULL
     OR (element ->> 'disposition') IS NULL
     OR (element ->> 'stagingRowId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR (element ->> 'actorId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR (element ->> 'disposition') NOT IN ('unmapped', 'rejected', 'ignored')
     OR NOT EXISTS (SELECT 1 FROM import_staging_row r WHERE r.id::text = element ->> 'stagingRowId')
     OR (element ->> 'at' ~* '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}')
        IS NOT TRUE;
  ```

  The backfill keeps the **latest record per staging row**
  (`DISTINCT ON (stagingRowId) … ORDER BY at DESC NULLS LAST`), so a jsonb that
  holds more than one record for a staging row is **not** an error — the earlier
  records are superseded. List those runs for awareness (the superseded records
  are simply not backfilled):

  ```sql
  SELECT ir.id AS import_run_id,
         element ->> 'stagingRowId' AS staging_row_id,
         count(*) AS record_count
  FROM import_run ir
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ir.diagnostics -> 'dispositions', '[]'::jsonb)) AS element
  WHERE (element ->> 'stagingRowId') IS NOT NULL
  GROUP BY ir.id, element ->> 'stagingRowId'
  HAVING count(*) > 1;
  ```

- **`0032_import_run_profile_org_guard.sql`** — one `BEFORE INSERT OR UPDATE FOR
  EACH ROW` guard trigger plus its function (`import_run_profile_org_guard` on
  `import_run`). Both create immediately and never scan an existing row (the
  guard is **forward-only** and does not re-validate pre-existing rows), and the
  migration adds no table, index or validating constraint. Nothing is validated
  at apply time, so no separate preflight query is needed.

- **`0031_import_profile.sql`** — one new, empty table (`import_profile`) with
  its two checks (`import_profile_posting_policy_check`,
  `import_profile_validation_rules_check`), the `import_profile_org_source_key`
  unique, the organization FK and the nullable `import_run.import_profile_id`
  FK, whose validation scans the empty `import_run` table. All are cheap at
  first apply because both tables are empty or the new column is null on every
  row; the checks validate nothing existing and the unique builds an empty
  table. It adds no hand-written statement and no backfill is needed. No
  separate preflight query is needed.

- **`0030_data_quality_exception.sql`** — one new, empty table
  (`data_quality_exception`) with its two checks
  (`data_quality_exception_severity_check`, `data_quality_exception_status_check`),
  the organization FK and the `data_quality_exception_org_status_idx` /
  `data_quality_exception_org_entity_idx` indexes. All are cheap at first apply
  because the table is empty; the checks validate nothing existing and the
  non-concurrent indexes build an empty table. It adds no hand-written statement
  and touches no existing table. No separate preflight query is needed.

- **`0029_org_coherence_guards.sql`** — the `VALIDATE CONSTRAINT` step scans
  `goods_receipt_line` for `supplier_item_id` values with no matching
  `supplier_item`; the three `BEFORE INSERT OR UPDATE` guard triggers create
  immediately and never scan an existing row (they are **forward-only** and do
  not re-validate pre-existing rows). Preflight the orphan count before applying
  and reconcile every hit (or leave the FK added `NOT VALID`):

  ```sql
  SELECT l.id, l.supplier_item_id
  FROM goods_receipt_line l
  LEFT JOIN supplier_item si ON si.id = l.supplier_item_id
  WHERE l.supplier_item_id IS NOT NULL AND si.id IS NULL;
  ```

  The dev database holds 0 orphan `supplier_item_id` rows, so the `VALIDATE`
  proceeds. The guards themselves cannot fail the apply on existing data.

- **`0028_settlement_reconciliation_vocabularies.sql`** — the two `ALTER TABLE …
  ADD CONSTRAINT CHECK` statements tighten `settlement.status` and
  `reconciliation.scope_type` to the `DEC-078` vocabularies, so (like `0025`)
  they take an **`AccessExclusiveLock`** on the two tables and scan every row to
  validate it, failing if any existing row is out of vocabulary. At first apply
  both tables are empty or in-vocabulary, so it is cheap; on a populated table,
  preflight before applying and reconcile every hit:

  ```sql
  SELECT DISTINCT status FROM settlement
  WHERE status NOT IN ('received', 'paid', 'void');
  SELECT DISTINCT scope_type FROM reconciliation
  WHERE scope_type NOT IN ('import_run', 'sales_source', 'settlement', 'supplier_invoice');
  ```

  Any hit must be repaired (map the value into the vocabulary, or apply the
  checks `NOT VALID` and `VALIDATE` later) before the first apply, because a
  validating `ADD CONSTRAINT` inside the transactional migration aborts the whole
  file. The `ALTER TABLE "settlement" ALTER COLUMN "status" SET DEFAULT
  'received'` is metadata-only and scans nothing.

- **`0027_price_version.sql`** — one new, empty table (`price_version`) with its
  checks, FKs and `price_version_scope_idx` (cheap at first apply: the table is
  empty), plus the hand-written `price_version_no_overlap` EXCLUDE constraint
  (also cheap on an empty table). Because the exclusion key is the whole
  `(organization_id, product_variant_id, location_id-or-sentinel,
  channel_id-or-sentinel)` scope over a `tstzrange(effective_from,
  effective_to, '[)')` window, the table must be empty or overlap-free at
  apply; at first apply it is empty. No separate preflight query is needed. On a
  later populated table the constraint build takes a write lock and fails if two
  versions in one scope already overlap, so preflight before applying:

  ```sql
  SELECT organization_id, product_variant_id,
         COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid) AS location_key,
         COALESCE(channel_id,  '00000000-0000-0000-0000-000000000000'::uuid) AS channel_key,
         tstzrange(effective_from, effective_to, '[)') AS window
  FROM price_version
  WHERE effective_from IS NOT NULL
  ORDER BY organization_id, product_variant_id, location_key, channel_key, effective_from;
  ```

  Any pair of adjacent rows for one scope whose windows overlap
  (`&&`) must be reconciled first (close the older window, or change its
  `effective_to`), because an overlapping approval is rejected, never silently
  superseded (`DEC-077`). The sentinel in the query mirrors the constraint, so a
  null `location_id`/`channel_id` is compared as the single "any" scope.

- **`0026_sales_line_reversal_unique.sql`** — the non-concurrent
  `CREATE UNIQUE INDEX sales_line_reversal_of_id_key ON sales_line
  ("reversal_of_id") WHERE "reversal_of_id" is not null` is journaled, so it
  cannot use `CONCURRENTLY` and takes a write lock, and it fails if two lines
  already share a non-null `reversal_of_id`. At first apply `sales_line` is empty
  or reversal-free, so it is cheap; on a populated table, preflight before
  applying:

  ```sql
  SELECT reversal_of_id, count(*)
  FROM sales_line
  WHERE reversal_of_id IS NOT NULL
  GROUP BY 1
  HAVING count(*) > 1;
  ```

  Any hit must be reconciled first: at most one reversal per line is legal
  (`DEC-073`), so keep the intended reversal and resolve the duplicate before the
  index is built. It adds no table and no row; the index is the database-level
  backstop for `reverseSalesLine`, so two concurrent reversals cannot both post.

- **`0025_mapping_state_conflict.sql`** — the two `DROP CONSTRAINT` /
  `ADD CONSTRAINT` pairs recreate `import_staging_row_mapping_state_check` and
  `sales_line_mapping_state_check` with the fifth value `conflict`. The re-added
  checks are a **superset** of the four-value ones, so they never reject an
  existing row and need no preflight; the `ALTER TABLE … ADD CONSTRAINT CHECK`
  recreate takes an **`AccessExclusiveLock`** on the two tables and scans every
  row to validate it, so schedule it on a large
  `sales_line`/`import_staging_row` table.

- **`0024_reconciliation_tolerance.sql`** — one new, empty table
  (`reconciliation_tolerance`) with its checks, FK and
  `reconciliation_tolerance_org_kind_idx` (cheap at first apply: the table is
  empty), plus the hand-written `reconciliation_tolerance_no_overlap` EXCLUDE
  constraint (also cheap on an empty table). Because the version key is the whole
  constraint, the table must be empty or duplicate-free at apply; at first apply
  it is empty. No separate preflight query is needed.

- **`0023_row12_sales_settlements_reconciliation.sql`** — four new, empty tables
  (`sales_transaction`, `sales_line`, `settlement`, `reconciliation`) with their
  checks, uniques, FKs and indexes (cheap at first apply: the tables are empty).
  The `sales_transaction.import_run_id` FK validates against the existing
  `import_run` table but is a plain validating FK because `sales_transaction` is
  empty at apply. The `CREATE OR REPLACE FUNCTION "stock_movement_source_guard"`
  that adds the `sales_line` branch is metadata-only and scans nothing. No
  backfill; no separate preflight query is needed.

- **`0022_row11_import_framework.sql`** — three new, empty tables
  (`import_run`, `import_staging_row`, `external_mapping`) with their checks,
  uniques, FKs and indexes. All are cheap at first apply because the tables are
  empty (the uniques and FKs are non-concurrent, so on an already-populated
  table they would take a write/`ShareLock` for the scan). No hand-written
  statement, no trigger, no preflight: row 11 posts nothing and leaves
  `stock_movement_source_guard` untouched. No duplicate preflight is needed.

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
- **0022 adds the slice-11 import-framework tables and follows the down
  convention:** `0022_row11_import_framework.sql` is generated DDL for the three
  tables (`import_run`, `import_staging_row`, `external_mapping`, with their
  status/mapping-state/period/effective-range checks, uniques, FKs — including
  the staging→run `ON DELETE cascade` — and indexes). It adds no hand-written
  statement and does not touch `stock_movement_source_guard`, because row 11
  posts no stock movement (the `sales_line` guard branch belongs to row 12,
  owner-gated on `ADR-0008`).
  `0022_row11_import_framework_down.sql` is **destructive**: it drops the three
  tables in FK-safe order (`import_staging_row`, `import_run`, `external_mapping`),
  so it is only safe while those tables carry nothing that must be preserved.
  Apply it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0022_row11_import_framework_down.sql`.
- **0023 adds the slice-12 sales/settlement/reconciliation tables and follows the
  down convention:** `0023_row12_sales_settlements_reconciliation.sql` is
  generated DDL for the four tables (`sales_transaction`, `sales_line`,
  `settlement`, `reconciliation`, with their status/option-kind/period/tax-rate
  checks, uniques — including the replay-safe
  `(source_system, external_transaction_id)` and
  `(sales_transaction_id, external_line_id)` keys — the FKs, the two
  `sales_line` self-FKs, and the `org`/`sku`/period indexes), plus one
  hand-written statement: `CREATE OR REPLACE FUNCTION
  "stock_movement_source_guard"` adding the `sales_line` branch (keeping the
  existing branches). The four tables are the schema deliverable for
  `REC-001/002/005`; close/lock/period tables are row 13.
  `0023_row12_sales_settlements_reconciliation_down.sql` is **destructive**: it
  restores the `0021` guard body (drops the `sales_line` branch) and drops the
  four tables in FK-safe order (`sales_line`, `sales_transaction`, `settlement`,
  `reconciliation`), so it is only safe while those tables carry nothing that
  must be preserved. Apply it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0023_row12_sales_settlements_reconciliation_down.sql`.
- **0024 adds the DEC-072 effective-dated tolerance table and follows the down
  convention:** `0024_reconciliation_tolerance.sql` is generated DDL for
  `reconciliation_tolerance` (`organization_id`, `kind`, `rate numeric(9,6)`,
  `floor_amount numeric(19,4)`, an effective window and the audit columns, with
  the `reconciliation_tolerance_kind_check` / `_rate_check` / `_floor_check` /
  `_effective_range_check` constraints) plus one hand-written statement: the
  `reconciliation_tolerance_no_overlap` EXCLUDE constraint
  (`(organization_id, kind)` and `daterange(effective_from, effective_to, '[)')`
  `WITH &&`) that guarantees at most one tolerance per `(organization, kind)` at
  any instant — the FND-004 rule drizzle-kit cannot express, mirroring the
  `0012` cost-allocation exclusions. `DEC-072` keeps `reconciliation.tolerance`
  as the per-row snapshot; this table is the FIN-owned config the application
  resolves. It adds one table.
  `0024_reconciliation_tolerance_down.sql` first drops the hand-written
  `reconciliation_tolerance_no_overlap` constraint and then the
  `reconciliation_tolerance` table inside one `BEGIN;`/`COMMIT;` (with
  `DROP ... IF EXISTS`/`DROP TABLE IF EXISTS` so a half-applied manual run cannot
  wedge). It is **destructive** — tolerance config rows are lost — so run it only
  while that configuration need not be preserved (AGENTS.md Rule 2). Apply it
  manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0024_reconciliation_tolerance_down.sql`.
- **0025 adds the `conflict` mapping state and follows the down convention:**
  `0025_mapping_state_conflict.sql` is generated DDL that drops and recreates
  `import_staging_row_mapping_state_check` and
  `sales_line_mapping_state_check` with the five-value `MAPPING_STATE`
  (`unmapped`/`mapped`/`ignored`/`error`/`conflict`), so a `DEC-033` mapping
  conflict is a first-class state instead of `error` + `error_code =
  mapping_conflict` (`DEC-074`). It adds no table, no row and no hand-written
  statement (drizzle-kit emits the check recreate because the vocabulary array
  backs the constraint text). The table modules already use
  `enumCheck(t.mappingState, MAPPING_STATE)`, so no table file changed.
  `0025_mapping_state_conflict_down.sql` restores the four-value checks inside
  one `BEGIN;`/`COMMIT;`. No table is touched, but re-adding the narrower checks
  **validates existing rows**, so the down fails (and rolls back, leaving 0025 in
  place) if any row already holds `mapping_state = 'conflict'` — resolve those
  rows first. Run this preflight before applying the down path and reconcile
  (re-map, or set back to `error` with the conflict in `error_code`) every hit:

  ```sql
  SELECT 'import_staging_row' AS table, count(*) FROM import_staging_row WHERE mapping_state = 'conflict'
  UNION ALL
  SELECT 'sales_line', count(*) FROM sales_line WHERE mapping_state = 'conflict';
  ```

  Apply it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0025_mapping_state_conflict_down.sql`.
- **0026 adds the sales-line reversal unique index and follows the down
  convention:** `0026_sales_line_reversal_unique.sql` is generated DDL for
  `sales_line_reversal_of_id_key`, a partial unique index on
  `sales_line.reversal_of_id` `WHERE "reversal_of_id" is not null`, so at most
  one line reverses a given line (`DEC-073`) — the database-level, race-safe
  backstop for `reverseSalesLine`'s application pre-check. It adds no table and
  no row.
  `0026_sales_line_reversal_unique_down.sql` drops the index (no table, no row),
  so it is safe to run whenever the invariant must be removed (for example
  before a data repair); while dropped, only the application pre-check prevents a
  double reversal. Apply it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0026_sales_line_reversal_unique_down.sql`.
- **0027 adds the price-version table and follows the down convention:**
  `0027_price_version.sql` is generated DDL for `price_version`
  (`organization_id`, `product_variant_id`, the nullable `location_id`/
  `channel_id` scope columns, `gross_price`/`net_price` numeric(19,4), the
  `effective_from`/`effective_to` window, `approved_by`/`approved_at`, the
  required `source_scenario_id` FK and `created_at`, with the
  `price_version_price_check` / `price_version_effective_range_check`
  constraints, the org/variant/location/channel/scenario FKs and the
  `price_version_scope_idx` index) plus one hand-written statement: the
  `price_version_no_overlap` EXCLUDE constraint (`DEC-077`) that makes an
  approved price effective for exactly one
  `(organization_id, product_variant_id, location_id, channel_id)` scope over a
  half-open `tstzrange(effective_from, effective_to, '[)')` window, with
  `COALESCE(<col>, '00000000-0000-0000-0000-000000000000'::uuid)` normalizing a
  null `location_id`/`channel_id` so every null means ONE "any location"/"any
  channel" scope instead of an unlimited number of them. It adds one table.
  `0027_price_version_down.sql` first drops the hand-written
  `price_version_no_overlap` constraint and then the `price_version` table inside
  one `BEGIN;`/`COMMIT;` (with `DROP ... IF EXISTS`/`DROP TABLE IF EXISTS` so a
  half-applied manual run cannot wedge); the index and the FKs/checks drop with
  the table. It is **destructive** — approved price history is lost — so run it
  only while that price history need not be preserved (AGENTS.md Rule 2). Apply
  it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0027_price_version_down.sql`.
- **0028 adds the settlement/reconciliation vocabularies and follows the down
  convention:** `0028_settlement_reconciliation_vocabularies.sql` is generated
  DDL that sets the `settlement.status` default to `received`, adds
  `settlement_status_check` (`DEC-078` (a), `SETTLEMENT_STATUS`) and adds
  `reconciliation_scope_type_check` on `reconciliation.scope_type` (`DEC-078`
  (b), `RECONCILIATION_SCOPE_TYPE`, deliberately distinct from the
  cost/ownership `scope_type`). No table, no row and no hand-written statement;
  both checks **validate existing rows** at apply (see the preflight above).
  `0028_settlement_reconciliation_vocabularies_down.sql` drops the two checks and
  the `settlement.status` default inside one `BEGIN;`/`COMMIT;` (with
  `DROP ... IF EXISTS` so a half-applied manual run cannot wedge). Dropping a
  check never validates rows, so the down cannot fail on data; while dropped,
  `settlement.status` and `reconciliation.scope_type` are validated only by the
  application. Apply it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0028_settlement_reconciliation_vocabularies_down.sql`.
- **0029 adds the cross-organization coherence guards and follows the down
  convention:** `0029_org_coherence_guards.sql` is hand-written (`DEC-079`,
  closing `DEC-054`'s open point). It adds `goods_receipt_line.supplier_item_id`'s
  deferred existence FK (`NOT VALID` → `VALIDATE CONSTRAINT`, the pattern above)
  and three `BEFORE INSERT OR UPDATE FOR EACH ROW` guard triggers
  (`recipe_allergen_org_guard`, `recipe_line_org_guard`,
  `goods_receipt_line_org_guard`, mirroring the `0017`
  `stock_movement_source_guard` style, raising `ERRCODE = '23514'`):
  - `recipe_allergen_org_guard` resolves the recipe organization via
    `recipe_version.recipe_id → recipe.organization_id` and rejects an
    `allergen_id` in another organization.
  - `recipe_line_org_guard` resolves the recipe organization once and rejects an
    `item_id` (when set) or a `sub_recipe_id` (when set) in another organization.
  - `goods_receipt_line_org_guard` resolves the receipt's `organization_id` and
    `supplier_id`; it rejects an `item_id` in another organization, and a
    non-null `supplier_item_id` that is in another organization, belongs to
    another supplier, or packs a different item. A store-only receipt (null
    `supplier_id`) can never carry a supplier item.

  The guards resolve the parent row's organization through the existing FK
  paths; existence of the referenced row stays the FK's job (a missing parent
  falls through to the FK error). `DEC-079` chose triggers over denormalized
  composite FKs plus a backfill; the application guards remain the friendly-error
  layer. The triggers are **forward-only** — they validate new writes, they do
  not re-validate rows already present. It adds no table.
  `0029_org_coherence_guards_down.sql` drops the three triggers, their functions
  and the FK inside one `BEGIN;`/`COMMIT;` (with `DROP ... IF EXISTS` so a
  half-applied manual run cannot wedge). No table and no row is touched, so the
  down cannot fail on data; while dropped, those references are validated only by
  the application. Apply it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0029_org_coherence_guards_down.sql`.

- **0030 adds the `DEC-080` (`DQ-001`) data-quality exception table and follows
  the down convention:** `0030_data_quality_exception.sql` is generated DDL for
  `data_quality_exception` (`organization_id`, the provisional-text `rule_code`,
  `severity` with the `exception_severity` check and default `medium`, the
  polymorphic `entity_type`/`entity_id` (the latter a plain uuid, no FK),
  `detected_at` defaulting to `now()`, the nullable `owner_id` (a plain uuid) and
  `due_date` (`date`), `status` with the `exception_status` check and default
  `open`, `resolution`, and the audit columns, plus the organization FK and the
  `data_quality_exception_org_status_idx` / `data_quality_exception_org_entity_idx`
  indexes). Its first producer is `receiveStockTransfer`'s
  `transfer_discrepancy` exception. It adds one table and no hand-written
  statement.
  `0030_data_quality_exception_down.sql` drops the table inside one
  `BEGIN;`/`COMMIT;` (with `DROP TABLE IF EXISTS` so a half-applied manual run
  cannot wedge); its checks, FK and indexes drop with the table. It is
  **destructive** — every recorded exception (including the transfer
  discrepancies) is lost — so run it only while those exceptions need not be
  preserved (AGENTS.md Rule 2). Apply it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0030_data_quality_exception_down.sql`.
- **0031 adds the `DEC-081` import-profile table and follows the down
  convention:** `0031_import_profile.sql` is generated DDL for `import_profile`
  (`organization_id`, `source`, `profile_version`, `posting_policy` with the
  `import_profile_posting_policy_check` check and default `allow_partial`,
  `validation_rules` jsonb with the `import_profile_validation_rules_check`
  check (a jsonb object) and default `'{}'`, and the audit columns, with the
  `import_profile_org_source_key` unique on `(organization_id, source)` and the
  organization FK) plus the nullable `import_run.import_profile_id` column and
  its `import_run_import_profile_id_import_profile_id_fk` FK →
  `import_profile(id)`. It adds one table and no hand-written statement.
  `0031_import_profile_down.sql` drops the `import_run.import_profile_id`
  column (with its FK) **first** — it references the table — and then the
  `import_profile` table inside one `BEGIN;`/`COMMIT;` (with `DROP ... IF
  EXISTS` so a half-applied manual run cannot wedge). It is **destructive** —
  the stored profiles (and each run's profile link) are lost — so run it only
  while that configuration need not be preserved (AGENTS.md Rule 2). Apply it
  manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0031_import_profile_down.sql`.
- **0032 adds the `DEC-081` import-run profile coherence guard and follows the
  down convention:** `0032_import_run_profile_org_guard.sql` is hand-written
  (`DEC-079`'s `BEFORE INSERT OR UPDATE` guard shape applied to `DEC-081`'s
  profile FK). One function (`import_run_profile_org_guard()`) and one trigger
  (`import_run_profile_org_guard` on `import_run`) reject a non-null
  `import_run.import_profile_id` whose `import_profile` belongs to another
  organization than the run. It resolves the profile organization through the
  existing FK path (a null `import_profile_id` returns immediately; a missing
  profile falls through to the FK error) and raises `ERRCODE = '23514'`. It adds
  no table.
  `0032_import_run_profile_org_guard_down.sql` drops the trigger and its function
  inside one `BEGIN;`/`COMMIT;` (with `DROP ... IF EXISTS` so a half-applied
  manual run cannot wedge). No table and no row is touched, so the down cannot
  fail on data; while dropped, the reference's organization coherence is
  validated only by the application. Apply it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0032_import_run_profile_org_guard_down.sql`.
- **0033 adds the `DEC-083` import-disposition table and follows the down
  convention:** `0033_import_disposition.sql` is generated DDL for
  `import_disposition` (`import_staging_row_id` with the cascade FK to
  `import_staging_row(id)`, `disposition` with the
  `import_disposition_disposition_check` check (`unmapped`/`rejected`/
  `ignored`), the nullable `reason`, the required `actor_id` (a plain uuid; the
  `app_user` FK is deferred), `created_at` (the approval instant) and the
  `created_by`/`updated_at`/`updated_by`/`version` audit columns, with the
  `import_disposition_staging_row_key` unique on `(import_staging_row_id)` —
  one disposition per staging row) plus one hand-appended statement: the
  `DEC-083` backfill `INSERT … SELECT` that moves the pre-existing approved
  dispositions out of `import_run.diagnostics.dispositions` jsonb, keeping the
  latest record per staging row (`DISTINCT ON (stagingRowId) … ORDER BY at
  DESC NULLS LAST`) and skipping records with a malformed
  `stagingRowId`/`actorId`, an out-of-vocabulary `disposition` or a staging row
  that no longer exists (see the preflight above). The table has **no
  `organization_id`** — it is scoped through `import_staging_row` →
  `import_run`, the same precedence the `import_staging_row` table follows. It
  adds one table, and the jsonb keys are retained frozen (expand → migrate →
  contract).
  `0033_import_disposition_down.sql` is **not destructive in the usual sense**:
  the application writes only the table after the migration, so the down path
  first rebuilds each run's `diagnostics.dispositions` from the table (same
  keys, `source_row_no` order, `at` from `created_at` as an ISO instant) and
  then drops the table, inside one `BEGIN;`/`COMMIT;` (with `DROP TABLE IF
  EXISTS` so a half-applied manual run cannot wedge). The rebuild makes the
  rollback lossless; its one caveat is that it reflects the table's **current**
  contents — dispositions written to the table after `0033` was applied are
  restored into the jsonb, and any jsonb state is superseded. It also restores
  **one record per staging row** (the
  `import_disposition_staging_row_key` unique guarantees at most one), so if
  the pre-migration jsonb held more than one record for a staging row, only
  the surviving (latest) one comes back — the superseded earlier records are
  not recoverable from the table. If any earlier records matter, copy them out
  before running the down (the superseded-records preflight above lists the
  affected runs). Re-applying
  `0033` re-creates the table and re-backfills from the retained jsonb. Apply
  it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0033_import_disposition_down.sql`.
- **0034 performs the `DEC-083` contract step and follows the down convention:**
  `0034_import_disposition_contract.sql` is hand-written and **data-only** — it
  adds no table, index or constraint and runs one `UPDATE` that removes the
  retained-frozen `dispositions` key from every `import_run` whose `diagnostics`
  still carries it (`jsonb - 'dispositions'`, guarded by
  `WHERE "diagnostics" ? 'dispositions'`), leaving the other `diagnostics` keys
  (`posting_policy`/`issues`/`conflicts`/`totals`) untouched. After this step
  `import_disposition` is the only source of truth; the jsonb records the `0033`
  backfill skipped or superseded are dropped and unrecoverable from the table.
  `0034_import_disposition_contract_down.sql` rebuilds each run's
  `diagnostics.dispositions` from the table (`jsonb_agg … ORDER BY
  import_staging_row.source_row_no`) and **drops nothing** — the exact inverse of
  the forward for every value the table holds, inside one `BEGIN;`/`COMMIT;`. It
  is **value-identical but not order-identical**: `0033`'s backfill ordered the
  retained jsonb by each record's `at`, whereas the down orders by
  `source_row_no`. It restores **nothing** for a run with no `import_disposition`
  rows (no `dispositions` key is added), so the jsonb records the `0033` backfill
  skipped or superseded are not recovered. It is **not journalled** in
  `meta/_journal.json` (like every `*_down.sql`), so it is applied manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0034_import_disposition_contract_down.sql`;
  re-applying `0034` (after deleting its ledger row, below) drops the key again.
- **0035 adds the `ADR-0006`/`DEC-085` file-object table and follows the down
  convention:** `0035_file_object.sql` is generated DDL plus one hand-edited
  statement. The generated part creates `file_object` (`organization_id`,
  `storage_key`, `filename`, `mime`, `size_bytes bigint` with the
  `file_object_size_bytes_check` check (`>= 0`), `checksum_sha256`, the
  provisional free-text `retention_policy`, the nullable `uploaded_by`, the
  `uploaded_at` default `now()`, the polymorphic `linked_entity_type`/
  `linked_entity_id` (a plain uuid, no FK) and the audit columns, with the
  `file_object_org_storage_key_key` unique on `(organization_id, storage_key)`
  and the organization FK) and adds the `import_run.file_object_id` FK. The
  hand-edited part defers that FK — `ADD CONSTRAINT
  "import_run_file_object_id_file_object_id_fk" … NOT VALID` followed by
  `ALTER TABLE "import_run" VALIDATE CONSTRAINT …` in the same transactional file
  — because `import_run.file_object_id` may already hold values while
  `file_object` starts empty (the `0029`/`0031` pattern). It adds one table.
  `0035_file_object_down.sql` drops the `import_run.file_object_id` FK **first**
  — it references the table — and then the `file_object` table inside one
  `BEGIN;`/`COMMIT;` (with `DROP ... IF EXISTS`/`DROP TABLE IF EXISTS` so a
  half-applied manual run cannot wedge); the table's checks, unique, FK and
  indexes drop with it, and the `import_run.file_object_id` column itself stays a
  plain uuid, as it was before `0035`. It is **destructive** — every stored
  file's metadata (storage key, checksum, links) is lost and existing runs lose
  their file link — so run it only while those files need not be preserved
  (AGENTS.md Rule 2). Apply it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0035_file_object_down.sql`.
  Apply `0036`'s down **before** `0035`'s down: its guard trigger lives on
  `import_run` and reads `file_object`, which `0035`'s down drops.
- **0036 adds the `DEC-085` file-object organization guard and follows the down
  convention:** `0036_file_object_org_guard.sql` is hand-written (`DEC-079`'s
  `BEFORE INSERT OR UPDATE` guard shape applied to the `DEC-085`
  `import_run.file_object_id` FK, mirroring `0032`). One function
  (`file_object_org_guard()`) and one trigger (`file_object_org_guard` on
  `import_run`) reject a non-null `import_run.file_object_id` whose
  `file_object` belongs to another organization than the run. It resolves the
  file organization through the existing FK path (a null `file_object_id`
  returns immediately; a missing file falls through to the FK error) and raises
  `ERRCODE = '23514'`. It adds no table.
  `0036_file_object_org_guard_down.sql` drops the trigger and its function inside
  one `BEGIN;`/`COMMIT;` (with `DROP ... IF EXISTS` so a half-applied manual run
  cannot wedge). No table and no row is touched, so the down cannot fail on data;
  while dropped, the reference's organization coherence is validated only by the
  application. Apply it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0036_file_object_org_guard_down.sql`.
- **0037 adds the `DEC-089`/`HMS-002` HMS monitoring tables and follows the down
  convention:** `0037_hms_monitoring.sql` is generated DDL for the two tables.
  `monitoring_point` holds `organization_id`, `location_id`, the nullable
  `storage_area_id`, `code`, `name`, `kind` with the
  `monitoring_point_kind_check` check, `unit`, `target_min`/`target_max`
  numeric(19,6) with the `monitoring_point_target_range_check` check
  (`target_min <= target_max`), `check_frequency` with the
  `monitoring_point_check_frequency_check` check, `active` defaulting to true and
  the audit columns, with the `monitoring_point_organization_id_code_key` unique
  on `(organization_id, code)` and the organization/location/storage-area FKs.
  `monitoring_reading` holds `organization_id`, `monitoring_point_id`, `value`
  numeric(19,6), `unit`, `measured_at`, the nullable `recorded_by`, `in_range`,
  the nullable `notes` and the audit columns, with the organization and point FKs
  and the `monitoring_reading_org_point_measured_idx` index on
  `(organization_id, monitoring_point_id, measured_at)`. It adds two tables and
  no hand-written statement.
  `0037_hms_monitoring_down.sql` drops the index first, then
  `monitoring_reading`, then `monitoring_point` (FK-safe order: the reading FK
  references the point, so the child goes first), inside one `BEGIN;`/`COMMIT;`
  and with `DROP ... IF EXISTS` so a half-applied manual run cannot wedge. It is
  **destructive** — every monitoring point and every recorded reading is lost —
  so run it only while those rows need not be preserved (AGENTS.md Rule 2). Apply
  it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0037_hms_monitoring_down.sql`.
  Apply `0038`'s down **before** `0037`'s down: its append-only triggers live on
  `monitoring_reading`, which `0037`'s down drops.
- **0038 adds the `DEC-089`/`HMS-002` `monitoring_reading` append-only guard and
  follows the down convention:** `0038_hms_monitoring_append_only.sql` is
  hand-written (the `0002_invariants.sql` append-only trigger pattern applied to
  the HMS reading). One function (`monitoring_reading_append_only()`) and three
  triggers: two `BEFORE FOR EACH ROW` triggers (`monitoring_reading_immutable`
  on UPDATE, `monitoring_reading_no_delete` on DELETE) and one `BEFORE TRUNCATE
  FOR EACH STATEMENT` trigger (`monitoring_reading_no_truncate`, mirroring
  `0002_invariants.sql`; the function raises on `TG_OP = 'TRUNCATE'` too, where
  `NEW`/`OLD` are null) reject a DELETE, a TRUNCATE and an UPDATE that
  changes `value`, `unit`, `measured_at`, `monitoring_point_id` or
  `organization_id`, so only `notes` (with the `updated_at`/`updated_by` audit
  columns) may be amended. It adds no table and no row.
  `0038_hms_monitoring_append_only_down.sql` drops the three triggers and their
  function inside one `BEGIN;`/`COMMIT;` (with `DROP ... IF EXISTS` so a
  half-applied manual run cannot wedge). No table and no row is touched, so the
  down cannot fail on data; while dropped, a reading's immutability rests only on
  the application. Apply it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0038_hms_monitoring_append_only_down.sql`.
- **0039 adds the `DEC-089` HMS monitoring cross-organization coherence guards and
  follows the down convention:** `0039_hms_monitoring_org_guard.sql` is
  hand-written (`DEC-079`'s `BEFORE INSERT OR UPDATE` guard shape, mirroring
  `0036`). Two functions and two triggers: `monitoring_point_org_guard` on
  `monitoring_point` rejects a `location_id` or a non-null `storage_area_id`
  whose `location`/`storage_area` belongs to another organization than the point,
  and `monitoring_reading_org_guard` on `monitoring_reading` rejects a
  `monitoring_point_id` whose `monitoring_point` belongs to another organization
  than the reading. Each resolves the referenced row's organization through the
  existing FK path (a null `storage_area_id` — and, defensively, a null
  `location_id` — is skipped; a missing row falls through to the FK error) and
  raises `ERRCODE = '23514'`, naming the offending column. It is **trigger-only
  and table-neutral**: it adds no table and no constraint that validates an
  existing row, so it scans no row and needs no preflight query.
  `0039_hms_monitoring_org_guard_down.sql` drops the two triggers and their
  functions inside one `BEGIN;`/`COMMIT;` (with `DROP ... IF EXISTS` so a
  half-applied manual run cannot wedge). No table and no row is touched, so the
  down cannot fail on data; while dropped, the references' organization coherence
  is validated only by the application. Apply it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0039_hms_monitoring_org_guard_down.sql`.
  Apply `0039`'s down **before** `0037`'s down if the tables go too: its triggers
  live on `monitoring_point`/`monitoring_reading`, which `0037`'s down drops.
- **0040 adds the HMS incidents tables and follows the down convention:**
  `0040_hms_incidents.sql` is generated DDL for the two tables, additive like
  `0037`: `hms_incident` (with the `hms_incident_category_check` /
  `hms_incident_severity_check` / `hms_incident_status_check` vocabulary checks,
  the organization/location FKs and org-first indexes) and `corrective_action`
  (with the `corrective_action_status_check` vocabulary check and the FKs to
  `organization`, `location`, `hms_incident` and `monitoring_reading`), all
  cheap at first apply because both tables start empty. It adds two tables and
  no hand-written statement.
  `0040_hms_incidents_down.sql` drops the two tables (FK-safe order:
  `corrective_action` first — it references `hms_incident` and
  `monitoring_reading` — then `hms_incident`), inside one `BEGIN;`/`COMMIT;`
  and with `DROP ... IF EXISTS` so a half-applied manual run cannot wedge. It is
  **destructive** — every incident and corrective action is lost — so run it
  only while those rows need not be preserved (AGENTS.md Rule 2). Apply it
  manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0040_hms_incidents_down.sql`.
  Apply `0041`'s down **before** `0040`'s down: its guard triggers live on
  `hms_incident`/`corrective_action`, which `0040`'s down drops.
- **0041 adds the HMS incidents cross-organization coherence guards and follows
  the down convention:** `0041_hms_incidents_org_guard.sql` is hand-written
  (`DEC-079`'s `BEFORE INSERT OR UPDATE` guard shape, mirroring `0039`). Two
  functions and two triggers: `hms_incident_org_guard` on `hms_incident`
  rejects a `location_id` whose `location` belongs to another organization
  than the incident, and `corrective_action_org_guard` on `corrective_action`
  rejects an `incident_id` or a `monitoring_reading_id` whose
  `hms_incident`/`monitoring_reading` belongs to another organization than the
  corrective action. Each resolves the referenced row's organization through
  the existing FK path (a missing row falls through to the FK error) and
  raises `ERRCODE = '23514'`, naming the offending column. It is
  **trigger-only and table-neutral**: it adds no table and no constraint that
  validates an existing row, so it scans no row and needs no preflight query.
  `0041_hms_incidents_org_guard_down.sql` drops the two triggers and their
  functions inside one `BEGIN;`/`COMMIT;` (with `DROP ... IF EXISTS` so a
  half-applied manual run cannot wedge). No table and no row is touched, so the
  down cannot fail on data; while dropped, the references' organization
  coherence is validated only by the application. Apply it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0041_hms_incidents_org_guard_down.sql`.
- **0042 adds the checklist tables and follows the down convention:**
  `0042_checklists.sql` is generated DDL for the two tables, additive like
  `0037`/`0040`: `checklist_template` (with the nullable `supersedes_id`
  self-FK, the `checklist_template_category_check` /
  `checklist_template_frequency_check` vocabulary checks, the
  `checklist_template_items_array_check` `jsonb_typeof(items) = 'array'` check
  and the `checklist_template_supersedes_self_check` no-self-supersede check)
  and `checklist_run` (with the FKs to `checklist_template` and `location`, the
  `checklist_run_status_check` vocabulary check and the
  `checklist_run_results_array_check` `jsonb_typeof(results) = 'array'` check,
  and org-first indexes), all cheap at first apply because both tables start
  empty. It adds two tables and no hand-written statement.
  `0042_checklists_down.sql` drops the two tables (FK-safe order:
  `checklist_run` first — it references `checklist_template` — then
  `checklist_template`), inside one `BEGIN;`/`COMMIT;` and with
  `DROP ... IF EXISTS` so a half-applied manual run cannot wedge. It is
  **destructive** — every checklist template and run is lost — so run it only
  while those rows need not be preserved (AGENTS.md Rule 2). Apply it manually
  with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0042_checklists_down.sql`.
  Apply `0043`'s down **before** `0042`'s down: its guard triggers live on
  `checklist_template`/`checklist_run`, which `0042`'s down drops.
- **0043 adds the checklist cross-organization coherence guards and follows the
  down convention:** `0043_checklists_org_guard.sql` is hand-written
  (`DEC-079`'s `BEFORE INSERT OR UPDATE` guard shape, mirroring `0041`). Two
  functions and two triggers: `checklist_template_org_guard` on
  `checklist_template` rejects a `supersedes_id` whose `checklist_template`
  belongs to another organization than the template, and
  `checklist_run_org_guard` on `checklist_run` rejects a `template_id` or
  `location_id` whose `checklist_template`/`location` belongs to another
  organization than the run. Each resolves the referenced
  row's organization through the existing FK path (a missing row falls through
  to the FK error) and raises `ERRCODE = '23514'`, naming the offending column.
  It is **trigger-only and table-neutral**: it adds no table and no constraint
  that validates an existing row, so it scans no row and needs no preflight
  query.
  `0043_checklists_org_guard_down.sql` drops the two triggers and their
  functions inside one `BEGIN;`/`COMMIT;` (with `DROP ... IF EXISTS` so a
  half-applied manual run cannot wedge). No table and no row is touched, so the
  down cannot fail on data; while dropped, the references' organization
  coherence is validated only by the application. Apply it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0043_checklists_org_guard_down.sql`.
- **0044 adds the equipment and maintenance-log tables and follows the down
  convention:** `0044_equipment.sql` is generated DDL for the two tables, additive
  like `0037`/`0040`/`0042`: `equipment` (the FKs to `organization` and
  `location`, the `equipment_organization_id_code_key` unique on
  `(organization_id, code)`, the `equipment_code_nonempty_check` /
  `equipment_name_nonempty_check` non-empty checks and the
  `equipment_org_location_idx` / `equipment_org_active_idx` org-first indexes) and
  `maintenance_log` (the FKs to `organization`, `equipment` and the nullable
  `file_object`, the `maintenance_log_kind_check` vocabulary check and the
  `maintenance_log_org_equipment_performed_idx` / `maintenance_log_org_kind_idx`
  org-first indexes), all cheap at first apply because both tables start empty. It
  adds two tables and no hand-written statement.
  `0044_equipment_down.sql` drops the two tables (FK-safe order:
  `maintenance_log` first — it FKs `equipment` — then `equipment`), inside one
  `BEGIN;`/`COMMIT;` and with `DROP TABLE IF EXISTS` so a half-applied manual run
  cannot wedge. It is **destructive** — every equipment register row and
  maintenance log row is lost — so run it only while those rows need not be
  preserved (AGENTS.md Rule 2). Apply it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0044_equipment_down.sql`.
  Apply `0045`'s down **before** `0044`'s down: its guard triggers live on
  `equipment`/`maintenance_log`, which `0044`'s down drops.
- **0045 adds the equipment cross-organization coherence guards and follows the
  down convention:** `0045_equipment_org_guard.sql` is hand-written
  (`DEC-079`'s `BEFORE INSERT OR UPDATE` guard shape, mirroring `0043`). Three
  functions and three triggers: `equipment_location_org_guard` on `equipment`
  rejects a `location_id` whose `location` belongs to another organization than
  the equipment, `maintenance_log_equipment_org_guard` on `maintenance_log`
  rejects an `equipment_id` whose `equipment` belongs to another organization than
  the log, and `maintenance_log_file_object_org_guard` on `maintenance_log`
  rejects a non-null `file_object_id` whose `file_object` belongs to another
  organization than the log. Each resolves the referenced row's organization
  through the existing FK path (a null `file_object_id` returns untouched; a
  missing row falls through to the FK error) and raises `ERRCODE = '23514'`,
  naming the offending column. It is **trigger-only and table-neutral**: it adds
  no table and no constraint that validates an existing row, so it scans no row
  and needs no preflight query.
  `0045_equipment_org_guard_down.sql` drops the three triggers and their
  functions inside one `BEGIN;`/`COMMIT;` (with `DROP ... IF EXISTS` so a
  half-applied manual run cannot wedge). No table and no row is touched, so the
  down cannot fail on data; while dropped, the references' organization
  coherence is validated only by the application. Apply it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0045_equipment_org_guard_down.sql`.
- **0046 adds the employee and personnel-document tables and follows the down
  convention:** `0046_workforce.sql` is generated DDL for the two tables, additive
  like `0037`/`0040`/`0042`/`0044`: `employee` (the FKs to `organization`,
  `app_user` and the nullable `location`, the `employee_employment_type_check`
  vocabulary check (`full_time`/`part_time`/`on_call`/`temporary`/`apprentice`),
  the `employee_base_hourly_rate_check` (`base_hourly_rate >= 0`), the
  `employee_active_range_check` (`active_to is null or active_to > active_from`)
  and the `employee_org_active_idx` / `employee_org_primary_location_idx`
  org-first indexes) and `employee_document` (the FKs to `organization`,
  `employee` and the nullable `file_object`, the `employee_document_kind_check`
  vocabulary check (`contract`/`certificate`/`id_document`/`other`) and the
  `employee_document_org_employee_idx` / `employee_document_org_kind_idx` /
  `employee_document_org_expires_idx` org-first indexes), all cheap at first
  apply because both tables start empty. It adds two tables and no hand-written
  statement.
  `0046_workforce_down.sql` drops the two tables (FK-safe order:
  `employee_document` first — it FKs `employee` — then `employee`), inside one
  `BEGIN;`/`COMMIT;` and with `DROP TABLE IF EXISTS` so a half-applied manual run
  cannot wedge. It is **destructive** — every employee and personnel-document row
  is lost — so run it only while those rows need not be preserved (AGENTS.md
  Rule 2). Apply it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0046_workforce_down.sql`.
  Apply `0047`'s down **before** `0046`'s down: its guard triggers live on
  `employee`/`employee_document`, which `0046`'s down drops.
- **0047 adds the workforce cross-organization coherence guards and follows the
  down convention:** `0047_workforce_org_guard.sql` is hand-written
  (`DEC-079`'s `BEFORE INSERT OR UPDATE` guard shape, mirroring `0045`). Four
  functions and four triggers: `employee_primary_location_org_guard` on
  `employee` rejects a non-null `primary_location_id` whose `location` belongs to
  another organization than the employee, `employee_user_org_guard` on `employee`
  rejects a non-null `user_id` whose `app_user` belongs to another organization
  than the employee, `employee_document_employee_org_guard` on `employee_document`
  rejects an `employee_id` whose `employee` belongs to another organization than
  the document, and `employee_document_file_object_org_guard` on
  `employee_document` rejects a non-null `file_object_id` whose `file_object`
  belongs to another organization than the document. Each resolves the referenced
  row's organization through the existing FK path (a null reference returns
  untouched; a missing row falls through to the FK error) and raises
  `ERRCODE = '23514'`, naming the offending column. It is **trigger-only and
  table-neutral**: it adds no table and no constraint that validates an existing
  row, so it scans no row and needs no preflight query.
  `0047_workforce_org_guard_down.sql` drops the four triggers and their functions
  inside one `BEGIN;`/`COMMIT;` (with `DROP ... IF EXISTS` so a half-applied
  manual run cannot wedge). No table and no row is touched, so the down cannot
  fail on data; while dropped, the references' organization coherence is
  validated only by the application. Apply it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0047_workforce_org_guard_down.sql`.
- **0048 adds the `DEC-088` (`DOC-001`…`DOC-004`) staff document library tables
  and follows the down convention:** `0048_staff_documents.sql` is generated DDL
  for the three tables (see the ledger row below): `document` (`organization_id`,
  `title`, `category` with the `document_category_check`, `audience` with the
  `document_audience_check`, `status` with the `document_status_check` and default
  `draft`, the plain-uuid `owner_id`, the audit columns, the organization FK and
  the `document_org_status_idx` / `document_org_audience_idx` indexes),
  `document_version` (`organization_id`, `document_id`, `version_no` with the
  `document_version_version_no_check` (`> 0`), the nullable `file_object_id`, the
  nullable `notes`/`published_at`/`published_by` with the all-or-nothing
  `document_version_published_check`, the audit columns, the FKs to
  organization/document/file-object, the `document_version_document_version_key`
  unique on `(document_id, version_no)` and the
  `document_version_org_document_idx` index) and `document_acknowledgement`
  (`organization_id`, `document_version_id`, `acknowledged_by`,
  `acknowledged_at`, **no** audit columns — the `import_disposition` fact-table
  precedent, the FKs to organization/document-version, the
  `document_acknowledgement_version_user_key` unique on
  `(document_version_id, acknowledged_by)` and the
  `document_acknowledgement_org_version_idx` / `_org_user_idx` indexes). It adds
  three tables and no hand-written statement.
  `0048_staff_documents_down.sql` drops the three tables in FK-safe order
  (`document_acknowledgement` first — it references `document_version` — then
  `document_version`, then `document`) inside one `BEGIN;`/`COMMIT;`, with
  `DROP TABLE IF EXISTS` so a half-applied manual run cannot wedge. It is
  **destructive** — every document, version and acknowledgement row is lost — so
  run it only while those rows need not be preserved (AGENTS.md Rule 2). Apply
  `0049`'s down **before** `0048`'s down. Apply it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0048_staff_documents_down.sql`.
- **0049 adds the `DEC-088` staff-document cross-organization coherence guards
  and follows the down convention:** `0049_staff_documents_org_guard.sql` is
  hand-written (`DEC-079`'s `BEFORE INSERT OR UPDATE` guard shape, mirroring
  `0047`). Three functions and three triggers:
  `document_version_document_org_guard` on `document_version` rejects a
  `document_id` whose `document` belongs to another organization than the
  version, `document_version_file_object_org_guard` on `document_version`
  rejects a non-null `file_object_id` whose `file_object` belongs to another
  organization than the version, and
  `document_acknowledgement_document_version_org_guard` on
  `document_acknowledgement` rejects a `document_version_id` whose
  `document_version` belongs to another organization than the acknowledgement.
  Each resolves the referenced row's organization through the existing FK path
  (a null `file_object_id` returns untouched; a missing row falls through to the
  FK error) and raises `ERRCODE = '23514'`, naming the offending column. It is
  **trigger-only and table-neutral**: it adds no table and no constraint that
  validates an existing row, so it scans no row and needs no preflight query.
  `0049_staff_documents_org_guard_down.sql` drops the three triggers and their
  functions inside one `BEGIN;`/`COMMIT;` (with `DROP ... IF EXISTS` so a
  half-applied manual run cannot wedge). No table and no row is touched, so the
  down cannot fail on data; while dropped, the references' organization
  coherence is validated only by the application. Apply it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0049_staff_documents_org_guard_down.sql`.
- **0050 adds the `DEC-094` schema-only workflow platform tables and follows the
  down convention:** `0050_workflow_platform.sql` is generated DDL for the two
  tables — `task` (`organization_id`, the free-text `type`, the nullable
  polymorphic `linked_entity_type`/`linked_entity_id` pair, the plain-uuid
  `owner_id`, the nullable `due_date`, the free-text `priority`, `status`
  defaulting to `open`, the nullable `resolution` and plain-uuid
  `created_from_event_id`, the audit columns, the organization FK and the
  `task_status_check` / `task_linked_entity_check` checks plus the
  `task_org_status_idx` / `task_org_owner_due_idx` / `task_org_linked_idx`
  org-first indexes) and `approval` (`organization_id`, the polymorphic
  `entity_type`/`entity_id`, the nullable `entity_version`, the required
  `requested_by`/`requested_at`, the nullable `decided_by`/`decided_at`/
  `decision`/`comment`, the audit columns, the organization FK and the
  `approval_decision_check` / `approval_decided_check` checks plus the
  `approval_org_entity_idx` / `approval_org_decision_idx` indexes). Both tables
  are mutable and carry the standard audit columns. The `job` table, the
  worker/scheduler and the outbox async layer are deliberately **not** built
  (`ADR-0004` gated), so `created_from_event_id` stays a plain uuid; `task` has
  no `location_id` (the `corrective_action` location-scope ceiling). It adds two
  tables and no hand-written statement, and has **no companion org-guard
  migration**: neither table has a cross-organization FK beyond
  `organization_id`, so `0050` is the only file.
  `0050_workflow_platform_down.sql` drops `approval` then `task` inside one
  `BEGIN;`/`COMMIT;` (with `DROP TABLE IF EXISTS` so a half-applied manual run
  cannot wedge); the checks, FKs and indexes drop with the tables. It is
  **destructive** — every task and approval row is lost — so run it only while
  those rows need not be preserved (AGENTS.md Rule 2). Apply it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0050_workflow_platform_down.sql`.
- **0051 adds the `DEC-037`/`DEC-038` (`WF-002`, `WF-003`) shift-scheduling
  tables and follows the down convention** (see the ledger row below): `0051_shift_scheduling.sql` is
  generated DDL for the two tables, additive like `0037`/`0040`/`0042`/`0044`;
  `shift` (`organization_id`, the NOT NULL `location_id`, the nullable free-text
  `role_code` (null = any role), `starts_at`/`ends_at`, `break_minutes`
  defaulting to 0, `state` defaulting to `open`, the nullable `published_at` and
  the reserved `actual_start`/`actual_end` (`DEC-038`), the audit columns, the
  organization and location FKs, the `shift_state_check` /
  `shift_time_range_check` / `shift_break_minutes_check` /
  `shift_actual_range_check` checks and the `shift_org_location_starts_idx` /
  `shift_org_state_idx` org-first indexes) and `shift_assignment`
  (`organization_id`, the NOT NULL `shift_id`/`employee_id`, `state`, the
  nullable plain-uuid `assigned_by` (null = self-assigned), `assigned_at`, the
  audit columns, the organization/shift/employee FKs, the
  `shift_assignment_state_check` check, the
  `shift_assignment_shift_employee_key` unique on `(shift_id, employee_id)` and
  the `shift_assignment_org_shift_idx` / `shift_assignment_org_employee_idx`
  org-first indexes). The spec's `created_by`/`created_at` are the
  `auditColumns()` ones — no duplicate business column. Both tables are mutable.
  It adds two tables and no hand-written statement.
  `0051_shift_scheduling_down.sql` drops the two tables in FK-safe order
  (`shift_assignment` first — it FKs `shift` and `employee` — then `shift`)
  inside one `BEGIN;`/`COMMIT;`, with `DROP TABLE IF EXISTS` so a half-applied
  manual run cannot wedge. It is **destructive** — every shift and assignment
  row is lost — so run it only while those rows need not be preserved (AGENTS.md
  Rule 2). Apply `0052`'s down **before** `0051`'s down. Apply it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0051_shift_scheduling_down.sql`.
- **0052 adds the `DEC-037`/`DEC-038` shift-scheduling cross-organization
  coherence guards and follows the down convention:**
  `0052_shift_scheduling_org_guard.sql` is hand-written (`DEC-079`'s
  `BEFORE INSERT OR UPDATE` guard shape, mirroring `0049`). Three functions and
  three triggers: `shift_location_org_guard` on `shift` rejects a `location_id`
  whose `location` belongs to another organization than the shift,
  `shift_assignment_shift_org_guard` on `shift_assignment` rejects a `shift_id`
  whose `shift` belongs to another organization, and
  `shift_assignment_employee_org_guard` on `shift_assignment` rejects an
  `employee_id` whose `employee` belongs to another organization. Each resolves
  the referenced row's organization through the existing FK path (a missing row
  falls through to the FK error) and raises `ERRCODE = '23514'`, naming the
  offending column. All three columns are NOT NULL, so the guards are
  unconditional (no null-reference skip, unlike `0049`). It is **trigger-only
  and table-neutral**: it adds no table and no constraint that validates an
  existing row, so it scans no row and needs no preflight query.
  `0052_shift_scheduling_org_guard_down.sql` drops the three triggers and their
  functions inside one `BEGIN;`/`COMMIT;` (with `DROP ... IF EXISTS` so a
  half-applied manual run cannot wedge). No table and no row is touched, so the
  down cannot fail on data; while dropped, the references' organization
  coherence is validated only by the application. Apply it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0052_shift_scheduling_org_guard_down.sql`.
  Apply `0052`'s down **before** `0051`'s down if the tables go too: its
  triggers live on `shift`/`shift_assignment`, which `0051`'s down drops.
- **0053 adds the `DEC-038` (`WF-004`) worked-hours correction table and follows
  the down convention** (see the ledger row below): `0053_shift_adjustment.sql` is
  generated DDL for one table, additive like `0037`/`0040`/`0042`/`0044`/`0046`/
  `0048`/`0050`/`0051` — `shift_adjustment` (`organization_id`, the NOT NULL
  `shift_assignment_id` FK, the `adjusted_hours` numeric(9,2) with the
  `shift_adjustment_adjusted_hours_check` (`>= 0`), the required `reason`, the
  nullable plain-uuid `approved_by` and nullable `approved_at` with the
  all-or-nothing `shift_adjustment_approved_check`, the audit columns, the
  organization FK and the `shift_adjustment_org_assignment_idx` org-first index).
  The spec's `created_at` is the `auditColumns()` one — no duplicate business
  column. A correction is an append-only fact: worked hours are derived from the
  shift, never edited on it, and the latest correction wins at read time
  (`DEC-038`, `DATA_DICTIONARY` §4A). It adds one table and no hand-written
  statement.
  `0053_shift_adjustment_down.sql` drops the table inside one `BEGIN;`/`COMMIT;`
  (with `DROP TABLE IF EXISTS` so a half-applied manual run cannot wedge); the
  checks, FKs and index drop with the table. It is **destructive** — every
  recorded hours correction is lost — so run it only while those corrections need
  not be preserved (AGENTS.md Rule 2). Apply `0054`'s down **before** `0053`'s
  down. Apply it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0053_shift_adjustment_down.sql`.
- **0054 adds the `DEC-038` worked-hours cross-organization coherence guard and
  follows the down convention:** `0054_shift_adjustment_org_guard.sql` is
  hand-written (`DEC-079`'s `BEFORE INSERT OR UPDATE` guard shape, mirroring
  `0052`). One function and one trigger: `shift_adjustment_shift_assignment_org_guard`
  on `shift_adjustment` rejects a `shift_assignment_id` whose `shift_assignment`
  belongs to another organization than the adjustment. It resolves the referenced
  row's organization through the existing FK path (a missing row falls through to
  the FK error) and raises `ERRCODE = '23514'`, naming the offending column. The
  column is NOT NULL, so the guard is unconditional (no null-reference skip,
  unlike `0049`). It is **trigger-only and table-neutral**: it adds no table and
  no constraint that validates an existing row, so it scans no row and needs no
  preflight query.
  `0054_shift_adjustment_org_guard_down.sql` drops the trigger and its function
  inside one `BEGIN;`/`COMMIT;` (with `DROP ... IF EXISTS` so a half-applied
  manual run cannot wedge). No table and no row is touched, so the down cannot
  fail on data; while dropped, the reference's organization coherence is validated
  only by the application. Apply it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0054_shift_adjustment_org_guard_down.sql`.
  Apply `0054`'s down **before** `0053`'s down if the table goes too: its trigger
  lives on `shift_adjustment`, which `0053`'s down drops.
- **0055 adds the `DEC-037` (`WF-005`) monthly payroll-input report table and
  follows the down convention** (see the ledger row below): `0055_payroll_report.sql`
  is generated DDL for one table, additive like `0037`/`0040`/`0042`/`0044`/
  `0046`/`0048`/`0050`/`0051`/`0053` — `payroll_report` (`organization_id`, the
  `period_start`/`period_end` `date`s, `generated_at` default `now()`, the nullable
  plain-uuid `generated_by`, `status` default `draft`, the `snapshot` jsonb, the
  nullable `export_file_id` FK → `file_object`, the audit columns, the
  `payroll_report_status_check` / `payroll_report_period_check` checks, the
  **partial** unique index `payroll_report_org_period_key` on
  `(organization_id, period_start)` `WHERE status <> 'superseded'` and the
  `payroll_report_org_status_idx` / `payroll_report_org_period_idx` indexes). The
  `export_file_id` FK is emitted inline by drizzle-kit: the table is new and
  empty, so the `NOT VALID` → `VALIDATE CONSTRAINT` dance used for a pre-existing
  table (`0029`/`0031`/`0035`) is unnecessary.
  `0055_payroll_report_down.sql` drops the table inside one `BEGIN;`/`COMMIT;`
  (with `DROP TABLE IF EXISTS` so a half-applied manual run cannot wedge); the
  FKs, the unique index, the checks and the two indexes drop with the table. It is
  **destructive** — every report and its frozen snapshot is lost — so run it only
  while those reports need not be preserved (AGENTS.md Rule 2). Apply `0056`'s
  down **before** `0055`'s down. Apply it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0055_payroll_report_down.sql`.
- **0056 adds the `DEC-037` payroll-report cross-organization coherence guard and
  follows the down convention:** `0056_payroll_report_org_guard.sql` is
  hand-written (`DEC-079`'s `BEFORE INSERT OR UPDATE` guard shape, mirroring
  `0045`). One function and one trigger: `payroll_report_export_file_org_guard`
  on `payroll_report` rejects a non-null `export_file_id` whose `file_object`
  belongs to another organization than the report. It resolves the referenced
  row's organization through the existing FK path (a missing row falls through to
  the FK error) and raises `ERRCODE = '23514'`, naming the offending column.
  `export_file_id` is nullable, so the guard is conditional and skips a null
  reference. It is **trigger-only and table-neutral**: it adds no table and no
  constraint that validates an existing row, so it scans no row and needs no
  preflight query.
  `0056_payroll_report_org_guard_down.sql` drops the trigger and its function
  inside one `BEGIN;`/`COMMIT;` (with `DROP ... IF EXISTS` so a half-applied
  manual run cannot wedge). No table and no row is touched, so the down cannot
  fail on data; while dropped, the reference's organization coherence is validated
  only by the application. Apply it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0056_payroll_report_org_guard_down.sql`.
  Apply `0056`'s down **before** `0055`'s down if the table goes too: its trigger
  lives on `payroll_report`, which `0055`'s down drops.
- **0057 adds the `REC-003`/`REC-006`/`DEC-027` (row 13a) close/lock table and
  follows the down convention** (see the ledger row below): `0057_period_close.sql`
  is generated DDL for one table, additive like `0037`/`0040`/`0042`/`0044`/
  `0046`/`0048`/`0050`/`0051`/`0053`/`0055` — `period_close` (`organization_id`,
  the `scope_type` (`location`/`company`) and NOT NULL plain-uuid `scope_id`, the
  `period_start`/`period_end` `date`s, `status` default `open`, the `checklist`
  jsonb default `'[]'::jsonb`, the nullable `snapshot` jsonb, the nullable
  `correction_policy` text, the nullable plain-uuid `locked_by`/`reopened_by` with
  their `timestamptz` instants and the nullable `reopen_reason`, the audit
  columns, the organization FK, the six checks — `period_close_status_check`,
  `period_close_scope_type_check`, `period_close_period_range_check`,
  `period_close_granularity_check`, `period_close_locked_check`,
  `period_close_reopened_check` — the `period_close_org_scope_period_key` unique
  on `(organization_id, scope_type, scope_id, period_start)` and the
  `period_close_org_scope_idx` / `period_close_org_status_idx` indexes).
  `0057_period_close_down.sql` drops the table inside one `BEGIN;`/`COMMIT;`
  (with `DROP TABLE IF EXISTS` so a half-applied manual run cannot wedge); the
  checks, unique, FK and indexes drop with the table. It is **destructive** —
  every close and its frozen snapshot is lost — so run it only while those rows
  need not be preserved (AGENTS.md Rule 2). Apply `0058`'s down **before**
  `0057`'s down. Apply it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0057_period_close_down.sql`.
- **0058 adds the `REC-003`/`REC-006`/`DEC-027` (row 13a) `period_close` guards
  and follows the down convention:** `0058_period_close_org_guard.sql` is
  hand-written (`DEC-079`'s `BEFORE INSERT OR UPDATE` guard shape, mirroring
  `0045`/`0052`/`0056`, plus two immutability guards). Three functions and three
  triggers: `period_close_scope_org_guard` on `period_close` rejects a `location`
  scope whose `scope_id` is not a `location` row in the row's own organization
  (unlike `0045`/`0056`, it checks **existence too**, because `scope_id` carries
  no FK); `period_close_locked_immutability` rejects any change to a `locked`
  row's `snapshot`, period, scope, tenancy or lock actor, and any status other
  than `locked`/`reopened`; `period_close_locked_delete_guard` rejects deleting a
  `locked` row.
  All raise `ERRCODE = '23514'`. It is **trigger-only and table-neutral**: it adds
  no table and no constraint that validates an existing row, so it scans no row
  and needs no preflight query.
  `0058_period_close_org_guard_down.sql` drops the three triggers and their
  functions inside one `BEGIN;`/`COMMIT;` (with `DROP ... IF EXISTS` so a
  half-applied manual run cannot wedge). No table and no row is touched, so the
  down cannot fail on data; while dropped, the scope coherence and the
  locked-snapshot immutability are validated only by the application. Apply it
  manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0058_period_close_org_guard_down.sql`.
  Apply `0058`'s down **before** `0057`'s down if the table goes too: its triggers
  live on `period_close`, which `0057`'s down drops.
- **0059 adds the `REC-006`/`DEC-027` (row 13b) adjustment-period table and
  follows the down convention** (see the ledger row below):
  `0059_adjustment_period.sql` is generated DDL for one table, additive like
  `0037`/`0040`/`0042`/`0044`/`0046`/`0048`/`0050`/`0051`/`0053`/`0055`/`0057` —
  `adjustment_period` (`organization_id`, the `opened_from`/`opened_to` `date`s,
  the required `reason` text, the nullable plain-uuid `approved_by` with its
  `timestamptz` `approved_at` (the `app_user` FK is deferred), `status` default
  `open`, the audit columns, the organization FK, the three checks —
  `adjustment_period_status_check`, `adjustment_period_range_check`,
  `adjustment_period_approved_check` — the partial unique
  `adjustment_period_open_key` on `(organization_id) WHERE status = 'open'` (at
  most one open adjustment period per organization, the race-safe backstop for
  `openAdjustmentPeriod`) and the `adjustment_period_org_status_idx` /
  `adjustment_period_org_opened_idx` indexes).
  `0059_adjustment_period_down.sql` drops the table inside one `BEGIN;`/`COMMIT;`
  (with `DROP TABLE IF EXISTS` so a half-applied manual run cannot wedge); the
  checks, unique, FK and indexes drop with the table. It is **destructive** —
  every adjustment period and its approval is lost — so run it only while those
  rows need not be preserved (AGENTS.md Rule 2). Apply it manually with
  `psql "$DATABASE_URL" -f packages/persistence/drizzle/0059_adjustment_period_down.sql`.

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
`… = 1789911710033` for 0020, `… = 1789913486015` for 0021,
`… = 1789915583040` for 0022, `… = 1789917983755` for 0023,
`… = 1789938630318` for 0024, `… = 1789938645539` for 0025,
`… = 1789940067864` for 0026,
`… = 1789949551665` for 0027,
`… = 1789951616253` for 0028,
`… = 1789952943481` for 0029 and
`… = 1789954073839` for 0030,
`… = 1789972623859` for 0031 and
`… = 1789973761461` for 0032 and
`… = 1789977792561` for 0033 and
`… = 1789989056234` for 0034 and
`… = 1789990745770` for 0035 and
`… = 1789990766802` for 0036 and
`… = 1789995070090` for 0037 and
`… = 1789995080123` for 0038 and
`… = 1789996231921` for 0039 and
`… = 1790024758839` for 0040 and
`… = 1790024895228` for 0041,
`… = 1790027667971` for 0042 and
`… = 1790027669000` for 0043,
`… = 1790030048087` for 0044,
`… = 1790030073708` for 0045,
`… = 1790035770192` for 0046,
`… = 1790035771192` for 0047,
`… = 1790054700573` for 0048,
`… = 1790054714766` for 0049,
`… = 1790061475649` for 0050,
`… = 1790063480942` for 0051,
`… = 1790063500924` for 0052,
`… = 1790067016722` for 0053,
`… = 1790067030453` for 0054,
`… = 1790110579392` for 0057,
`… = 1790110580000` for 0058 and
`… = 1790113826232` for 0059, then
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
production work; 0022 rehearsed with the slice-11 import-framework work; 0023
rehearsed with the slice-12 sales/settlement/reconciliation persistence work —
the down restored the `0021` guard, the ledger row was deleted and
`db:migrate` re-applied it, leaving the database with all 62 tables and the
`sales_line` guard branch; 0024 and 0025 rehearsed with the DEC-072/DEC-074
persistence work — 0024's down dropped the tolerance table and deleting its
ledger row then re-applying restored it (63 tables), 0025's down restored the
four-value checks with no row changes, then deleting its ledger row and
re-applying restored the five-value ones, 0026's down dropped the
`sales_line_reversal_of_id_key` partial unique index with no row changes, then
deleting its ledger row and re-applying restored it, and 0027's down dropped the
`price_version_no_overlap` constraint and the `price_version` table, then
deleting its ledger row and re-applying restored the table, its index and the
EXCLUDE constraint — 64 tables; 0028's down dropped `settlement_status_check`,
`reconciliation_scope_type_check` and the `settlement.status` default with no
row changes, then deleting its ledger row and re-applying restored the default
and both checks; 0029's down dropped the three `DEC-079` org-coherence guard
triggers, their functions and the `goods_receipt_line.supplier_item_id` FK with
no row changes, then deleting its ledger row and re-applying restored the three
guards and the FK; 0030's down dropped the `data_quality_exception` table (which
held no rows in the local dev database), then deleting its ledger row and
re-applying restored the table, its two checks, its organization FK and its two
indexes — 65 tables; 0031's down dropped the `import_run.import_profile_id`
column and the `import_profile` table, then deleting its ledger row and
re-applying restored the column, its FK and the table with its unique and both
checks — 66 tables; 0032's down dropped the `import_run_profile_org_guard`
trigger and its function with no row changes (a cross-organization `import_run`
insert succeeded while the guard was absent), then deleting its ledger row and
re-applying restored the guard and rejected that insert again — 66 tables;
0034 on 2026-09-21 dropped the retained `diagnostics.dispositions` key from the
dev runs and its down rebuilt it from `import_disposition` value-identically
(not order-identically), then deleting its ledger row and re-applying dropped it
again — still 67 tables; 0035 on 2026-09-21 dropped the
`import_run.file_object_id` FK and the `file_object` table (67 tables), then
deleting its ledger row and re-applying restored the table, its
`file_object_org_storage_key_key` unique, its `size_bytes` check, its
organization FK and the deferred `import_run.file_object_id` FK — 68 tables;
0036's down dropped the `file_object_org_guard` trigger and its function with no
row changes, then deleting its ledger row and re-applying restored the guard —
still 68 tables; 0037 on 2026-09-21 added the two `DEC-089`/`HMS-002` HMS
monitoring tables and 0038 the `monitoring_reading` append-only guard, then
0037's down dropped the index and the two tables (68 tables) and 0038's down
dropped the three triggers and the function with no table change, and deleting
their ledger rows and re-applying restored the tables, their checks, uniques, FKs
and index and the guard — 70 tables; 0040 on 2026-09-21 added the two HMS
incidents tables and 0041 the two guards, then 0041's down dropped the two guard
triggers and their functions with no table change (72 → 72 tables) and 0040's
down dropped the two tables (72 → 70 tables), and deleting their ledger rows and
re-applying restored the tables, their checks, FKs and indexes and both guards —
72 tables, with a further `db:migrate` run a no-op; the rehearsal also observed
the three guard messages (`hms_incident.location_id … belongs to organization …`,
`corrective_action.incident_id …`,
`corrective_action.monitoring_reading_id …`) and the CHECK violations
(`hms_incident_category_check`, `hms_incident_severity_check`,
`hms_incident_status_check`, `corrective_action_status_check`) all raise
`23514`). 0042 on 2026-09-21 added the two checklist tables and 0043 the two
guards, then 0043's down dropped the two guard triggers and their functions with
no table change (74 → 74 tables) and 0042's down dropped `checklist_run` then
`checklist_template` (74 → 72 tables), and deleting their ledger rows and
re-applying restored the tables, their checks, FKs and indexes and both guards —
74 tables, with a further `db:migrate` run a no-op; the rehearsal also observed
the three guard messages (`checklist_run.template_id …`,
`checklist_run.location_id …`, `checklist_template.supersedes_id …`) and the
CHECK violations (`checklist_template_category_check`,
`checklist_template_frequency_check`, `checklist_template_items_array_check`,
`checklist_template_supersedes_self_check`, `checklist_run_status_check`,
`checklist_run_results_array_check`) all raise `23514`, and a second revision
superseding the first through the nullable `supersedes_id` was accepted). 0044 on
2026-09-21 added the two equipment tables and 0045 the three guards, then 0045's
down dropped the three guard triggers and their functions with no table change
(76 → 76 tables) and 0044's down dropped `maintenance_log` then `equipment`
(76 → 74 tables), and deleting their ledger rows and re-applying restored the
tables, their checks, uniques, FKs and indexes and the three guards — 76 tables,
with a further `db:migrate` run a no-op; the rehearsal
also observed duplicate `(organization_id, code)` raising `23505` on
`equipment_organization_id_code_key`, the `maintenance_log_kind_check` and the
non-empty `equipment_code_nonempty_check` / `equipment_name_nonempty_check` all
raising `23514`, the three guard messages (`equipment.location_id …`,
`maintenance_log.equipment_id …`, `maintenance_log.file_object_id …`) raising
`23514`, and a NULL `file_object_id` accepted (the guard skips it). 0046 on
2026-09-22 added the two workforce personnel tables and 0047 the four guards,
then 0047's down dropped the four guard triggers and their functions with no
table change (78 → 78 tables) and 0046's down dropped `employee_document` then
`employee` (78 → 76 tables), and deleting their ledger rows and re-applying
restored the tables, their checks, FKs and indexes and the four guards — 78
tables, with a further `db:migrate` run a no-op (the ledger holds 48 rows); the
rehearsal also observed the
four CHECK violations (`employee_employment_type_check`,
`employee_base_hourly_rate_check`, `employee_active_range_check`,
`employee_document_kind_check`) and the four guard messages
(`employee.primary_location_id …`, `employee.user_id …`,
`employee_document.employee_id …`, `employee_document.file_object_id …`) all
raising `23514`, a NULL `primary_location_id` and a NULL `file_object_id`
accepted (the guards skip them) and nullable `issued_at`/`expires_at` accepted.
0048 on 2026-09-22 added the three `DEC-088` staff document library tables
(`document`, `document_version`, `document_acknowledgement`) with their checks,
uniques, FKs and indexes and 0049 the three guards, taking the database to 81
tables (the ledger holds 50 rows); the document integration suite observed the
five CHECK violations (`document_category_check`, `document_audience_check`,
`document_status_check`, `document_version_version_no_check`,
`document_version_published_check`), the `document_version_document_version_key`
and `document_acknowledgement_version_user_key` uniques raising `23505`, the
`document_version_document_id_…` FK raising `23503`, the three guard messages
(`document_version.document_id …`, `document_version.file_object_id …`,
`document_acknowledgement.document_version_id …`) raising `23514`, and a NULL
`file_object_id` accepted (the guard skips it). The 0048/0049 down/re-apply
rehearsal was run on 2026-09-22: starting from 81 public base tables, 3 guard
triggers present and 50 ledger rows, `0049_staff_documents_org_guard_down.sql`
dropped the three guard triggers and their functions with no table change (81
tables, 0 guards) and `0048_staff_documents_down.sql` dropped the three staff
document library tables (78 tables, 0 guards); deleting the two ledger rows
(`created_at IN (1790054700573, 1790054714766)`) deleted 2 rows, and
`npm run db:migrate` re-applied 0048/0049 — final 81 public base tables, 3
guard triggers present, 50 ledger rows, with a further `npm run db:migrate` a
no-op. 0050 on 2026-09-22 added the two `DEC-094` workflow platform tables
(`task`, `approval`), taking the database to 83 tables (the ledger holds 51
rows). 0051 on 2026-09-22 added the two `DEC-037`/`DEC-038` shift-scheduling
tables (`shift`, `shift_assignment`) and 0052 the three guards, taking the
database to 85 tables (the ledger holds 53 rows); the scheduling integration
suite observed the five CHECK violations (`shift_state_check`,
`shift_time_range_check`, `shift_break_minutes_check`,
`shift_actual_range_check`, `shift_assignment_state_check`), the
`shift_assignment_shift_employee_key` unique raising `23505`, and the three guard
messages (`shift.location_id …`, `shift_assignment.shift_id …`,
`shift_assignment.employee_id …`) raising `23514`, with a partial actual-time
pair (one side null) accepted (the check skips a null side). The 0051/0052
down/re-apply rehearsal was run on 2026-09-22: starting from 85 public base
tables, 3 guard triggers present and 53 ledger rows,
`0052_shift_scheduling_org_guard_down.sql` dropped the three guard triggers and
their functions with no table change (85 tables, 0 guards) and
`0051_shift_scheduling_down.sql` dropped the two shift-scheduling tables (83
tables, 0 guards); deleting the two ledger rows
(`created_at IN (1790063480942, 1790063500924)`) deleted 2 rows, and
`npm run db:migrate` re-applied 0051/0052 — final 85 public base tables, 3 guard
triggers present, 53 ledger rows, with a further `npm run db:migrate` a no-op.
0053 on 2026-09-22 added the `DEC-038` (`WF-004`) worked-hours correction table
(`shift_adjustment`) and 0054 its cross-organization guard, taking the database to
86 tables (the ledger holds 55 rows); the worked-hours integration suite observed
the two CHECK violations (`shift_adjustment_adjusted_hours_check` on a negative
`adjusted_hours`, `shift_adjustment_approved_check` on a half-set approval pair),
the `shift_adjustment` org-coherence guard message
(`shift_adjustment.shift_assignment_id … belongs to organization …`) raising
`23514`, both a fully-set and a fully-null `approved_by`/`approved_at` pair
accepted, and the latest-adjustment resolution picking the newest correction
(and null when none). The 0053/0054 down/re-apply rehearsal was run on
2026-09-22: starting from 86 public base tables, 1 worked-hours guard trigger
present and 55 ledger rows, `0054_shift_adjustment_org_guard_down.sql` dropped the
guard trigger and its function with no table change (86 tables, 0 guards) and
`0053_shift_adjustment_down.sql` dropped the `shift_adjustment` table (85 tables,
0 guards); deleting the two ledger rows
(`created_at IN (1790067016722, 1790067030453)`) deleted 2 rows, and
`npm run db:migrate` re-applied 0053/0054 — final 86 public base tables, 1 guard
trigger present, 55 ledger rows, with a further `npm run db:migrate` a no-op.
0055 on 2026-09-22 added the `DEC-037` (`WF-005`) monthly payroll-input report
(`payroll_report`) and 0056 its cross-organization guard, taking the database to
87 tables (the ledger holds 57 rows); the payroll integration suite observed the
partial unique `payroll_report_org_period_key` (`WHERE status <> 'superseded'`)
allowing a superseded report and its replacement to coexist while a second live
report for the same `(organization_id, period_start)` is rejected with `23505`,
the `payroll_report_export_file_org_guard` message
(`payroll_report.export_file_id … belongs to organization …`) raising `23514`
and a null `export_file_id` accepted (the guard skips it), and the
`payroll_report_status_check`/`payroll_report_period_check` CHECK violations
(`23514`). The 0055/0056 down/re-apply rehearsal was run on 2026-09-22: starting
from 87 public base tables, 1 payroll-report guard trigger present and 57 ledger
rows, `0056_payroll_report_org_guard_down.sql` dropped the guard trigger and its
function with no table change (87 tables, 0 guards) and
`0055_payroll_report_down.sql` dropped the `payroll_report` table (86 tables,
0 guards); deleting the two ledger rows
(`created_at IN (1790069367957, 1790069368959)`) deleted 2 rows, and
`npm run db:migrate` re-applied 0055/0056 — final 87 public base tables, 1 guard
trigger present, 57 ledger rows, with a further `npm run db:migrate` a no-op.
0057 on 2026-09-22 added the `REC-003`/`REC-006`/`DEC-027` (row 13a) close/lock
table (`period_close`) and 0058 its scope-coherence and locked-snapshot guards,
taking the database to 88 tables (the ledger holds 59 rows); the close
integration suite observed the `period_close_granularity_check` rejecting a
location range spanning two days (`23514`), the `period_close_scope_org_guard`
rejecting a `scope_id` that is not a location in the row's own organization
(`23514`), the `period_close_locked_immutability` rejecting a snapshot change to
a locked row, and the `period_close_locked_delete_guard` blocking the delete of a
locked row. The 0057/0058 down/re-apply rehearsal was run on 2026-09-22: starting
from 88 public base tables, 3 `period_close` guard triggers present and 59 ledger
rows, `0058_period_close_org_guard_down.sql` dropped the three guard triggers and
their functions with no table change (88 tables, 0 triggers) and
`0057_period_close_down.sql` dropped the `period_close` table (87 tables, 0
triggers); deleting the two ledger rows
(`created_at IN (1790110579392, 1790110580000)`) deleted 2 rows, and
`npm run db:migrate` re-applied 0057/0058 — final 88 public base tables, 3 guard
triggers present, 59 ledger rows, with a further `npm run db:migrate` a no-op.
After the adversarial review, `0058`'s locked-row immutability was hardened to
also cover tenancy (`organization_id`) and the lock actor
(`locked_by`/`locked_at`), and the 0058/0057 down/re-apply rehearsal was re-run on
2026-09-22 with the same counts (88 tables, 3 triggers, 59 ledger rows; a further
`db:migrate` a no-op); the `0058` sha256 above is the amended file.
0059 on 2026-09-22 added the `REC-006`/`DEC-027` (row 13b) adjustment-period table
(`adjustment_period`), taking the database to 89 tables (the ledger holds 60
rows); the probe observed the partial unique `adjustment_period_open_key`
rejecting a second `open` row for one organization with `23505` while a `closed`
row coexists, and the three CHECK violations
(`adjustment_period_range_check` on an inverted window,
`adjustment_period_approved_check` on a half-set approval pair and
`adjustment_period_status_check` on an out-of-vocabulary status) all raising
`23514`. The 0059 down/re-apply rehearsal was run on 2026-09-22: starting from 89
public base tables and 60 ledger rows, `0059_adjustment_period_down.sql` dropped
the table (88 tables) with its checks, partial unique, FK and two indexes;
deleting the ledger row (`created_at = 1790113826232`) deleted 1 row, and
`npm run db:migrate` re-applied 0059 — final 89 public base tables, 60 ledger
rows, with a further `npm run db:migrate` a no-op. The `0059` sha256 above is
`51cd81f25b2551e1705028b9f04d242ee71f9387769db0328a6620bee632f1cf`.
A **full 0011 down** drops the tables the three 0012 constraints live on, so its
replay must clear **both** ledger rows, not just 0011's:
`DELETE FROM drizzle.__drizzle_migrations WHERE created_at IN (1789862475550, 1789862630158);`
then `npm run db:migrate` re-applies 0011 (the four tables) followed by 0012 (the
three exclusion constraints). Verified on the local dev database 2026-09-20:
after the down the four tables are gone, and after the replay the database has
all 58 tables with `cost_pool_no_overlap`, `labor_rate_no_overlap` and
`allocation_rule_no_overlap` present (the count is 58 once `0020`'s four
slice-9 tables, `0021`'s four slice-10 tables and `0022`'s three slice-11
import-framework tables exist; it was 47 before `0020`, 51 before `0021` and
55 before `0022`).
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
  `production_batch` source.
  **Extended in `0023_row12_sales_settlements_reconciliation.sql`:** it now also
  validates the `sales_line` source; `adjustment`, `revaluation` and
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
  - **(g)** ~~No **yield-variance tolerance or exception store**
    (`PROD-003`); `yield_variance_pct` is stored as a fact with no check and no
    exception rows.~~ **Closed by `DEC-080` (migration `0030`) for the table and
    `DEC-084` for the producer:** the `data_quality_exception` store now exists
    (see its entry below) and `completeProductionBatch` records a
    `yield_variance` exception **unconditionally** whenever the yield variance is
    non-zero. The variance is still stored as a fact; the FIN **tolerance
    threshold** remains an open point (the unconditional recording is
    provisional pending those thresholds).
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
  - **(f)** ~~There is no exception table for transfer discrepancies
    (`data_quality_exception` is deferred); `discrepancy_note` is the only
    recorded difference today.~~ **Closed by `DEC-080` (migration `0030`):** the
    `data_quality_exception` table now exists (see its entry below), and
    `receiveStockTransfer` records a `transfer_discrepancy` exception alongside
    the human `discrepancy_note`.
- **Slice-11 import-framework open (owner/TECH) points — recorded, do not
  resolve silently** (also in the `packages/persistence/src/schema/sales.ts`
  comment block; append each resolution to `12_OPEN_DECISIONS.md`):
  - **(a)** ~~There is **no import/mapping profile table**. `import_run.source`
    and `import_run.profile_version` are opaque text labels; the profiles are
    static configuration in this slice, not rows. No profile DDL is authored.~~
    **Closed by `DEC-081` (2026-09-21, migration `0031`):** the
    `import_profile` table now exists, keyed `(organization_id, source)`
    (`import_profile_org_source_key`), and the nullable
    `import_run.import_profile_id` FK links a run to the profile it used.
  - **(b)** **`file_object` does not exist yet**, so `import_run.file_object_id`
    is a plain `uuid` with no FK. The platform slice that models `file_object`
    closes it later.
  - **(c)** The **posting step is still a later application slice**. Row 12
    (2026-09-20) created `sales_transaction`/`sales_line`/`settlement`/
    `reconciliation`, but no pipeline writes them yet, so
    `import_staging_row.linked_sales_line_id` **stays a plain `uuid` with no FK**
    (the deferred FK belongs to the posting slice that writes it) and
    `IMPORT_POSTING_POLICY` (`vocabularies.ts`) still backs no check.
  - **(d)** ~~**Tolerance configuration (A3) has no table.**~~
    **Closed by `DEC-072` (2026-09-20, migration `0024`):** the effective-dated
    FIN-owned config is now the `reconciliation_tolerance` table keyed
    `(organization_id, kind)` with a non-overlapping `[effective_from,
    effective_to)` window (`reconciliation_tolerance_no_overlap`);
    `reconciliation.tolerance` stays the per-row snapshot of what was applied.
    Resolving the effective config and the "missing tolerance blocks close" rule
    remain application concerns owned by the reconciliation slice, not schema
    enforcement. The applied value remains `max(rate × |expected|,
    floor_amount)` (`DEC-072`).
  - **(e)** ~~**`MAPPING_STATE` has no `conflict` value** — conflicts are `error`
    + `error_code = mapping_conflict`.~~ **Closed by `DEC-074` (2026-09-20,
    migration `0025`):** `MAPPING_STATE` (`vocabularies.ts` +
    `schemas/domain-enums.yaml`) now has five values
    (`unmapped`/`mapped`/`ignored`/`error`/`conflict`), enforced by the recreated
    `import_staging_row_mapping_state_check` and
    `sales_line_mapping_state_check`; `error` stays for other mapping errors and
    `error_code` remains detail.
- **Slice-12 sales/settlement/reconciliation open (owner/TECH) points —
  recorded, do not resolve silently** (also in the
  `packages/persistence/src/schema/sales.ts` comment block; append each
  resolution to `12_OPEN_DECISIONS.md`):
  - **(d)** ~~No tolerance-configuration table (A3); `reconciliation.tolerance`
    is a per-row snapshot (see the slice-11 point above).~~ **Closed by
    `DEC-072` (2026-09-20, migration `0024`)**: the `reconciliation_tolerance`
    table now holds the effective-dated config and `reconciliation.tolerance`
    stays the per-row snapshot (see the slice-11 point above).
  - **(e)** **`settlement.source_file_id` is a plain `uuid`** (`file_object` is
    absent — the same open point as `import_run.file_object_id`).
  - **(f)** **Close/lock/period tables are row 13** (`period_close`,
    `adjustment_period`, `daily_close`); none exist here.
  - **(g)** **Sales-line reversal semantics (`DEC-028`) are only partially
    implemented.** The `0026` `sales_line_reversal_of_id_key` partial unique index
    now enforces **at most one reversal per line** (`DEC-073`) at the database, so
    two concurrent reversals cannot both post; the remaining `DEC-028` pairing
    rules (the exact-negation check and the per-source semantics) are still
    application-only, and `sales_line.reversal_of_id` records only the
    self-reference.
  - **(h)** **`tax_code_id` vs `tax_rule_id` naming and the `applied_tax_rate`
    authority (A4) are unresolved.** The draft (`:655`) says `tax_code_id`;
    `DATA_DICTIONARY.md:709` and the row-12 work say `tax_rule_id`. The column is
    `tax_rule_id` here (matching `channel_fee_rule.tax_rule_id`); the naming and
    authority question is left open.
  - **(i)** ~~No **`settlement_status` vocabulary** exists in
    `schemas/domain-enums.yaml`, so `settlement.status` is unconstrained
    text.~~ **Closed by `DEC-078` (a) (2026-09-20, migration `0028`):**
    `schemas/domain-enums.yaml` (`settlement_status`) and `vocabularies.ts`
    (`SETTLEMENT_STATUS`) now define `{received, paid, void}`; `settlement.status`
    defaults to `received` and is enforced by `settlement_status_check`.
  - **(j)** ~~**`reconciliation.scope_type` values are unresolved** — the shared
    `scope_type` vocabulary describes cost/ownership scopes, while
    `REC-001`/`005` reconcile source-vs-posted totals by source kind
    (`DEC-026`); the column is unconstrained text rather than an invented
    check.~~ **Closed by `DEC-078` (b) (2026-09-20, migration `0028`):**
    `reconciliation.scope_type` is enforced by `reconciliation_scope_type_check`
    against the distinct `reconciliation_scope_type` vocabulary
    (`import_run`/`sales_source`/`settlement`/`supplier_invoice`), leaving the
    cost/ownership `scope_type` untouched.
  - **(k)** `RECONCILIATION_STATUS` (`pending`/`within_tolerance`/`exception`/
    `resolved`/`approved`) and `OPTION_KIND` (`standalone`/`attached`/
    `included`) are now exported from `vocabularies.ts` and enforced by
    `reconciliation_status_check` / `sales_line_option_kind_check`.
  - **(l)** The `sales_line` guard branch **invalidates a pre-existing
    application test**: `packages/application/src/inventory/inventory.postgres.test.ts`
    (~line 170) posts a `sale_consumption` movement with `sourceType:
    'sales_line'` and a random `sourceId`, relying on the old no-op, so it now
    fails with the guard's `23503`. Fixing it belongs to the row-12 application
    slice (out of the persistence work's file ownership): either seed a real
    `sales_line`/`sales_transaction` pair or move that assertion to a
    still-unimplemented source type (`adjustment`).

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

## The `pgboss` schema (owned by the pre-deploy migrator, not the drizzle journal)

The `pgboss` schema — the pg-boss runner's own tables — is deliberately **not**
a drizzle migration: it has no `_journal.json` entry and no numbered migration
file. It is owned by the **pre-deploy migrator** instead.
`packages/persistence/scripts/migrate.mjs` runs `drizzle-kit migrate` first and
then still holds the advisory lock `8675309` while it provisions/migrates
`pgboss` from the pinned pg-boss package's own derived plans:

- a fresh schema (no `pgboss.version` row) is constructed from
  `getConstructionPlans(schema, { createSchema: true })`;
- otherwise the installed version is read from `pgboss.version` and
  `getMigrationPlans(schema, current)` is applied;
- a downgrade is refused; the expected `schemaVersion` is **42** for pg-boss
  **`12.33.2`**;
- every failure is fail-closed and logs host-side only.

The runtime role is intentionally limited: the `app` role gets **DML only** on
the `pgboss` objects, and `infra/bootstrap/pgboss-grants.sql` carries the
grants (run as `doadmin`; see `docs/runbooks/deployment.md` for the
before-first-deploy and post-migrate timing).

**Down path:** `DROP SCHEMA pgboss CASCADE`. It cannot reach `public.job` or
`public.outbox_event`: every pg-boss DDL statement is schema-qualified
(verified) and neither public table is referenced by any pg-boss object, so the
outbox facts stay in `outbox_event`. Rehearsal evidence (scratch database,
2026-09-26): the schema was created, then `DROP SCHEMA pgboss CASCADE` removed
it with `public.job`/`public.outbox_event` and the 98-public-table count
untouched; it was never rehearsed on the dev database.

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
| 0022 | `0022_row11_import_framework.sql` | Generated: the three slice-11 import-framework tables — `import_run`, `import_staging_row`, `external_mapping` — with their status (`import_run_status_check`), mapping-state (`import_staging_row_mapping_state_check`), period and effective-range checks, the uniques (`import_run_file_hash_key`, `import_staging_row_run_row_no_key`, `external_mapping_key`), the FKs (both org tables; the staging→run `ON DELETE cascade`) and the `import_run_org_source_idx` / `import_run_org_status_idx` indexes. No hand-written invariants: row 11 posts no stock movement, so `stock_movement_source_guard` is untouched (the `sales_line` guard branch belongs to row 12). Down companion: `0022_row11_import_framework_down.sql` (transactional `DROP TABLE IF EXISTS` in FK-safe order — destructive) |
| 0023 | `0023_row12_sales_settlements_reconciliation.sql` | Generated + hand-written: the four slice-12 tables — `sales_transaction`, `sales_line`, `settlement`, `reconciliation` — with their checks (`sales_line_option_kind_check`, `sales_line_mapping_state_check`, `sales_line_applied_tax_rate_check`, `sales_line_option_parent_check`, `settlement_period_check`, `reconciliation_status_check`, `reconciliation_period_check`), the uniques (`sales_transaction_external_key`, `sales_line_transaction_line_key`), the FKs (both org tables; `sales_line`→transaction/variant/channel/tax_rule and its two self-FKs; `sales_transaction`→location/channel/`import_run`; `settlement`→channel) and the `sales_transaction_org_occurred_idx` / `sales_line_transaction_idx` / `sales_line_sku_idx` / `settlement_org_provider_period_idx` / `reconciliation_org_status_idx` / `reconciliation_org_scope_idx` indexes. Hand-written: `CREATE OR REPLACE FUNCTION stock_movement_source_guard` adding the `sales_line` branch. Down companion: `0023_row12_sales_settlements_reconciliation_down.sql` (restores the `0021` guard, drops the four tables in FK-safe order — destructive) |
| 0024 | `0024_reconciliation_tolerance.sql` | Generated + hand-written: the `DEC-072` `reconciliation_tolerance` table (`organization_id`, `kind`, `rate numeric(9,6)`, `floor_amount numeric(19,4)`, `effective_from`/`effective_to` `date`, audit columns, the `reconciliation_tolerance_kind_check` / `_rate_check` / `_floor_check` / `_effective_range_check` constraints, the org FK and `reconciliation_tolerance_org_kind_idx`). Hand-written: the `reconciliation_tolerance_no_overlap` EXCLUDE constraint (`(organization_id, kind)`, `daterange(effective_from, effective_to, '[)')` `WITH &&`). Down companion: `0024_reconciliation_tolerance_down.sql` (drops the constraint then the table — destructive) |
| 0025 | `0025_mapping_state_conflict.sql` | Generated: drops and recreates `import_staging_row_mapping_state_check` and `sales_line_mapping_state_check` with the five-value `MAPPING_STATE` including `conflict` (`DEC-074`). No table. Down companion: `0025_mapping_state_conflict_down.sql` (restores the four-value checks; re-add validates existing rows) |
| 0026 | `0026_sales_line_reversal_unique.sql` | Generated: adds `sales_line_reversal_of_id_key`, a partial unique index on `sales_line.reversal_of_id` `WHERE "reversal_of_id" is not null`, so at most one line reverses a given line (`DEC-073`) — the race-safe database backstop for `reverseSalesLine`'s application pre-check. No table. Down companion: `0026_sales_line_reversal_unique_down.sql` (drops the index) |
| 0027 | `0027_price_version.sql` | Generated + hand-written: the `DEC-064`/`DEC-077` `price_version` table (`organization_id`, `product_variant_id`, nullable `location_id`/`channel_id`, `gross_price`/`net_price` numeric(19,4), the `effective_from`/`effective_to` window, `approved_by`/`approved_at`, the required `source_scenario_id` FK, `created_at`, the `price_version_price_check` / `price_version_effective_range_check` constraints, the five FKs and `price_version_scope_idx`). Hand-written: the `price_version_no_overlap` EXCLUDE constraint on the scope columns and `tstzrange(effective_from, effective_to, '[)')`, normalizing a null `location_id`/`channel_id` to a single "any" scope with a COALESCE sentinel. Down companion: `0027_price_version_down.sql` (drops the constraint then the table — destructive) |
| 0028 | `0028_settlement_reconciliation_vocabularies.sql` | Generated: adds the `settlement.status` default `received` and `settlement_status_check` (`DEC-078` (a)) plus `reconciliation_scope_type_check` on `reconciliation.scope_type` (`DEC-078` (b), the distinct `RECONCILIATION_SCOPE_TYPE` vocabulary). No table and no hand-written statement. Down companion: `0028_settlement_reconciliation_vocabularies_down.sql` (drops both checks and the `settlement.status` default — no row is touched) |
| 0029 | `0029_org_coherence_guards.sql` | Hand-written (`DEC-079`, closing `DEC-054`'s open point): the `goods_receipt_line.supplier_item_id` existence FK (`NOT VALID` → `VALIDATE CONSTRAINT`) and three `BEFORE INSERT OR UPDATE FOR EACH ROW` guard triggers — `recipe_allergen_org_guard`, `recipe_line_org_guard` and `goods_receipt_line_org_guard` — that reject a reference whose parent resolves to another organization (and, for a receipt line, a supplier item from another supplier or for a different item). No table and no TypeScript schema change. Down companion: `0029_org_coherence_guards_down.sql` (drops the three triggers, their functions and the FK — no row is touched) |
| 0030 | `0030_data_quality_exception.sql` | Generated (`DEC-080`, `DQ-001`): the `data_quality_exception` table — `organization_id`, the provisional-text `rule_code`, `severity` (`data_quality_exception_severity_check`, default `medium`), the polymorphic `entity_type`/`entity_id`, `detected_at` (default `now()`), the nullable `owner_id`/`due_date`, `status` (`data_quality_exception_status_check`, default `open`), `resolution` and the audit columns, with the organization FK and the `data_quality_exception_org_status_idx` / `data_quality_exception_org_entity_idx` indexes. No hand-written statement. Down companion: `0030_data_quality_exception_down.sql` (drops the table — destructive) |
| 0031 | `0031_import_profile.sql` | Generated (`DEC-081`): the `import_profile` table — `organization_id`, `source`, `profile_version`, `posting_policy` (`import_profile_posting_policy_check`, default `allow_partial`), `validation_rules` jsonb (`import_profile_validation_rules_check` requiring a jsonb object, default `'{}'`) and the audit columns, with the `import_profile_org_source_key` unique on `(organization_id, source)` and the organization FK — plus the nullable `import_run.import_profile_id` column with its `import_run_import_profile_id_import_profile_id_fk` FK → `import_profile(id)`. No hand-written statement. Down companion: `0031_import_profile_down.sql` (drops `import_run.import_profile_id` first, then the table — destructive) |
| 0032 | `0032_import_run_profile_org_guard.sql` | Hand-written (`DEC-079`'s guard shape applied to `DEC-081`'s `import_run.import_profile_id` FK): the `import_run_profile_org_guard` `BEFORE INSERT OR UPDATE FOR EACH ROW` trigger on `import_run` (one function) that rejects a non-null `import_profile_id` whose `import_profile` belongs to another organization than the run. No table and no TypeScript schema change. Down companion: `0032_import_run_profile_org_guard_down.sql` (drops the trigger and its function — no row is touched) |
| 0033 | `0033_import_disposition.sql` | Generated + hand-appended (`DEC-083`): the `import_disposition` table — `import_staging_row_id` (FK → `import_staging_row(id)` `ON DELETE cascade`, required), `disposition` (`import_disposition_disposition_check`, in `unmapped`/`rejected`/`ignored`), the nullable `reason`, the required `actor_id` (a plain uuid; the `app_user` FK is deferred), `created_at` (the approval instant) and the `created_by`/`updated_at`/`updated_by`/`version` audit columns — with the `import_disposition_staging_row_key` unique on `(import_staging_row_id)` and **no `organization_id`** (scoped through `import_staging_row` → `import_run`, the `import_staging_row` precedent). Hand-appended: the backfill `INSERT … SELECT` from `import_run.diagnostics.dispositions` keeping the latest record per staging row (`DISTINCT ON (stagingRowId) … ORDER BY at DESC NULLS LAST`) and skipping malformed/out-of-vocabulary/orphaned records; the jsonb keys are retained frozen. Down companion: `0033_import_disposition_down.sql` (rebuilds each run's `diagnostics.dispositions` from the table, then drops it — lossless) |
| 0034 | `0034_import_disposition_contract.sql` | Hand-written, **data-only** (`DEC-083` contract step): one `UPDATE "import_run" SET "diagnostics" = "diagnostics" - 'dispositions' WHERE "diagnostics" ? 'dispositions'` drops the retained-frozen jsonb key from every run that still carries it, leaving the other `diagnostics` keys (`posting_policy`/`issues`/`conflicts`/`totals`) untouched. No table, index, constraint or TypeScript schema change. Down companion: `0034_import_disposition_contract_down.sql` (rebuilds each run's `diagnostics.dispositions` from `import_disposition` ordered by `import_staging_row.source_row_no` — value-identical but not order-identical, restores nothing for a run with no table dispositions and drops nothing; **not journalled**, applied manually) |
| 0035 | `0035_file_object.sql` | Generated + hand-edited (`ADR-0006`/`DEC-085`): the `file_object` platform table — `organization_id`, `storage_key`, `filename`, `mime`, `size_bytes` bigint (`file_object_size_bytes_check`, `>= 0`), `checksum_sha256`, the provisional free-text `retention_policy`, the nullable `uploaded_by` and the `uploaded_at` default `now()`, the polymorphic `linked_entity_type`/`linked_entity_id` (a plain uuid, no FK) and the audit columns — with the `file_object_org_storage_key_key` unique on `(organization_id, storage_key)` and the organization FK. Hand-edited: the nullable `import_run.file_object_id` FK in the deferred form (`ADD CONSTRAINT "import_run_file_object_id_file_object_id_fk" … NOT VALID` then `VALIDATE CONSTRAINT`) because `import_run` may already hold links while `file_object` starts empty (the `0029`/`0031` pattern). Down companion: `0035_file_object_down.sql` (drops the `import_run.file_object_id` FK first, then the table — destructive) |
| 0036 | `0036_file_object_org_guard.sql` | Hand-written (`DEC-079`'s guard shape applied to `DEC-085`'s `import_run.file_object_id` FK, mirroring `0032`): the `file_object_org_guard` `BEFORE INSERT OR UPDATE FOR EACH ROW` trigger on `import_run` (one function) that rejects a non-null `file_object_id` whose `file_object` belongs to another organization than the run. No table and no TypeScript schema change. Down companion: `0036_file_object_org_guard_down.sql` (drops the trigger and its function — no row is touched) |
| 0037 | `0037_hms_monitoring.sql` | Generated (`DEC-089`/`HMS-002`): the two HMS monitoring tables — `monitoring_point` (`organization_id`, `location_id`, the nullable `storage_area_id`, `code`, `name`, `kind` (`monitoring_point_kind_check`), `unit`, `target_min`/`target_max` numeric(19,6) (`monitoring_point_target_range_check`, `target_min <= target_max`), `check_frequency` (`monitoring_point_check_frequency_check`), `active` default `true` and the audit columns, with the `monitoring_point_organization_id_code_key` unique on `(organization_id, code)` and the organization/location/storage-area FKs) and `monitoring_reading` (`organization_id`, `monitoring_point_id`, `value` numeric(19,6), `unit`, `measured_at`, the nullable `recorded_by`, `in_range`, the nullable `notes` and the audit columns, with the organization and point FKs and the `monitoring_reading_org_point_measured_idx` index on `(organization_id, monitoring_point_id, measured_at)`). No hand-written statement. Down companion: `0037_hms_monitoring_down.sql` (drops the index, then `monitoring_reading`, then `monitoring_point`, FK-safe order — destructive) |
| 0038 | `0038_hms_monitoring_append_only.sql` | Hand-written (`DEC-089`/`HMS-002`): the `monitoring_reading` append-only guard — one function (`monitoring_reading_append_only()`) and three triggers: two `BEFORE FOR EACH ROW` triggers (`monitoring_reading_immutable` on UPDATE, `monitoring_reading_no_delete` on DELETE) and one `BEFORE TRUNCATE FOR EACH STATEMENT` trigger (`monitoring_reading_no_truncate`) that reject a DELETE, a TRUNCATE and an UPDATE of `value`/`unit`/`measured_at`/`monitoring_point_id`/`organization_id`, so only `notes` may be amended. No table and no TypeScript schema change. Down companion: `0038_hms_monitoring_append_only_down.sql` (drops the three triggers and their function — no row is touched) |
| 0039 | `0039_hms_monitoring_org_guard.sql` | Hand-written (`DEC-079`'s guard shape applied to `DEC-089`'s HMS monitoring FKs, mirroring `0036`): two functions and two `BEFORE INSERT OR UPDATE FOR EACH ROW` triggers — `monitoring_point_org_guard` on `monitoring_point` (rejects a `location_id` or a non-null `storage_area_id` whose `location`/`storage_area` belongs to another organization) and `monitoring_reading_org_guard` on `monitoring_reading` (rejects a `monitoring_point_id` whose `monitoring_point` belongs to another organization). No table and no TypeScript schema change. Down companion: `0039_hms_monitoring_org_guard_down.sql` (drops the two triggers and their functions — no row is touched) |
| 0051 | `0051_shift_scheduling.sql` | Generated (`DEC-037`/`DEC-038`, `WF-002`/`WF-003`): the two shift-scheduling tables, additive like `0037`/`0040`/`0042`/`0044` — `shift` (`organization_id`, the NOT NULL `location_id`, the nullable free-text `role_code` (null = any role), `starts_at`/`ends_at`, `break_minutes` default `0`, `state` default `open`, the nullable `published_at` and the reserved `actual_start`/`actual_end`, the audit columns, the organization/location FKs, the `shift_state_check` / `shift_time_range_check` / `shift_break_minutes_check` / `shift_actual_range_check` checks and the `shift_org_location_starts_idx` / `shift_org_state_idx` org-first indexes) and `shift_assignment` (`organization_id`, the NOT NULL `shift_id`/`employee_id`, `state`, the nullable plain-uuid `assigned_by`, `assigned_at`, the audit columns, the organization/shift/employee FKs, the `shift_assignment_state_check` check, the `shift_assignment_shift_employee_key` unique on `(shift_id, employee_id)` and the `shift_assignment_org_shift_idx` / `shift_assignment_org_employee_idx` org-first indexes). The spec's `created_by`/`created_at` are the `auditColumns()` ones (no duplicate business column). Worked hours (`shift_adjustment`) follow in `0053`; `payroll_report` remains the next slice. No hand-written statement. Journal `when` `1790063480942`, sha256 `157cadb1d6be16d6ccdee59ee1d2fbfdff205e212881367c6b6b00bed69d5e36`. Down companion: `0051_shift_scheduling_down.sql` (drops `shift_assignment` then `shift` — destructive) |
| 0052 | `0052_shift_scheduling_org_guard.sql` | Hand-written (`DEC-079`'s guard shape applied to the `DEC-037`/`DEC-038` shift-scheduling FKs, mirroring `0049`): three functions and three `BEFORE INSERT OR UPDATE FOR EACH ROW` triggers — `shift_location_org_guard` on `shift` (rejects a `location_id` whose `location` belongs to another organization), `shift_assignment_shift_org_guard` on `shift_assignment` (rejects a `shift_id` whose `shift` belongs to another organization) and `shift_assignment_employee_org_guard` on `shift_assignment` (rejects an `employee_id` whose `employee` belongs to another organization). All three columns are NOT NULL, so the guards are unconditional. No table and no TypeScript schema change. Journal `when` `1790063500924`, sha256 `f168c524b62e78f2c41a59eb1f044e7a0d2d81cec9a6abf847533f8c6c2bf5bd`. Down companion: `0052_shift_scheduling_org_guard_down.sql` (drops the three triggers and their functions — no row is touched) |
| 0053 | `0053_shift_adjustment.sql` | Generated (`DEC-038`, `WF-004`): the `shift_adjustment` worked-hours correction table, additive like `0037`/`0040`/`0042`/`0044`/`0046`/`0048`/`0050`/`0051` — `organization_id`, the NOT NULL `shift_assignment_id` FK, the `adjusted_hours` numeric(9,2) with the `shift_adjustment_adjusted_hours_check` (`>= 0`), the required `reason`, the nullable plain-uuid `approved_by` and nullable `approved_at` with the all-or-nothing `shift_adjustment_approved_check` (`(approved_by is null and approved_at is null) or (approved_by is not null and approved_at is not null)`), the audit columns, the organization FK and the `shift_adjustment_org_assignment_idx` org-first index. The spec's `created_at` is the `auditColumns()` one (no duplicate business column). A correction is an append-only fact: worked hours are derived from the shift and the latest correction wins at read time (`DEC-038`, `DATA_DICTIONARY` §4A). No hand-written statement. Journal `when` `1790067016722`, sha256 `cc589075fe649e35d2eb1fd57129b2b339dacce22dc7ac2e8daee7a7afe0c5e3`. Down companion: `0053_shift_adjustment_down.sql` (drops the table — destructive) |
| 0054 | `0054_shift_adjustment_org_guard.sql` | Hand-written (`DEC-079`'s guard shape applied to the `DEC-038` `shift_adjustment.shift_assignment_id` FK, mirroring `0052`): one function and one `BEFORE INSERT OR UPDATE FOR EACH ROW` trigger — `shift_adjustment_shift_assignment_org_guard` on `shift_adjustment` (rejects a `shift_assignment_id` whose `shift_assignment` belongs to another organization). The column is NOT NULL, so the guard is unconditional (no null-reference skip). No table and no TypeScript schema change. Journal `when` `1790067030453`, sha256 `202aeaad413ae3dbf6be2e24dd28d56363dd0203b62163492e54b0d86a3f0585`. Down companion: `0054_shift_adjustment_org_guard_down.sql` (drops the trigger and its function — no row is touched) |
| 0040 | `0040_hms_incidents.sql` | Generated (HMS incidents): the two tables, additive like `0037` — `hms_incident` (`hms_incident_category_check` / `hms_incident_severity_check` / `hms_incident_status_check` vocabulary checks, the organization/location FKs and org-first indexes) and `corrective_action` (`corrective_action_status_check` and the FKs to `organization`, `location`, `hms_incident` and `monitoring_reading`). No hand-written statement. Down companion: `0040_hms_incidents_down.sql` (drops the two tables, FK-safe order — destructive) |
| 0041 | `0041_hms_incidents_org_guard.sql` | Hand-written (`DEC-079`'s guard shape applied to the HMS incidents FKs, mirroring `0039`): two functions and two `BEFORE INSERT OR UPDATE FOR EACH ROW` triggers — `hms_incident_org_guard` on `hms_incident` (rejects a `location_id` whose `location` belongs to another organization) and `corrective_action_org_guard` on `corrective_action` (rejects an `incident_id` or a `monitoring_reading_id` whose `hms_incident`/`monitoring_reading` belongs to another organization). No table and no TypeScript schema change. Down companion: `0041_hms_incidents_org_guard_down.sql` (drops the two triggers and their functions — no row is touched) |
| 0042 | `0042_checklists.sql` | Generated: the two checklist tables, additive like `0037`/`0040` — `checklist_template` (the nullable `supersedes_id` self-FK, the `checklist_template_category_check` / `checklist_template_frequency_check` vocabulary checks, the `checklist_template_items_array_check` jsonb-array check and the `checklist_template_supersedes_self_check` no-self-supersede check) and `checklist_run` (the FKs to `checklist_template` and `location`, the `checklist_run_status_check` vocabulary and `checklist_run_results_array_check` jsonb-array checks, and org-first indexes). No hand-written statement. Down companion: `0042_checklists_down.sql` (drops the two tables, FK-safe order: `checklist_run` then `checklist_template` — destructive) |
| 0043 | `0043_checklists_org_guard.sql` | Hand-written (`DEC-079`'s guard shape applied to the checklist FKs, mirroring `0041`): two functions and two `BEFORE INSERT OR UPDATE FOR EACH ROW` triggers — `checklist_template_org_guard` on `checklist_template` (rejects a `supersedes_id` whose template belongs to another organization) and `checklist_run_org_guard` on `checklist_run` (rejects a `template_id` or `location_id` whose `checklist_template`/`location` belongs to another organization). No table and no TypeScript schema change. Down companion: `0043_checklists_org_guard_down.sql` (drops the two triggers and their functions — no row is touched) |
| 0044 | `0044_equipment.sql` | Generated: the two equipment tables, additive like `0037`/`0040`/`0042` — `equipment` (the FKs to `organization` and `location`, the `equipment_organization_id_code_key` unique on `(organization_id, code)`, the `equipment_code_nonempty_check` / `equipment_name_nonempty_check` non-empty checks and the `equipment_org_location_idx` / `equipment_org_active_idx` org-first indexes) and `maintenance_log` (the FKs to `organization`, `equipment` and the nullable `file_object`, the `maintenance_log_kind_check` vocabulary check and the `maintenance_log_org_equipment_performed_idx` / `maintenance_log_org_kind_idx` org-first indexes). No hand-written statement. Down companion: `0044_equipment_down.sql` (drops the two tables, FK-safe order: `maintenance_log` then `equipment` — destructive) |
| 0045 | `0045_equipment_org_guard.sql` | Hand-written (`DEC-079`'s guard shape applied to the equipment/maintenance FKs, mirroring `0043`): three functions and three `BEFORE INSERT OR UPDATE FOR EACH ROW` triggers — `equipment_location_org_guard` on `equipment` (rejects a `location_id` whose `location` belongs to another organization), `maintenance_log_equipment_org_guard` on `maintenance_log` (rejects an `equipment_id` whose `equipment` belongs to another organization) and `maintenance_log_file_object_org_guard` on `maintenance_log` (rejects a non-null `file_object_id` whose `file_object` belongs to another organization). No table and no TypeScript schema change. Down companion: `0045_equipment_org_guard_down.sql` (drops the three triggers and their functions — no row is touched) |
| 0046 | `0046_workforce.sql` | Generated (`DEC-087`, `WF-007`/`DOC-001`…`DOC-004`): the two workforce personnel tables, additive like `0037`/`0040`/`0042`/`0044` — `employee` (the FKs to `organization`, `app_user` and the nullable `location`, the `employee_employment_type_check` vocabulary check, the `employee_base_hourly_rate_check` (`base_hourly_rate >= 0`) and the `employee_active_range_check` (`active_to is null or active_to > active_from`) checks and the `employee_org_active_idx` / `employee_org_primary_location_idx` org-first indexes) and `employee_document` (the FKs to `organization`, `employee` and the nullable `file_object`, the `employee_document_kind_check` vocabulary check and the `employee_document_org_employee_idx` / `employee_document_org_kind_idx` / `employee_document_org_expires_idx` org-first indexes). No hand-written statement. Down companion: `0046_workforce_down.sql` (drops the two tables, FK-safe order: `employee_document` then `employee` — destructive) |
| 0047 | `0047_workforce_org_guard.sql` | Hand-written (`DEC-079`'s guard shape applied to the workforce FKs, mirroring `0045`): four functions and four `BEFORE INSERT OR UPDATE FOR EACH ROW` triggers — `employee_primary_location_org_guard` on `employee` (rejects a non-null `primary_location_id` whose `location` belongs to another organization), `employee_user_org_guard` on `employee` (rejects a non-null `user_id` whose `app_user` belongs to another organization), `employee_document_employee_org_guard` on `employee_document` (rejects an `employee_id` whose `employee` belongs to another organization) and `employee_document_file_object_org_guard` on `employee_document` (rejects a non-null `file_object_id` whose `file_object` belongs to another organization). No table and no TypeScript schema change. Down companion: `0047_workforce_org_guard_down.sql` (drops the four triggers and their functions — no row is touched) |
| 0048 | `0048_staff_documents.sql` | Generated (`DEC-088`, `DOC-001`…`DOC-004`): the three staff document library tables, additive like `0037`/`0040`/`0042`/`0044`/`0046` — `document` (`organization_id`, `title`, `category` (`document_category_check`), `audience` (`document_audience_check`), `status` (`document_status_check`, default `draft`), the plain-uuid `owner_id` and the audit columns, with the organization FK and the `document_org_status_idx` / `document_org_audience_idx` org-first indexes), `document_version` (`organization_id`, `document_id`, `version_no` (`document_version_version_no_check`, `> 0`), the nullable `file_object_id`, the nullable `notes`/`published_at`/`published_by` with the all-or-nothing `document_version_published_check`, the audit columns, the FKs to organization/document/file-object, the `document_version_document_version_key` unique on `(document_id, version_no)` and the `document_version_org_document_idx` index) and `document_acknowledgement` (`organization_id`, `document_version_id`, `acknowledged_by`, `acknowledged_at` with **no** audit columns — the `import_disposition` fact-table precedent — the FKs to organization/document-version, the `document_acknowledgement_version_user_key` unique on `(document_version_id, acknowledged_by)` and the `document_acknowledgement_org_version_idx` / `_org_user_idx` indexes). No hand-written statement. Journal `when` `1790054700573`, sha256 `a3583018395213ae882880c3bbb773fc74fa8a70c6b80aa36ca54a4b3fe091e5`. Down companion: `0048_staff_documents_down.sql` (drops the three tables, FK-safe order: `document_acknowledgement` then `document_version` then `document` — destructive) |
| 0049 | `0049_staff_documents_org_guard.sql` | Hand-written (`DEC-079`'s guard shape applied to the `DEC-088` staff-document FKs, mirroring `0047`): three functions and three `BEFORE INSERT OR UPDATE FOR EACH ROW` triggers — `document_version_document_org_guard` on `document_version` (rejects a `document_id` whose `document` belongs to another organization), `document_version_file_object_org_guard` on `document_version` (rejects a non-null `file_object_id` whose `file_object` belongs to another organization) and `document_acknowledgement_document_version_org_guard` on `document_acknowledgement` (rejects a `document_version_id` whose `document_version` belongs to another organization). No table and no TypeScript schema change. Journal `when` `1790054714766`, sha256 `91dd4a2c63e0f3201f9c4626ee80b644358bc75d92353ecb8510d6bc323408da`. Down companion: `0049_staff_documents_org_guard_down.sql` (drops the three triggers and their functions — no row is touched) |
| 0050 | `0050_workflow_platform.sql` | Generated (`DEC-094`, schema-only workflow platform): the two tables, additive like `0037`/`0040`/`0042`/`0044`/`0046`/`0048` — `task` (`organization_id`, the free-text `type`, the nullable polymorphic `linked_entity_type`/`linked_entity_id` pair, the plain-uuid `owner_id`, the nullable `due_date`, the free-text `priority`, `status` defaulting to `open`, the nullable `resolution` and plain-uuid `created_from_event_id`, the audit columns, the organization FK, the `task_status_check` / `task_linked_entity_check` checks and the `task_org_status_idx` / `task_org_owner_due_idx` / `task_org_linked_idx` org-first indexes) and `approval` (`organization_id`, the polymorphic `entity_type`/`entity_id`, the nullable `entity_version`, the required `requested_by`/`requested_at`, the nullable `decided_by`/`decided_at`/`decision`/`comment`, the audit columns, the organization FK, the `approval_decision_check` / `approval_decided_check` checks and the `approval_org_entity_idx` / `approval_org_decision_idx` indexes). The `job` table, the worker/scheduler and the outbox layer are deliberately not built (`ADR-0004` gated). No hand-written statement and no companion org-guard migration (only the `organization_id` FK). Journal `when` `1790061475649`, sha256 `19438c2f5ead0664a2ed74b19395d833555e999826b8c6787b6ed88aa44ebdc9`. Down companion: `0050_workflow_platform_down.sql` (drops `approval` then `task` — destructive) |
| 0055 | `0055_payroll_report.sql` | Generated (`DEC-037`, `WF-005`): the monthly payroll-**input** report table, additive like `0037`/`0040`/`0042`/`0044`/`0046`/`0048`/`0050`/`0051`/`0053` — `organization_id`, `period_start`/`period_end` `date`, `generated_at` `timestamptz` default `now()`, the nullable plain-uuid `generated_by` (the `app_user` FK is deferred), `status` default `draft`, the `snapshot` jsonb default `'{}'::jsonb` (the frozen, reproducible lines), the nullable `export_file_id` **real** FK → `file_object(id)` (`DEC-085`; the storage bytes/signed-URL export stays deferred) and the audit columns, with the organization FK, the `payroll_report_status_check` (`PAYROLL_REPORT_STATUS`) and `payroll_report_period_check` (`period_end > period_start`) checks, the **partial** unique index `payroll_report_org_period_key` on `(organization_id, period_start)` `WHERE status <> 'superseded'` (the `DEC-104` provisional supersede key — a plain unique would keep the superseded row occupying the key and make "supersede then insert" impossible), and the `payroll_report_org_status_idx` / `payroll_report_org_period_idx` org-first indexes. The report is generated on demand; the "~3 days before month-end" trigger is `ADR-0004`-gated and not built. The `export_file_id` FK is emitted inline by drizzle-kit (a new empty table, so the `NOT VALID` → `VALIDATE CONSTRAINT` dance is unnecessary). No hand-written statement. Journal `when` `1790069367957`, sha256 `18b9789e64c5fb462828402036ec0a9d87c9090d43034a71fd1de9932c7ae87d`. Down companion: `0055_payroll_report_down.sql` (drops the table — destructive) |
| 0056 | `0056_payroll_report_org_guard.sql` | Hand-written (`DEC-079`'s guard shape applied to the `DEC-037`/`DEC-085` `payroll_report.export_file_id` FK, mirroring `0045`): one function and one `BEFORE INSERT OR UPDATE FOR EACH ROW` trigger — `payroll_report_export_file_org_guard` on `payroll_report` (rejects a non-null `export_file_id` whose `file_object` belongs to another organization, and skips a null reference). No table and no TypeScript schema change. Journal `when` `1790069368959`, sha256 `4aa9675bcd8156f4882aade667c9dc3ecab3e4f69e5ac2ded508c0dccff63631`. Down companion: `0056_payroll_report_org_guard_down.sql` (drops the trigger and its function — no row is touched) |
| 0057 | `0057_period_close.sql` | Generated (`REC-003`/`REC-006`, `DEC-027`): the row-13a close/lock table, additive like `0037`/`0040`/`0042`/`0044`/`0046`/`0048`/`0050`/`0051`/`0053`/`0055` — `organization_id`, the `scope_type` (`location`/`company`) and NOT NULL plain-uuid `scope_id` (the `location.id` for a location scope, the `organization.id` for a company scope — no FK because the target varies), `period_start`/`period_end` `date`, `status` default `open`, the `checklist` jsonb default `'[]'::jsonb`, the nullable `snapshot` jsonb, the nullable `correction_policy`, the nullable plain-uuid `locked_by`/`reopened_by` with their `timestamptz` instants and the nullable `reopen_reason` (the `app_user` FK is deferred), and the audit columns, with the organization FK, the `period_close_status_check` (`PERIOD_CLOSE_STATUS`) and `period_close_scope_type_check` (`PERIOD_CLOSE_SCOPE_TYPE`) checks, the `period_close_period_range_check` (`period_end >= period_start`), the `period_close_granularity_check` (location ⇒ a single day; company ⇒ the UTC calendar month first→last day, via immutable `date_trunc('month', date)`), the all-or-nothing `period_close_locked_check` and the `period_close_reopened_check` (the reopen triple required when `status='reopened'`), the `period_close_org_scope_period_key` unique on `(organization_id, scope_type, scope_id, period_start)` and the `period_close_org_scope_idx` / `period_close_org_status_idx` org-first indexes. `adjustment_period` and `daily_close` are deferred to 13b (`DEC-105`). No hand-written statement. Journal `when` `1790110579392`, sha256 `b2cbad1af69cbfca470cd31dd7d84e2ed9154cc4c170666fa2bb3d11e90f3e31`. Down companion: `0057_period_close_down.sql` (drops the table — destructive) |
| 0058 | `0058_period_close_org_guard.sql` | Hand-written (`DEC-079`'s guard shape applied to the row-13a `period_close`, mirroring `0045`/`0052`/`0056`, plus two immutability guards): three functions and three `BEFORE` triggers — `period_close_scope_org_guard` on INSERT/UPDATE (a `location` scope's `scope_id` must be a `location` row in the row's own organization; checks existence **and** organization because `scope_id` has no FK, and skips when the scope columns are unchanged on UPDATE), `period_close_locked_immutability` on UPDATE (a `locked` row's `snapshot`, period, scope, tenancy and lock actor are immutable and its status may only stay `locked` or move to `reopened`) and `period_close_locked_delete_guard` on DELETE (a `locked` row cannot be deleted). All raise `23514`. No table and no TypeScript schema change. Journal `when` `1790110580000`, sha256 `63bcd67b11649d84e4c97342e6b859baec6b95e97d20719bdc967756267d10b3`. Down companion: `0058_period_close_org_guard_down.sql` (drops the three triggers and their functions — no row is touched) |
| 0060 | `0060_cost_card_resolvers.sql` | Generated (`DEC-112`, cost-card component resolvers): adds the nullable `recipe_version.labor_cost_center_id` FK → `cost_center(id)` and nullable `recipe_version.labor_role_code` (the per-version direct-labour mapping), with the `recipe_version_labor_role_code_check` (`ROLE_CODE`) and the all-or-nothing `recipe_version_labor_mapping_check` (`("labor_cost_center_id" is null) = ("labor_role_code" is null)`) checks and the `recipe_version_labor_idx` index on `(labor_cost_center_id, labor_role_code)`; and the nullable `operating_cost.cost_pool_id` FK → `cost_pool(id)` with the `operating_cost_pool_idx` org-first index on `(organization_id, cost_pool_id, effective_from)`. No new table. `ADD COLUMN` (nullable, no default) is metadata-only in PostgreSQL 11+; the two new FKs and the two indexes are plain validating/building objects, so on a populated `recipe_version`/`operating_cost` table they take a `ShareLock`/write lock for the scan and are the only locks to schedule. Journal `when` `1790155213588`, sha256 `7b71980a537df100a93e4a91993ff1f668ec4cc17c5eabef17a44525aee3d4cf`. Down companion: `0060_cost_card_resolvers_down.sql` (drops the two indexes, the two checks, the two FKs and the three columns — destructive). **No preflight is needed and the omission from the preflight list above is deliberate, not accidental:** the three new columns are nullable and start NULL on every existing row, so the two FK validations scan for `NULL` references only and cannot fail — the scan is trivial regardless of table size. |
| 0061 | `0061_cost_card_resolvers_org_guard.sql` | Hand-written (`DEC-079`'s guard shape applied to the `DEC-112` cost-card component-resolver FKs, mirroring `0052`): two functions and two `BEFORE INSERT OR UPDATE FOR EACH ROW` triggers — `recipe_version_labor_cost_center_org_guard` on `recipe_version` (rejects a non-null `labor_cost_center_id` whose `cost_center` belongs to a different organization than the version's owning `recipe`, read via `recipe_version.recipe_id`; skips a null reference and skips when either the `recipe` or the `cost_center` row is missing, leaving existence to the FK) and `operating_cost_cost_pool_org_guard` on `operating_cost` (rejects a non-null `cost_pool_id` whose `cost_pool` belongs to a different organization than the operating cost's own `organization_id`; skips a null reference and skips when the `cost_pool` row is missing). Both raise `23514` and are **forward-only** (they validate new writes, never existing rows). No table and no TypeScript schema change. Journal `when` `1790155218588`, sha256 `9b750adacaed631dec78c4f5fe99ace377680f8d58b35c73112c5d847908787b`. Down companion: `0061_cost_card_resolvers_org_guard_down.sql` (drops the two triggers and their functions — no row is touched) |
| 0062 | `0062_channel_fee_rule_lookup_index.sql` | Generated (`DEC-112`, cost-card component resolvers): adds `channel_fee_rule_lookup_idx` on `(organization_id, channel_id, effective_from)`, covering the resolver's and `registerChannelFeeRule`'s by-channel as-of lookup (every other effective-dated lookup table — `labor_rate`, `operating_cost`, `allocation_rule`, `price_version` — is already indexed). No table and no row. The non-concurrent, journaled index build takes a write lock on `channel_fee_rule` for the duration of the build but cannot fail on existing data; it adds no validating constraint, so no preflight is needed. Journal `when` `1790158068670`, sha256 `b5b918340c149eeda4b9125db13c3ae3e3a3998b5098b70ee1e1212549754ce9`. Down companion: `0062_channel_fee_rule_lookup_index_down.sql` (drops the index — no row is touched) |
| 0063 | `0063_recipe_test.sql` | Generated (`DEC-123`, recipe trials): the append-only `recipe_test` table — `organization_id` (FK → `organization`), the NOT NULL `recipe_version_id` (FK → `recipe_version`, `NO ACTION`, never cascade — a trial is a fact) and the nullable `resulting_recipe_version_id` (the same FK, set when a later version is registered from the proposal), the NOT NULL `tested_at` and `batch_input_qty` numeric(19,6), the nullable observed outputs `actual_output_qty` numeric(19,6), `actual_duration_minutes` integer, `actual_cost` numeric(19,4) and `currency` char(3), the nullable narrative `quality_comments`/`proposed_adjustment`, the NOT NULL plain-uuid `actor_id` (the `app_user` FK is deferred) and `created_at` default `now()` — **no** `updated_at`/`updated_by`/`version` (a fact table, like `document_acknowledgement`/`import_disposition`) — with the `recipe_test_batch_input_qty_check` (`> 0`), `recipe_test_actual_output_qty_check` (`is null or > 0`), `recipe_test_actual_duration_minutes_check` (`is null or >= 0`) and `recipe_test_actual_cost_check` (`is null or >= 0`) checks and the `recipe_test_version_tested_idx` on `(recipe_version_id, tested_at)` / `recipe_test_org_tested_idx` on `(organization_id, tested_at)` indexes; plus the additive nullable `recipe_version.method` text column (no backfill). `ADD COLUMN` (nullable, no default) is metadata-only in PostgreSQL 11+, and the new table starts empty so its checks, FKs and indexes are cheap at first apply; no preflight is needed. Journal `when` `1790215453377`, sha256 `cf473380f3aac813f2463abe8182ba46adf5731ff63bf72d5b31f1c79949e117`. Down companion: `0063_recipe_test_down.sql` (drops `recipe_test` then `recipe_version.method` — destructive) |
| 0064 | `0064_production_batch_actual_labour_hours.sql` | Generated (`DEC-124`, production actual labour): adds the additive nullable `production_batch.actual_labour_hours` numeric(9,2) column (the hours convention, `shift_adjustment.adjusted_hours`) with the `production_batch_actual_labour_hours_check` (`is null or >= 0`). No new table. `ADD COLUMN` (nullable, no default) is metadata-only in PostgreSQL 11+ and the CHECK validates nothing existing (the column starts NULL on every row), so no preflight is needed. No backfill. Journal `when` `1790215472124`, sha256 `087a4e70375fc91621274b8858b4201a9cf8bbf7ac869d9767ad9d947bf59359`. Down companion: `0064_production_batch_actual_labour_hours_down.sql` (drops the column — destructive) |
| 0065 | `0065_production_plan_lines.sql` | Generated (`DEC-125`, production plan lines and a batch quantity): the `production_plan_line` table — `organization_id` (FK → `organization`), the NOT NULL `plan_id` (FK → `production_plan` with **ON DELETE cascade** — a line belongs to its plan) and `recipe_version_id` (FK → `recipe_version`, `NO ACTION`), the NOT NULL `planned_qty` numeric(19,6) with the `production_plan_line_planned_qty_check` (`> 0`), and `created_at` default `now()` — indexed by `production_plan_line_plan_idx` on `(plan_id)`; plus the additive nullable `production_batch.planned_qty` numeric(19,6) with the `production_batch_planned_qty_check` (`is null or > 0`). `ADD COLUMN` (nullable, no default) is metadata-only in PostgreSQL 11+; the new table starts empty, and the CHECK validates nothing existing (the column starts NULL on every row), so no preflight is needed. No backfill — existing plans keep zero lines and existing batches keep a null `planned_qty` (both read as the previous single-batch behaviour). Journal `when` `1790220089185`, sha256 `3dabf8aa61b23de2ba98117288c297a65cf3fef3c377ad2ea81edcd6303c496e`. Down companion: `0065_production_plan_lines_down.sql` (drops the column then the table — destructive) |
| 0066 | `0066_competitor_observations.sql` | Generated (`DEC-126`, `COMP-001…COMP-004`, Phase 4 intelligence): two new tables. `competitor` — `organization_id` (FK → `organization`), the NOT NULL `name`, the nullable `notes` and `created_at` default `now()`, with the `competitor_organization_id_name_key` unique on `(organization_id, name)` (so `registerCompetitor` is idempotent on that key). `competitor_observation` — `organization_id` (FK → `organization`), the NOT NULL `competitor_id` (FK → `competitor`, `NO ACTION`), the NOT NULL `observed_at` timestamptz and free-text `source`, the nullable `source_url`, the nullable `item_id` (FK → `item`, the comparable we sell), the NOT NULL `external_name` (the competitor's own name for it), the nullable `price` numeric(19,4) and `currency` char(3) (**no default, no `NOT NULL`** — stated or absent, never assumed), `offer_notes`, `review_status` default `pending`, the nullable plain-uuid `reviewed_by` (the `app_user` FK is deferred) and timestamptz `reviewed_at`, and `created_at` default `now()`, with the `competitor_observation_review_status_check` (`COMPETITOR_REVIEW_STATUS`: `pending`/`reviewed`/`rejected`), `competitor_observation_price_check` (`is null or >= 0`) and the `competitor_observation_review_gate_check` (a non-`pending` status carries both `reviewed_by` and `reviewed_at` — the `DEC-020` human-review gate) checks and the `competitor_observation_org_observed_idx` `(organization_id, observed_at)` / `competitor_observation_competitor_observed_idx` `(competitor_id, observed_at)` indexes. Both tables start empty and carry no backfill, so their checks, FKs and indexes are cheap at first apply; no preflight is needed. Journal `when` `1790222131987`, sha256 `2fbdcfb885e41dc22caee116e8ac39ef4f5660b40646b669a722d0b4bf9f3826`. Down companion: `0066_competitor_observations_down.sql` (drops `competitor_observation` then `competitor` — destructive) |
| 0067 | `0067_rate_limit_counter.sql` | Generated (`DEC-135`, shared rate-limit store): the `rate_limit_counter` platform table — `namespace` and `key` text (the limiter's stable name and the caller key it already uses), `hits` `timestamptz[]` default `'{}'::timestamptz[]` (the hit instants still inside the sliding window), `updated_at` timestamptz default `now()`, the `id` uuid surrogate PK and the `rate_limit_counter_namespace_key_key` unique on `(namespace, key)` (the target of the atomic `INSERT … ON CONFLICT … DO UPDATE … WHERE … RETURNING` in `repositories/rate-limit.ts`). **No `organization_id`** — the key is the caller address, not a business fact — and the table is **not** append-only (a hit array is disposable throttling state, aged out by the window; `updated_at` supports a future sweep, none is built). It starts empty and adds no FK, so its unique and default are cheap at first apply and no preflight is needed. Journal `when` `1790324986583`, sha256 `7da8d5c57022dcf09c61c679d4433673bf6dfd42949a996cd83b9a89c1497696`. Down companion: `0067_rate_limit_counter_down.sql` (drops the table — destructive only to throttling state; the next request in each namespace starts a fresh window). The down path was **rehearsed** on a scratch database (created, `0067` applied, down applied, table confirmed gone, scratch dropped), never the dev database, which keeps the live table. |
| 0068 | `0068_goods_receipt_line_applied_tax_rate.sql` | Generated (`DEC-075` pattern applied to receiving; `CALCULATION_CONTRACT` §5): adds the expand-only nullable `goods_receipt_line.applied_tax_rate` numeric(9,6) — the resolved rate (6 dp fraction, the `tax_rule.rate_pct`/`sales_line.applied_tax_rate` scale) that produced the recoverable tax folded into `landed_base_unit_cost`, captured verbatim and never re-derived (`DEC-075`), because the linked rule is effective-dated and mutable — with the `goods_receipt_line_applied_tax_rate_check` (`is null or >= 0`). No new table and no backfill: existing rows keep NULL (they predate the capture, and inventing a rate for them would be worse than admitting the gap), and the application stores NULL on the explicit-`recoverableTax` and exclusive-basis paths (the caller states an amount, not a rate). No channel column is added: the channel is a resolution *input* only, and once the applied rate is stored the figure is re-derivable from the row without mirroring the tax configuration. `ADD COLUMN` (nullable, no default) is metadata-only in PostgreSQL 11+ and the CHECK validates nothing existing (the column starts NULL on every row), so no preflight is needed. Journal `when` `1790329967242`, sha256 `de57857111e0228f667a6c5b42fad84443fd10af8bfd4acff8603ac70f03648f`. Down companion: `0068_goods_receipt_line_applied_tax_rate_down.sql` (drops the column, and its check with it — destructive to the captured provenance only, no money figure changes). The down path was **rehearsed** on a scratch database (created, all migrations applied, column confirmed present, down applied, column confirmed gone, scratch dropped), never the dev database. |
| 0069 | `0069_integration_source.sql` | Generated (`DEC-137`, `ADR-0011` Accepted 2026-09-25 — the INTG-001 integrations registry): the read-only integrations registry table — `id` uuid surrogate PK, `organization_id` FK → `organization` (org-scoped per `DEC-061`), `name` text NOT NULL, `system_type` text NOT NULL with `integration_source_system_type_check` (∈ `pos`/`medusa`/`sanity`/`wolt`/`fiken`/`other`), `direction` text NOT NULL default `read` with `integration_source_direction_check` (∈ `read`/`write`/`read_write`), `allowed_operations` text[] NOT NULL default `'{}'` with `integration_source_allowed_operations_check` (a subset (`<@`) check against `read`/`write_price`/`write_menu_product`/`write_stock`/`write_accounting`), `credentials_owner` text NOT NULL (the name only — the secret lives in the managed secret store, never in the row), `rate_limit_note` text, `terms_status` text NOT NULL default `pending` with `integration_source_terms_status_check` (∈ `pending`/`approved`/`rejected`), `active` boolean NOT NULL default true, the standard audit columns, the `integration_source_organization_id_name_key` UNIQUE on `(organization_id, name)` and the `integration_source_organization_id_idx` org index. The `DEC-015` DB check `integration_source_write_requires_approved_terms_check` forbids any write operation (`write_*`) unless `terms_status='approved'`. It starts empty (the seed registers six read-only sources separately), adds no FK beyond the org FK, so no preflight is needed. Journal `when` `1790367974095`, sha256 `c599f955ee34e321705cf603414e1a1203f0c271afb83f574967dc99264a0caf`. Down companion: `0069_integration_source_down.sql` (drops the table — destructive only to registry configuration; no business, money or stock fact is stored there). The down path was **rehearsed** on a scratch database (created, all migrations applied, `integration_source` confirmed present, down applied, table confirmed absent, scratch dropped), never the dev database. |
| 0070 | `0070_forecast_snapshot_forecast_override.sql` | Generated (`DEC-138`, the owner-authorized forecast-tracking slice): two tables, expand-only like `0069`. `forecast_snapshot` — `id` uuid surrogate PK, `organization_id` FK → `organization` (DEC-061), `metric` text NOT NULL, `grain` text NOT NULL with the `forecast_grain` allow-list check, the nullable scope columns (`location_id`/`channel_id`/`category`/`product_variant`, NULL-able as the grain requires), `as_of` timestamptz NOT NULL, `model` text NOT NULL, `projection` jsonb NOT NULL default `'[]'` with `forecast_snapshot_projection_check` (`jsonb_typeof("projection") = 'array'`), the nullable `accuracy_method`/`accuracy_mape numeric(9,6)`/`accuracy_points` with the non-negative `forecast_snapshot_accuracy_check`, the standard audit columns, the natural `NULLS NOT DISTINCT` unique on `(organization_id, metric, grain, location_id, channel_id, category, product_variant, as_of)` and the org-first `forecast_snapshot_org_metric_grain_asof_idx` on `(organization_id, metric, grain, as_of)`. `forecast_override` — `id` uuid surrogate PK, `organization_id` FK → `organization`, the NOT NULL `grain`/`period`/scope columns (as the snapshot), the nullable `snapshot_id` FK → `forecast_snapshot`, the NOT NULL `reason` text with `forecast_override_reason_check` (`length(btrim(reason)) > 0`), the plain-uuid `actor_id` (the `auditColumns()` deferral, the `monitoring_reading.recorded_by` precedent), the audit columns and the org-first `forecast_override_org_metric_grain_period_idx` on `(organization_id, metric, grain, period)`. Hand-written: the append-only enforcement — `forecast_override_immutable` (BEFORE UPDATE OR DELETE FOR EACH ROW) and `forecast_override_no_truncate` (BEFORE TRUNCATE FOR EACH STATEMENT), both reusing `reject_immutable_change()`. Grain is `day_location`-only in this slice — the declared category/product grains are refused at the application port (`requireSupportedForecastGrain`, the `DEC-011` ceiling). Both tables start empty and carry no backfill, so their checks, FKs and indexes are cheap at first apply; no preflight is needed. Public tables 95 → 97; `ai_analysis_run`/`reorder_policy` stay deferred. Journal `when` `1790370103369`, sha256 `872068e2029c56682b4ae413862fd0771daad817c95c9d5b1286d2f2f5d2317a`. Down companion: `0070_forecast_snapshot_forecast_override_down.sql` (drops the triggers then the two tables — destructive only to forecast snapshots/overrides; no posted money or stock fact). The down path was **rehearsed** on a scratch database (created, all migrations applied, both tables confirmed present, down applied, tables confirmed absent and triggers removed, scratch dropped), never the dev database. |

| 0071 | `0071_job.sql` | Generated (`DEC-139` P2 platform core, following `ADR-0004` Accepted 2026-09-26): the application `job` projection table — `queue`, `kind`, `payload`, `status` with a table-local status allow-list check, `attempts` (a non-negative-attempts check) and `max_attempts`, `scheduled_at`, the nullable `started_at`/`finished_at`/`error`, the `outbox_event_id` read-back link, the audit columns and the `organization_id` FK — with the `(organization_id, status, scheduled_at)` and `(organization_id, outbox_event_id)` indexes. The `job` table is the application-facing projection for the `202` status/progress URL, not the runner queue; the `pgboss` runner schema is deliberately not part of this migration (see the pgboss section below). Starts empty, so its checks, FK and indexes are cheap at first apply; no preflight is needed. Journal tag `0071_job`, `when` `1790449874516`. Down companion: `0071_job_down.sql` (drops only `job` — destructive). The down path was **rehearsed** on a scratch database on 2026-09-26 (`job` present → down applied → `job` absent; scratch dropped), never the dev database. |

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
  re-applies 0000–0050 and the database has all 83 tables plus both extensions
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
FK and replaces the `stock_movement_source_guard` body again — four tables;
0022 adds the three slice-11 import-framework tables — `import_run`,
`import_staging_row`, `external_mapping` — and no hand-written invariant;
0023 adds the four slice-12 sales/settlement/reconciliation tables and replaces
the `stock_movement_source_guard` body to add the `sales_line` branch — four
tables; 0024 adds the `DEC-072` `reconciliation_tolerance` table and its
`reconciliation_tolerance_no_overlap` EXCLUDE constraint — one table; 0025
recreates the two five-value mapping-state checks — no table; 0026 adds the
`sales_line_reversal_of_id_key` partial unique index — no table; 0027 adds the
`DEC-064`/`DEC-077` `price_version` table and its `price_version_no_overlap`
EXCLUDE constraint — one table; 0028 adds the `settlement.status` default and
check and the `reconciliation.scope_type` check — no table; 0029 adds the
`goods_receipt_line.supplier_item_id` existence FK and the three `DEC-079`
org-coherence guard triggers (`recipe_allergen_org_guard`,
`recipe_line_org_guard`, `goods_receipt_line_org_guard`) — no table; 0030 adds
the `DEC-080` `data_quality_exception` table — one table; 0031 adds the
`DEC-081` `import_profile` table and the nullable `import_run.import_profile_id`
FK — one table; 0032 adds the `DEC-081` import-run profile org-coherence guard
trigger on `import_run` — no table; 0033 adds the `DEC-083`
`import_disposition` table and backfills it from the run
`diagnostics.dispositions` jsonb — one table; 0034 removes that retained jsonb
key — no table; 0035 adds the `ADR-0006`/`DEC-085` `file_object` table and the
deferred `import_run.file_object_id` FK — one table; 0036 adds the `DEC-085`
file-object org-coherence guard trigger on `import_run` — no table; 0037 adds the
`DEC-089`/`HMS-002` `monitoring_point` and `monitoring_reading` tables and their
index — two tables; 0038 adds the `DEC-089`/`HMS-002` `monitoring_reading`
append-only guard trigger — no table, table-neutral; 0039 adds the `DEC-089` HMS
monitoring cross-organization coherence guards on `monitoring_point` and
`monitoring_reading` — no table, table-neutral; 0040 adds the two HMS incidents
tables (`hms_incident` and `corrective_action`) with their vocabulary checks,
FKs and org-first indexes — two tables; 0041 adds the two HMS incidents
cross-organization coherence guards on `hms_incident` and `corrective_action`
— no table, table-neutral; 0042 adds the two checklist tables
(`checklist_template` and `checklist_run`) with their vocabulary and
jsonb-array checks, the `supersedes_id` self-FK, the run FKs to
`checklist_template` and `location` and org-first indexes — two tables; 0043
adds the two checklist cross-organization coherence guards on
`checklist_template` and `checklist_run` — no table, table-neutral; 0044 adds the
two equipment tables (`equipment` and `maintenance_log`) with their checks,
uniques, FKs and org-first indexes — two tables; 0045 adds the three equipment
cross-organization coherence guards on `equipment` and `maintenance_log` — no
table, table-neutral; 0046 adds the two workforce personnel tables (`employee`
and `employee_document`) with their checks, FKs and org-first indexes — two
tables; 0047 adds the four workforce cross-organization coherence guards on
`employee` and `employee_document` — no table, table-neutral; 0048 adds the
three `DEC-088` staff document library tables (`document`, `document_version`,
`document_acknowledgement`) with their checks, uniques, FKs and org-first
indexes — three tables; 0049 adds the three staff-document cross-organization
coherence guards on `document_version` and `document_acknowledgement` — no
table, table-neutral; 0050 adds the two `DEC-094` workflow platform tables
(`task` and `approval`) with their checks, FKs and org-first indexes — two
tables).
0013–0019 were added after this replay was verified; all are additive and
table-count-neutral. `0020`, `0021`, `0022`, `0023`, `0024`, `0027`, `0030`,
`0031`, `0033`, `0035`, `0037`, `0040`, `0042`, `0044`, `0046`, `0048`, `0050`,
`0051`, `0053` and `0057` are the only migrations after the replay was written to
add tables (four, four, three, four, one, one, one, one, one, one, two, two, two,
two, two, three, two, two, one and one respectively), so the 83-table figure
above is
the expected post-`0050` count (51
after `0020`, 55 after `0021`, 58 after `0022`, 62 after `0023`, 63 after
`0024`, 64 after `0029`, 65 after `0030`, 66 after `0031` and `0032`, 67 after
`0033`, still 67 after `0034`, 68 after `0035`, still 68 after `0036`, 70 after
`0037`, still 70 after `0038`, still 70 after `0039`, 72 after `0040`, still 72
after `0041`, 74 after `0042`, 76 after `0044`, 78 after `0046`, 81 after
`0048`, 83 after `0050`, 85 after `0051`, 86 after `0053`, 87 after
`0055` and 88 after `0057`);
`0025`, `0026`,
`0028`, `0032`, `0034`, `0036`, `0038`, `0039`, `0041`, `0043`, `0045`,
`0047`, `0049`, `0052`, `0054`, `0056` and `0058` are table-neutral.
`0014`–`0038`'s
apply/re-run/down/re-apply was rehearsed on the local dev database 2026-09-20
(0030 and 0031 on 2026-09-21; 0032 on 2026-09-21; 0033 on 2026-09-21 — its
down restored the two dev dispositions byte-identically and the re-apply
rebuilt the table; 0034 on 2026-09-21 — its forward dropped the retained
`diagnostics.dispositions` key and its down rebuilt it from `import_disposition`
value-identically (not order-identically), with no table change; the re-run was
a no-op; 0035 on 2026-09-21 — its down dropped the `import_run.file_object_id`
FK and the `file_object` table and the re-apply restored both — 68 tables; 0036
on 2026-09-21 — its down dropped the `file_object_org_guard` trigger and its
function with no table change and the re-apply restored the guard — still 68
tables; 0037 on 2026-09-21 — its down dropped the
`monitoring_reading_org_point_measured_idx` index and the two HMS monitoring
tables (68 tables) and the re-apply restored the tables, their checks, uniques
and FKs and the index — 70 tables; 0038 on 2026-09-21 — its down dropped the three
`monitoring_reading` append-only triggers and their function with no table change
and the re-apply restored the guard — still 70 tables; 0040 on 2026-09-21 — its
down dropped the two HMS incidents tables (70 tables) and the re-apply restored
the tables, their checks, FKs and indexes — 72 tables; 0041 on 2026-09-21 — its
down dropped the two guard triggers and their functions with no table change and
the re-apply restored both guards — still 72 tables; 0042 on 2026-09-21 — its
down dropped the two checklist tables, `checklist_run` then
`checklist_template` (74 tables) and the re-apply restored the tables, their
checks, FKs and indexes and both `0043` guards — 74 tables, with a further
`db:migrate` run a no-op; 0043 on 2026-09-21 — its down dropped the two guard
triggers and their functions with no table change and the re-apply restored
both guards — still 74 tables; 0044 on 2026-09-21 — its down dropped
`maintenance_log` then `equipment` (76 → 74 tables) and the re-apply restored
the tables, their checks, uniques, FKs and indexes — 76 tables, with a further
`db:migrate` run a no-op; 0045 on 2026-09-21 — its down dropped the three guard
triggers and their functions with no table change and the re-apply restored all
three guards — still 76 tables; 0046 on 2026-09-22 — its down dropped
`employee_document` then `employee` (78 → 76 tables) and the re-apply restored
the tables, their checks, FKs and indexes — 78 tables, with a further
`db:migrate` run a no-op; 0047 on 2026-09-22 — its down dropped the four guard
triggers and their functions with no table change and the re-apply restored all
four guards — still 78 tables; 0048 on 2026-09-22 added the three `DEC-088`
staff document library tables and 0049 the three guards — 81 tables; the
0048/0049 down/re-apply rehearsal ran 2026-09-22 (downs 81 → 78 tables with 0
guards, the two ledger rows deleted and re-created, final 81 tables, 3 guards,
50 ledger rows, a further `db:migrate` a no-op as recorded above).
0050 on 2026-09-22 added the two `DEC-094` workflow platform tables (`task`,
`approval`) with their checks and org-first indexes — the database went to 83
tables; the 0050 down/re-apply rehearsal ran 2026-09-22: starting from 83 public
base tables and 51 ledger rows, `0050_workflow_platform_down.sql` dropped
`approval` then `task` (83 → 81 tables, both tables absent), deleting its ledger
row (`created_at = 1790061475649`) deleted 1 row (51 → 50), and
`npm run db:migrate` re-applied 0050 — final 83 public base tables, both tables
present and 51 ledger rows, with a further `npm run db:migrate` a no-op.

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
- `stock_movement` (0023): a `source_type = 'sales_line'` movement whose
  `source_id` is not a `sales_line` in the same `organization_id` is rejected by
  `stock_movement_source_guard`; a matching line is accepted.
- `sales_transaction` (0023): a duplicate
  `(source_system, external_transaction_id)` is rejected by
  `sales_transaction_external_key` (replay-safe, `SALE-003`).
- `sales_line` (0023): a duplicate `(sales_transaction_id, external_line_id)` is
  rejected by `sales_line_transaction_line_key`; an `option_kind` outside
  `{standalone, attached, included}` is rejected by
  `sales_line_option_kind_check`; an `attached`/`included` line without a
  `parent_line_id` is rejected by `sales_line_option_parent_check`; a
  `mapping_state` outside the vocabulary is rejected by
  `sales_line_mapping_state_check` (five values since `0025`, below); a negative
  `applied_tax_rate` is rejected by `sales_line_applied_tax_rate_check`.
- `settlement` (0023): a `period_end` before `period_start` is rejected by
  `settlement_period_check`.
- `reconciliation` (0023): a `status` outside `reconciliation_status` is rejected
  by `reconciliation_status_check`; a `period_end` before `period_start` is
  rejected by `reconciliation_period_check`; an `updateReconciliation` from
  another organization matches no row (`DEC-061`).
- `reconciliation_tolerance` (0024, `DEC-072`): an overlapping
  `daterange(effective_from, effective_to)` `[)` window for the same
  `(organization_id, kind)` is rejected by `reconciliation_tolerance_no_overlap`
  (a row closing at `2026-07-01` and one opening the same day is not an overlap);
  the same window on a different `kind` is accepted (the kind is part of the key);
  a `kind` outside `{sales_settlement, supplier_invoice}` is rejected by
  `reconciliation_tolerance_kind_check`, a negative `rate` by
  `reconciliation_tolerance_rate_check` and a negative `floor_amount` by
  `reconciliation_tolerance_floor_check`. `findReconciliationTolerance` resolves
  the half-open `[effective_from, effective_to)` row effective at an as-of date.
- `import_staging_row` / `sales_line` (0025, `DEC-074`): `mapping_state =
  'conflict'` is now accepted by the recreated
  `import_staging_row_mapping_state_check` and `sales_line_mapping_state_check`
  (five values, `unmapped`/`mapped`/`ignored`/`error`/`conflict`); a value
  outside that set is still rejected.
- `sales_line` (0026, `DEC-073`): a second line with the same non-null
  `reversal_of_id` is rejected by `sales_line_reversal_of_id_key`; many lines with
  `reversal_of_id IS NULL` are accepted (the partial index ignores them).
- `price_version` (0027, `DEC-077`): an overlapping
  `tstzrange(effective_from, effective_to, '[)')` window for the same
  `(organization_id, product_variant_id, location_id, channel_id)` scope is
  rejected by `price_version_no_overlap` (a version closing at `2026-07-01` and
  one opening the same day is not an overlap); the **sentinel** makes a null
  `location_id`/`channel_id` one "any" scope, so two overlapping rows that both
  leave the channel (or location) null are also rejected, while a null-channel
  row does not collide with a channel-specific one; a negative `gross_price` or
  `net_price` is rejected by `price_version_price_check`, a backwards/empty
  window by `price_version_effective_range_check`, and a `source_scenario_id`
  that does not name a `price_scenario` by
  `price_version_source_scenario_id_price_scenario_id_fk`.
  `findEffectivePriceVersion` resolves the half-open `[effective_from,
  effective_to)` version effective at an as-of instant (`effective_to` is
  exclusive).
- `settlement` / `reconciliation` (0028, `DEC-078`): a `settlement.status`
  outside `{received, paid, void}` is rejected by `settlement_status_check`, and
  omitting `status` stores the default `received`; a `reconciliation.scope_type`
  outside `{import_run, sales_source, settlement, supplier_invoice}` is rejected
  by `reconciliation_scope_type_check`.
- `recipe_allergen` / `recipe_line` / `goods_receipt_line` (0029, `DEC-079`): a
  `recipe_allergen.allergen_id` in a different organization from the one reached
  via `recipe_version → recipe` is rejected by `recipe_allergen_org_guard`;
  likewise a `recipe_line.item_id` (or `sub_recipe_id`) in a different
  organization from its recipe is rejected by `recipe_line_org_guard`, on both
  INSERT and UPDATE. A `goods_receipt_line.item_id` in a different organization
  from its receipt, or a `supplier_item_id` whose `supplier_item` is in another
  organization, belongs to another supplier or packs a different item, is
  rejected by `goods_receipt_line_org_guard`; a matching supplier item is
  accepted, and a `supplier_item_id` that names no `supplier_item` is rejected by
  `goods_receipt_line_supplier_item_id_supplier_item_id_fk`. The guards are
  forward-only (they do not re-validate rows written before the migration).
- `data_quality_exception` (0030, `DEC-080`): a `severity` outside
  `{low, medium, high, critical}` is rejected by
  `data_quality_exception_severity_check` and a `status` outside
  `{open, acknowledged, resolved, dismissed}` by
  `data_quality_exception_status_check`; omitting them stores the defaults
  `medium`/`open` and `detected_at` defaults to `now()`. A create with the other
  organization's `organization_id` is invisible to the org-scoped `find`/`list`
  (`DEC-061`).
- `import_profile` (0031, `DEC-081`): a duplicate `(organization_id, source)` is
  rejected by `import_profile_org_source_key`; a `posting_policy` outside
  `{all_or_nothing, allow_partial}` is rejected by
  `import_profile_posting_policy_check` (omitting it stores the default
  `allow_partial`), and a `validation_rules` value that is not a jsonb object is
  rejected by `import_profile_validation_rules_check` (omitting it stores
  `'{}'`).
- `import_run` / `import_profile` (0032, `DEC-079`/`DEC-081`): an `import_run`
  linked to an `import_profile` in another organization is rejected by
  `import_run_profile_org_guard`, on both INSERT and UPDATE, while a
  same-organization profile is accepted and a null `import_profile_id` is
  untouched; a profile id that names no `import_profile` is rejected by
  `import_run_import_profile_id_import_profile_id_fk`. The guard is forward-only
  (it does not re-validate rows written before the migration).
- `import_disposition` (0033, `DEC-083`): a `disposition` outside
  `{unmapped, rejected, ignored}` is rejected by
  `import_disposition_disposition_check`; a second disposition for the same
  staging row is rejected by `import_disposition_staging_row_key`; deleting a
  staging row cascades to its dispositions (the FK is `ON DELETE cascade`); a
  create without `actor_id` is rejected (the column is not null, the `app_user`
  FK deferred). After the backfill `select count(*) from import_disposition`
  equals the number of records the forward backfill accepted — the preflight
  skip query returns 0 rows once its hits are reconciled, and each run's
  `diagnostics.dispositions` still holds its records (the jsonb keys stay
  frozen).
- `import_run` (0034, `DEC-083` contract step): after applying, no `import_run`
  row's `diagnostics` has a `dispositions` key — the preflight
  `SELECT count(*) FROM import_run WHERE diagnostics ? 'dispositions'` is 0 —
  while the other `diagnostics` keys (`posting_policy`/`issues`/`conflicts`/
  `totals`) are unchanged. The down path rebuilds `diagnostics.dispositions` from
  `import_disposition` ordered by `source_row_no`, so it is value-identical but
  not order-identical.
- `import_run` / `file_object` (0035, `ADR-0006`/`DEC-085`): after applying, the
  deferred `import_run_file_object_id_file_object_id_fk` is validated, so a
  non-null `import_run.file_object_id` that names no `file_object` is rejected
  (SQLSTATE `23503`); the preflight orphan query returns 0 rows once its hits are
  reconciled.
- `file_object` (0035): a duplicate `(organization_id, storage_key)` is rejected
  by `file_object_org_storage_key_key`, and a negative `size_bytes` by
  `file_object_size_bytes_check`.
- `import_run` / `file_object` (0036, `DEC-079`/`DEC-085`): an `import_run`
  linked to a `file_object` in another organization is rejected by
  `file_object_org_guard` (SQLSTATE `23514`), on both INSERT and UPDATE, while a
  same-organization file is accepted and a null `file_object_id` is untouched; a
  file id that names no `file_object` is rejected by
  `import_run_file_object_id_file_object_id_fk`. The guard is forward-only (it
  does not re-validate rows written before the migration).
- `monitoring_reading` (0037/0038, `DEC-089`/`HMS-002`): an `UPDATE` that changes
  `value`, `unit`, `measured_at`, `monitoring_point_id` or `organization_id` is
  rejected by `monitoring_reading_immutable`, a `DELETE` by
  `monitoring_reading_no_delete` and a `TRUNCATE` by
  `monitoring_reading_no_truncate` (all execute `monitoring_reading_append_only`),
  so a reading fact cannot be edited or wiped, only superseded by a new reading; a
  plain `UPDATE` that changes only `notes` (with the `updated_at`/`updated_by`
  audit columns) is allowed.
- `monitoring_point` (0037): a duplicate `(organization_id, code)` is rejected by
  `monitoring_point_organization_id_code_key`; a `kind` outside
  `{refrigerator, freezer, cooler, hot_holding, other}` is rejected by
  `monitoring_point_kind_check`; a `check_frequency` outside
  `{daily, twice_daily, weekly, monthly, other}` is rejected by
  `monitoring_point_check_frequency_check`; and a `target_min > target_max` is
  rejected by `monitoring_point_target_range_check`.
- `monitoring_point` / `monitoring_reading` (0039, `DEC-079`/`DEC-089`): a
  `monitoring_point` whose `location_id` or `storage_area_id` names a row in
  another organization is rejected by `monitoring_point_org_guard` (SQLSTATE
  `23514`, naming the offending column), and a `monitoring_reading` whose
  `monitoring_point_id` names a point in another organization is rejected by
  `monitoring_reading_org_guard` (SQLSTATE `23514`), on both INSERT and UPDATE,
  while a same-organization reference is accepted and a null `storage_area_id` is
  untouched; a reference that names no row is rejected by the ordinary FK
  (`23503`). Both guards are forward-only (they do not re-validate rows written
  before the migration) and trigger-only/table-neutral.
- Deferrable FKs: a `calculation_snapshot` and its `cost_card` can be inserted
  in the same transaction in either order and commit together.
- `calculation_snapshot`: a plain `TRUNCATE` is blocked first by the FK from
  `cost_card`; only `TRUNCATE ... CASCADE` reaches the statement-level
  `calculation_snapshot_no_truncate` trigger, which rejects it. The table is
  blocked either way.
