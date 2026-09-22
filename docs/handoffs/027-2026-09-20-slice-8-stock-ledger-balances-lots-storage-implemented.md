# 2026-09-20 — Slice 8 stock ledger + balances + lots/storage implemented, reviewed, reconciled (uncommitted)

Slice 8 is **implemented, adversarially reviewed in three independent passes,
fix-reconciled and fully verified — but UNCOMMITTED** (branch `main`, HEAD
`f7b1db7`; nothing applied to DigitalOcean). The three stock tables already
existed in `0001`; migrations `0000–0016` untouched.

- **What was built.** Domain `packages/domain/src/stock.ts` (+`stock.test.ts`,
  exported from the domain barrel): moving-weighted-average valuation with
  `computeMovementValue`, `applyStockMovement`, `applyStockMovementValue`,
  `reverseStockMovement`, `recomputeStockBalance`, `revaluationGap` and
  `wouldDriveNegative`. Application `packages/application/src/inventory/`
  (`types.ts`, `actions.ts`, `validation.ts`, `post-stock-movement.ts`,
  `reverse-stock-movement.ts`, `stock-balance.ts`, `register-storage-area.ts`,
  `postgres-store.ts`, `test-support.ts`, `index.ts`, unit tests + the
  `inventory.postgres.test.ts` integration file; barrel export added):
  `postStockMovement`, `postStockMovements` (atomic batch — the `PROD-002`
  primitive), `reverseStockMovement` (exact offset + `revaluation` correction),
  `getCurrentStockBalance`, `getStockBalanceAsOf` (`INV-002`),
  `registerStorageArea`, the `InventoryStore` port + `FakeInventoryStore` +
  `createPostgresInventoryStore`. Persistence
  `packages/persistence/src/repositories/inventory.ts` (+`inventory.test.ts`,
  `repositories/test-support.ts`, `schema/inventory.ts`, package barrel):
  `lockOrCreateStockBalance` (`INSERT … ON CONFLICT DO NOTHING` + `SELECT … FOR
UPDATE`, per `DEC-034`), `findOrCreateStockLot`, movement/lot/area reads. New
  hand-written migration `0017_stock_ledger_invariants.sql` (+`_down.sql`,
  `meta/0017_snapshot.json`, `meta/_journal.json` entry idx 17, `when`
  `1789895339462`): the deferred FK on `stock_lot.source_movement_id` and a
  `goods_receipt`-only `source_id` guard trigger.
- **Adversarial reviews and reconciliation.** Three independent passes:
  `reviewer-qwen` (logic/edge cases), `reviewer-glm` (application code),
  `reviewer-minimax` (schema/migration/rollback). Applied on top of the first
  implementation (items A1–A12/P1–P4/D1 in the prior work-log entry — see the
  next entry): posting-path `revaluationGap` correction; org-scoped idempotency
  replay; removal of the caller-supplied `currency` (always
  `organization.currency`); pre-transaction batch validation + empty-batch
  rejection; reversal `negative_override` audit; removal of the dead `"NOK"`
  fallback; strict ISO-instant/`yyyy-mm-dd` validation; `lotId`+`lot` rejection;
  reversing a `revaluation` rejected; `requires_revaluation: true` when an
  override leaves negative quantity; `:`-containing batch idempotency key
  rejected; fake timestamp normalisation; `findOrCreateStockLot` (lot
  create-or-find race); `saveStockBalance` throws when it matches no row;
  `lockOrCreateStockBalance` transaction docstring; the `0017` runbook
  `ShareLock`/`NOT VALID`→`VALIDATE` preflight note. **Declined with reasons:**
  the adapter `isNodeDatabase` guard/savepoint nesting (repo-wide convention;
  nesting is harmless and the batch stays atomic); converting the concurrent
  unique-violation on `idempotency_key` into a replay (the unique index prevents
  double-posting; a retry hits the replay path); tightening the `0017` trigger
  to `goods_receipt.status='accepted'`/location match (deferred to the
  receipt-wiring slice). Eight open owner/TECH points are recorded in
  `docs/BUILD_ROADMAP.md` §5 and "Open decisions / inputs" (next free id
  `DEC-066`). A later delta review of the fixes found two more accepted minors
  (fake `saveStockBalance` parity with the adapter; single-posting
  idempotency-key `:` rejection — see "Delta review" below) and one declined
  (documented) strictness note (`assertIsoInstant` deliberately rejects an ISO
  instant without seconds).
- **Verified (exact):** `npm run lint`, `npm run typecheck`, `npm run build` and
  `npm run format:check` pass; without `DATABASE_URL` **551 passed / 134 skipped
  (685)**; with it **685 passed / 685 (69 files)**; `npm audit --omit=dev` = 0;
  `db:migrate` applies `0017`, re-runs as a no-op, and the down path was
  rehearsed (drop trigger/function/FK, delete the ledger row, re-migrate).
- **Delta review.** After the reconciliation above, a delta review of the
  slice-8 fixes found two more minors, both **accepted and applied** with new
  tests: `FakeInventoryStore.saveStockBalance` now throws when the balance row
  was not locked first (parity with the Postgres repository, which now throws —
  new `packages/application/src/inventory/test-support.test.ts`), and
  `postStockMovement` now also rejects a single-posting `idempotencyKey`
  containing `:` (the batch already did). One **declined (documented)**
  strictness note: an ISO instant without seconds is rejected by the
  `assertIsoInstant` regex — a deliberate choice. The verified counts above
  reflect these additions.
- **Rollback:** the slice is uncommitted and purely additive — discard the
  working tree; once committed, `git revert <sha>`. Migration `0017` is additive
  with the rehearsed down path.
- **Local note:** a reviewer's ad-hoc probe left 3 `stock_movement` rows under a
  throwaway org in the local dev database (undeletable due to the append-only
  trigger; the documented destructive replay would clear them) — a local
  dev-data artefact, no repository impact.
- **Next:** atomic commit (see "Resume here"), then slice 9 — counts +
  transfers + waste.
