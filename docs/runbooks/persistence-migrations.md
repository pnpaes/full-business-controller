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
live only in `0002_invariants.sql`. They are **not** represented in
`drizzle/meta/*_snapshot.json`, so `drizzle-kit generate` cannot see, protect
or recreate them: it does not diff against them, a later generated migration
will never include them, and dropping them manually is invisible to the tool.

> **Never run `drizzle-kit push` against a shared or live database.** `push`
> diffs the live database against the TypeScript schema and, because the raw
> objects are invisible to it, will silently drop the four exclusion
> constraints, the two deferrable FKs and the six append-only triggers. Those
> objects live only in `0002_invariants.sql`; use `generate` + `migrate` and
> the guard below.

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
`cost_card.approved_by`, `audit_event.actor_id`.

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
and verified to restore the prior state without data loss.

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
re-applies 0000–0002 and the database has all 35 tables plus both extensions.

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
- `NULLS NOT DISTINCT`: duplicate `stock_balance` rows with a null `lot_id`, and
  duplicate `user_role` rows with a null `location_id`, are rejected.
- `app_user`: case-insensitive duplicate `email` is rejected
  (`app_user_email_key` on `lower(btrim(email))`); whitespace variants
  (`'alice '` when `'alice'` exists) are also rejected.
- Deferrable FKs: a `calculation_snapshot` and its `cost_card` can be inserted
  in the same transaction in either order and commit together.
- `calculation_snapshot`: a plain `TRUNCATE` is blocked first by the FK from
  `cost_card`; only `TRUNCATE ... CASCADE` reaches the statement-level
  `calculation_snapshot_no_truncate` trigger, which rejects it. The table is
  blocked either way.
