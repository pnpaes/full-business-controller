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
`0005_unit_conversion_invariants.sql`. This is the **hand-written invariants
convention**: anything drizzle-kit cannot express (extensions, exclusion
constraints, expression/partial indexes, deferrable FKs, triggers,
`NULLS NOT DISTINCT` keys) goes in a `_invariants.sql` file that mirrors
`0002`, and its columns stay plain `uuid`/`text` in the TypeScript schema so
`generate` never fights it. All of these objects are **not** represented in
`drizzle/meta/*_snapshot.json`, so `drizzle-kit generate` cannot see, protect
or recreate them: it does not diff against them, a later generated migration
will never include them, and dropping them manually is invisible to the tool.

> **Never run `drizzle-kit push` against a shared or live database.** `push`
> diffs the live database against the TypeScript schema and, because the raw
> objects are invisible to it, will silently drop the exclusion constraints, the
> two deferrable FKs, the append-only triggers and the `unit_conversion`
> constraints. Those objects live only in `0002_invariants.sql` and
> `0005_unit_conversion_invariants.sql`; use `generate` + `migrate` and the
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
`cost_card.approved_by`, `audit_event.actor_id`, `goods_receipt.purchase_order_id`,
`goods_receipt.accepted_by`, `goods_receipt.evidence_file_id`,
`goods_receipt_line.supplier_item_id`.

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

  **Re-applying after a manual down:** drizzle-kit tracks applied migrations in
  `drizzle.__drizzle_migrations`, not by comparing the schema, so a plain
  `npm run db:migrate` after any down file is a no-op — the migration is still
  recorded. To re-apply one, delete its ledger row and migrate again. The ledger
  row is identified by `created_at` (the `_journal.json` `when`):
  `DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1789847649193;`
  for 0003, `… = 1789850858806` for 0004, `… = 1789851925634` for 0005 and
  `… = 1789853260355` for 0006, then
  `npm run db:migrate` (0003 verified 2026-09-19; 0005 rehearsed in the slice-3
  review follow-up; 0006 rehearsed with the slice-4 receiving work). Re-applying
  is only safe while the removed objects carry no
  data that must be preserved — once real master data, TOTP counters or
  conversions exist, prefer the additive forward path over re-running the down.

## Known follow-up obligations

Tracked here so they are not forgotten; each is owned by the slice that
implements it:

- `stock_movement.source_id` needs a **per-`source_type` validation trigger**
  (the draft's "validated by trigger per slice"); the check constraint today
  only enumerates allowed `source_type` values.
- `snapshot_component.component_kind` needs a **controlled vocabulary**
  (`vocabularies.ts` + check constraint) to be defined in the costing slice.
- `stock_balance` is a **projection** whose only legitimate writer is the
  rebuild process. The database deliberately does not block writes to it
  (a rebuild must write it); the append-only ledger (`stock_movement`) is the
  enforcement point, not a trigger on `stock_balance`.

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
re-applies 0000–0006 and the database has all 41 tables plus both extensions
(0004 adds the four slice-3 master-data tables; 0006 adds the two slice-4
receiving tables).

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
- `app_user`: case-insensitive duplicate `email` is rejected
  (`app_user_email_key` on `lower(btrim(email))`); whitespace variants
  (`'alice '` when `'alice'` exists) are also rejected.
- `user_totp`: a negative `last_used_counter` is rejected by
  `user_totp_last_used_counter_check` (null or `>= 0`).
- Deferrable FKs: a `calculation_snapshot` and its `cost_card` can be inserted
  in the same transaction in either order and commit together.
- `calculation_snapshot`: a plain `TRUNCATE` is blocked first by the FK from
  `cost_card`; only `TRUNCATE ... CASCADE` reaches the statement-level
  `calculation_snapshot_no_truncate` trigger, which rejects it. The table is
  blocked either way.
