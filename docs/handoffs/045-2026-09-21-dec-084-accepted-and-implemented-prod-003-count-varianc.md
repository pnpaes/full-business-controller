# 2026-09-21 — DEC-084 accepted and implemented (PROD-003 count-variance/yield-variance producers, provisional); handoff updated

`main` HEAD `46d6ad7`; the slice is committed as five commits — `accb44c`,
`a819925`, `875b0ba`, `46d6ad7` and this context docs update (nothing pushed;
nothing applied to DigitalOcean); the tree was clean at `1f06d34` before the
slice. **5 commits** in order: `refactor(application)` extract the shared
`data-quality` module (`packages/application/src/data-quality/`: `types.ts`,
`postgres.ts`, `test-support.ts`, `index.ts`) holding the `DEC-080`
`DataQualityExceptionRecord`/`NewDataQualityExceptionRecord` DTOs, the
`DataQualityExceptionStore` port, the postgres mapper/creator and the fake
helper, with `transfers` refactored to consume it (behaviour-preserving;
`TransferStore` extends `DataQualityExceptionStore`); `feat(counts)`
`approveStockCount` records exactly one `count_variance`
`data_quality_exception` (entity `stock_count`) in the same transaction as the
postings when any line variance is non-zero, `exception_id` added to the
approval audit; `feat(production)` `completeProductionBatch` records exactly
one `yield_variance` exception (entity `production_batch`) in the same
transaction when `yield_variance_pct` is non-zero, `exception_id` in the
completion audit, the two `apps/web` production open-point comments corrected
and the runbook slice-10 point (g) closed citing `DEC-080`/`DEC-084`;
`docs(decisions)` accept `DEC-084` (provisional) with `docs/BUILD_ROADMAP.md`
§1/§5 and persistence comments in
`packages/persistence/src/schema/platform.ts` and
`packages/persistence/src/repositories/data-quality-exception.ts`;
`docs(context)` this handoff update.

- **Delivered (`DEC-084`, provisional):** the `PROD-003` variance exceptions
  are recorded **unconditionally** through the `DEC-080`
  `data_quality_exception` repository, in the **same transaction** as the
  fact: `approveStockCount` writes one `count_variance` and
  `completeProductionBatch` one `yield_variance` whenever the variance is
  non-zero. No tolerance threshold is applied because the FIN
  variance-tolerance thresholds remain an open input — so the producers are
  provisional (the `DEC-055` precedent); `severity` is the schema default
  `medium` (provisional); `detected_at` is the fact instant (count approval /
  batch completion); `entity_id` is the count/batch id; one exception per
  document. `DEC-084` is accepted provisional (TECH + FIN).
- **Tests added:** counts unit (a non-zero variance records exactly one
  exception incl. `detected_at` = approval instant + audit `exception_id`; an
  exact count records none); counts postgres (read-back of the persisted row;
  exact-vs-variance in one rolled-back transaction); production unit (non-zero
  yield variance records exactly one exception and the input-line variance
  alone records none; exact output records none; an idempotent replay with a
  non-zero variance does not create a second exception); production postgres
  (non-zero completion records one row; exact completion records none,
  existing test extended).
- **Reviews and reconciliation.** Two independent passes. `reviewer-qwen` —
  **no blocker/major**; **accepted and applied** M2 (add a replay
  non-duplication assertion) and M3 (the runbook cited only `DEC-080` for the
  producer; now `DEC-080`/`DEC-084`); **declined with reason** M1 (the count
  fake's `withTransaction` has no rollback, unlike the production fake — a
  pre-existing fake-fidelity gap, not a regression, no test depends on it, and
  the Postgres `inRollback` integration tests cover the real transaction;
  recorded as a new open point). `reviewer-glm` — **no blocker/major**;
  **accepted and applied** its single minor (a dead `toDataQualityException`
  barrel re-export removed; the function is now module-private).
- **New open point recorded (from qwen M1):** `FakeCountStore.withTransaction`
  runs inline with no snapshot/rollback (unlike `FakeProductionStore`), so a
  fake-store count test cannot assert rollback fidelity; the real transaction
  is covered by the Postgres `inRollback` tests. Not resolved.
- **Verification (working tree, exact):** `typecheck`, `lint`, `format:check`,
  `build` clean; **1373/1373 tests with `DATABASE_URL`** (135 files);
  `npm audit --omit=dev` = 0; no migration touched — `db:migrate` through
  `0033` is a no-op on re-run; **67 tables**; every read/write
  organization-scoped (`DEC-061`).
- **Resume task:** the `file_object` platform table (row-11 import-framework
  point 6), then the tracked `DEC-083` contract step (delete the frozen
  `diagnostics.dispositions` keys) — see "Resume here". A dev server was
  running at http://localhost:3000 (owner/LocalDevPass123, MFA disabled for
  `owner`, demo-seeded including the `zettle-legacy` `import_profile`); a
  fresh session must restart it (session-scoped).

Rollback: each of the five commits is independently `git revert`-able
(`accb44c`, `a819925`, `875b0ba`, `46d6ad7` and the context docs update);
revert in reverse order — production/counts before the `data-quality`
refactor — if reverting a cohort; no migration was touched (migrations stay
through `0033`, 67 tables); nothing pushed; nothing applied to DigitalOcean.
