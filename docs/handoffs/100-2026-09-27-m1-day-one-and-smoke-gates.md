# 100 — 2026-09-27 — M1: day-one + smoke regression gates

Status: uncommitted at authoring; branch `main`. No migration.

## What was built.

The M1 milestone from the recorded roadmap: convert the ad-hoc verification the
last sessions did by hand into permanent CI gates.

### (a) Migration chain rehearsal — `packages/persistence/src/migrations.chain.postgres.test.ts`

One test on its own scratch DB (`aquarela_chain_<pid>_<t>`, dropped in
`afterAll`): applies every journaled migration via the repo's real
`migrate.mjs` (pgboss included), asserts the public set equals `EXPECTED_TABLES`
(parsed from `schema.test.ts`, not hardcoded) plus `user_invite` and the
`competitor_observation.content_hash` column; requires a `_down.sql` for every
journaled migration after `0000`–`0002`; then applies every `_down.sql`
newest-first and asserts the schema returns to the 35-table core floor (`0000`–
`0002` are bootstrap-generated and have no down by design) and `pgboss`
survives; finally drops and re-applies to prove up → down → up. **Result: all 76
downs applied in reverse with no non-reversible migration found** (~4–6 s).

### (b) Day-one smoke — `scripts/ci-day-one.mjs` (`npm run ci:day-one`)

On a database: `db:migrate` → `npm run bootstrap -- --organization-name … --owner-email … --owner-username …` with `BOOTSTRAP_OWNER_PASSWORD` (non-interactive,
password ≥ 12) → SQL assertions for the organization, the owner `app_user`, the
`user_role` → `role.code='owner'` link and the public table count. Wired into CI
after `db:migrate`.

### (c) E2E smoke — `scripts/e2e-smoke.mjs` + a new `e2e` CI job

Boots the built `next start`, waits for `/api/health`, boots worker + scheduler
in bounded tick mode with both kill switches off, then drives a real browser:
log in as the bootstrapped owner → read `/jobs` → register one manual
`competitor_source` on `/insights/competitors` → assert it in the UI; cleanup
deletes the row. A failure writes `storage/tmp/e2e-failure.png` and CI uploads it
as an artifact. Playwright is installed **only** in the `e2e` job so `verify`
never downloads a browser; no cloud credentials. **Host trap found:** `next
start` reports the origin as `http://localhost:PORT`, so the same-origin guard
403s a `127.0.0.1` origin — the smoke uses `localhost`.

### (d) Env-drift gate — `packages/config/src/env-surface.test.ts`

Asserts `env.ts` ⇄ `.env.example` agreement, that every literal
`process.env.X` read is documented (raw scheduler/worker/migrator knobs
documented in `.env.example`), that secret-looking keys are value-less, and that
every Terraform `var.X` is declared and every `.tfvars` key is declared. **Found
and fixed 13 undocumented raw variables** (scheduler/worker crons and ticks,
`WORKER_HEARTBEAT_ID`, `PGBOSS_APP_ROLE`, `NEXT_DIST_DIR`, the bootstrap CLI
vars) — added commented, value-less to `.env.example`. Terraform, `.tfvars` and
secrets were clean.

## Verification.

`typecheck`/`lint`/`format:check` clean; the three new gates pass locally
(env-surface 8 tests; chain 1 test ~4.8 s; day-one OK on a throwaway DB, dropped
after); `ci.yml` carries both the M1a `verify` steps and the M1c `e2e` job
(no collision). Full suite at the tip is in the commit.

## Deferred / recorded.

- The E2E smoke uses port 3000 (fixed) and an ad-hoc pinned Playwright
  install; if that npm behaviour changes, add it as a devDependency.
- `verify` deliberately still runs its postgres tests without `DATABASE_URL`
  (skipped); the chain test is a focused step. Enabling the whole postgres suite
  in CI is a later, separate call (runtime vs coverage).
- Pricing/currency caveats from `099` still stand.

## Rollback.

`git revert` the M1 commit — the gates are additive test/CI files; nothing in
the app changes. No schema change, no posted fact touched.
