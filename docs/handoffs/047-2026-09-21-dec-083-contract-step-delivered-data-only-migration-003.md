# 2026-09-21 — DEC-083 contract step delivered (data-only migration 0034, the frozen jsonb keys removed); handoff updated

`main` HEAD `2d4b98b` (the parent of this docs commit; the tree was clean at
`2d4b98b` before this docs-only edit; nothing pushed; nothing applied to
DigitalOcean); the tree was clean at `3abe72f` (the ADR-0006 gate docs)
before the slice. **4 commits** this
slice: `4326dec` feat(persistence) — migration
`0034_import_disposition_contract` (forward + down + journal + snapshot) +
structural guards; `66b0d51` fix(tooling) — the root `db:generate` wrapper
forwards extra args to drizzle-kit; `2d4b98b` docs(runbook) — document
`0034`; plus this docs(context) update.

- **Delivered (closes the tracked `DEC-083` contract step):** the data-only
  migration `0034` drops the retained-frozen
  `import_run.diagnostics.dispositions` jsonb key from every run that still
  carries it (`UPDATE … SET "diagnostics" = "diagnostics" - 'dispositions'
WHERE "diagnostics" ? 'dispositions';` — the other `diagnostics` keys are
  untouched). The unjournalled down rebuilds the key from
  `import_disposition` (via `import_staging_row`, `jsonb_agg … ORDER BY
source_row_no`; value-identical but not order-identical; drops nothing).
  **No new decision** — it executes accepted `DEC-083`; accepted decisions
  are not rewritten. **No schema change:** migrations through `0034`; still
  67 tables.
- **Tooling fix (`66b0d51`):** the root `db:generate` wrapper swallowed extra
  args, so the runbook's documented `npm run db:generate -- --name=…` never
  named a migration; a trailing `--` now forwards them.
- **Rehearsal evidence (local dev DB):** preflight — 2 runs carried the key
  (both had matching `import_disposition` rows), 67 tables; apply → 0 keys,
  other `diagnostics` keys preserved; no-op re-run (ledger 35 rows, exactly
  one for `0034`); down → both runs' keys rebuilt value-identically; ledger
  reset (`created_at` `1789989056234`) + re-apply → key gone; a rolled-back
  fixture proved the down rebuild field-for-field (13/13: ordered by
  `source_row_no`, NULL reason preserved, ISO-ms UTC `at`, per-record match).
  Final state: `0034` applied, key absent, 67 tables.
- **Reviews and reconciliation.** `reviewer-qwen` — **no blocker/major**;
  **declined with reason** its minors 1/2/4 (the redundant `COALESCE`s and
  the ms-precision `to_char` are inherited verbatim from the proven `0033`
  down so the two paths stay identical); **accepted as-is** minor 3 (the
  substring test guards are light; the rehearsal is the real test); minor 5
  no action (the script fix is correct). `reviewer-glm` — **no findings**.
- **Verification (at HEAD `2d4b98b`, exact):** `typecheck`, `lint`,
  `format:check`, `build` clean; **1375/1375 tests with `DATABASE_URL`** (135
  files); `npm audit --omit=dev` = 0; `db:migrate` through `0034` is a no-op
  on re-run; 67 tables.
- **Next step:** with the contract step done, no TECH-owned unblocked task
  remains — the **owner decision on `ADR-0006`** (then `file_object`) is the
  only remaining blocker; see "Resume here". Next free decision id
  **`DEC-085`**.

Rollback: each of the four commits is independently `git revert`-able
(`4326dec`, `66b0d51`, `2d4b98b` and the context docs update); the `0034`
down rebuilds `diagnostics.dispositions` from `import_disposition`; if the DB
is rolled back past the migration, delete the `0034` ledger row
(`created_at` `1789989056234`) and re-migrate; no schema change (67 tables);
nothing pushed; nothing applied to DigitalOcean.
