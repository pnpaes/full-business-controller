# 2026-09-21 — DEC-083 accepted and implemented (import_disposition table, migration 0033); handoff updated

`main` HEAD `7b86165`; the working tree holds only this handoff update — the
next commit (nothing pushed; nothing applied to DigitalOcean); the tree was
clean at `7b86165` before this docs edit. **7 commits** this slice: `4587564`
docs(decisions) accept `DEC-083`; `dbb7d97` feat(persistence)
`import_disposition` table (migration `0033`) + jsonb backfill; `64a7cfc`
feat(imports) read and write dispositions via the table; `0f8b7b1` docs(web);
`b2dc8ac` docs(runbook); `7b86165` docs(roadmap); plus this context docs update.

- **Delivered (`DEC-083`):** import dispositions moved from
  `import_run.diagnostics.dispositions` jsonb into a first-class
  **`import_disposition`** table — FK → `import_staging_row`
  (`ON DELETE cascade`) + `UNIQUE(import_staging_row_id)` (**one disposition
  per row; a repeat is refused**, where the old jsonb array could accumulate
  duplicates), `disposition` checked `{unmapped, rejected, ignored}`,
  `reason`, required `actor_id` (app_user FK deferred), `created_at` = the
  approval instant, plus the standard audit columns. **No `organization_id`**
  — scoped through `import_staging_row` → `import_run` (`DEC-061` via the
  join), so no `DEC-079`-style guard. Migration `0033` is additive,
  journalled, and backfills the existing jsonb (latest record per staging row
  wins; malformed uuid/vocabulary/orphan records skipped; a malformed `at`
  aborts — the runbook preflight flags both); the jsonb keys are retained
  **frozen** (expand → migrate → contract). The unjournaled down companion
  **rebuilds `diagnostics.dispositions` from the table then drops it** →
  **lossless** (rehearsed); it restores one record per row ordered by
  `source_row_no`, so it is value-identical, not order-identical, to the
  original append order (superseding any pre-migration duplicates).
  Application: `disposeStagingRow` inserts the one disposition (the unique
  key is the guard; a repeat throws a `DomainError` and rolls back), then
  updates the staging row's mapping state, then audits; `getImportRun`,
  `previewImportRun`, `listImportRuns` (one grouped count query, `?? 0` when
  none), `postImportRun`'s `DEC-082` resolution and `reconcileImportRun`'s
  `DEC-035` close gate read the table. The dead jsonb reader
  (`readDispositions` + the `dispositions` diagnostic key) is removed;
  `IMPORT_DISPOSITIONS` derives from the persistence `IMPORT_DISPOSITION`
  constant. The row-11 import-framework point 7 is closed; the remaining
  row-11 point is `file_object` absent (point 6).
- **Reviews and reconciliation.** Two independent passes. `reviewer-qwen` —
  **no blocker/major**; two minors **accepted and applied** (the `0033`
  backfill comment claimed malformed records are "skipped" while a malformed
  `at` aborts — corrected, and the runbook preflight now flags a malformed
  `at`; the down rebuild is value-identical but not order-identical — the
  wording was qualified). `reviewer-minimax` — **no blocker**; **accepted**
  M2 (the frozen jsonb needed a tracked contract step), M3 (document that the
  down restores one record per row and supersedes pre-migration duplicates),
  m2 (the `at` preflight clause) and m6 (record the missing
  `domain-enums.yaml` key); **declined with reasons:** M1 (drop the FK
  cascade / add reject-immutable triggers — the cascade preserves the
  pre-migration lifecycle since the dispositions were embedded in the run
  row, there is no run-delete path, and a posted run is already undeletable
  via `sales_transaction.import_run_id` NO ACTION; a reject-immutable trigger
  set is a new invariant, recorded as an open point), m1 (drop
  `updated_at`/`updated_by`/`version` — the repo-wide `auditColumns()`
  convention; `stock_movement` is append-only and still carries them; same
  recorded open point), m3 (a DB-level org guard on
  `createImportDisposition` — `DEC-083` records the no-`organization_id`
  design by the `import_staging_row` precedent, the application verifies the
  run and staging row org-scoped in the same transaction, persistence
  `create*` functions are conventionally not org-filtered, and a guard needs
  a new migration; recorded as an open point), m4 (retro-editing `DEC-035` —
  `DEC-083` already records the repeat-refusal; accepted decisions are not
  rewritten) and m5 (the audit `after.at` vs `created_at` sub-millisecond
  drift — the codebase-wide convention of app-authored audit instants vs DB
  `now()`). The four recorded open points (contract step;
  immutability/cascade posture; the missing `domain-enums.yaml` key; the
  app-level org guard) are listed under "Open decisions / inputs".
- **Verification at `b2dc8ac` (exact, docs-only commits since):** `typecheck`, `lint`, `build`,
  `format:check` clean; **1366/1366 tests with `DATABASE_URL`** (135 files);
  `npm audit --omit=dev` = 0; `db:migrate` through `0033` is a no-op on
  re-run; **67 tables** (was 66); the `0033` down/re-apply rehearsed
  (lossless); every read/write organization-scoped (`DEC-061`).
- **Resume task:** the `PROD-003` count-variance/yield-variance exception
  producers using the `DEC-080` `data_quality_exception` table (the variance
  tolerance thresholds are a recorded FIN open point — build the producer
  with a recorded provisional threshold or record the variance
  unconditionally, per the `DEC-055` provisional-figures precedent), then
  `file_object` and the tracked `DEC-083` contract step (delete the frozen
  `diagnostics.dispositions` keys) — see "Resume here". A dev server was
  running at http://localhost:3000 (owner/LocalDevPass123, MFA disabled for
  `owner`, demo-seeded including the `zettle-legacy` `import_profile`); a
  fresh session must restart it (session-scoped).

Rollback: each of the slice commits is independently `git revert`-able (revert
the web/application commits before persistence if reverting a cohort);
migration `0033` is additive with a **lossless** unjournaled down path (it
rebuilds `diagnostics.dispositions` from the table, drops the table, deletes
the ledger row); the jsonb keys are retained frozen (the contract step is
tracked); nothing pushed; nothing applied to DigitalOcean.
