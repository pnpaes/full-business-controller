# 2026-09-20 — Slice 8 review fixes applied (uncommitted)

Applied the reconciled adversarial-review fixes to the still-uncommitted slice-8
working tree (HEAD `f7b1db7`; nothing applied to DigitalOcean). Accepted items
only; no unrelated refactor and no new migration (`0017` already applied).

- **Application (`packages/application/src/inventory/`).** A1: the normal posting
  path now mirrors the reversal path — after `applyStockMovement` it checks
  `revaluationGap` and, when non-null, posts a value-only `revaluation` movement
  (`quantityDelta "0.000000"`, `unitCost null`, `sourceType "revaluation"`,
  reason `input.reasonCode ?? "revaluation"`, idempotency key suffixed
  `:revaluation`) and returns the corrected balance. A2: an idempotency replay
  whose movement belongs to another organization throws
  `DomainError("movement not found in organization")` before touching the other
  org's balance. A3: removed the caller `currency` input; the movement always uses
  `organization.currency`. A4: `postStockMovements` validates `sourceType`,
  `occurredAt` and a non-empty `movements` before opening the transaction. A5:
  the reversal audit records `negative_override: true` when the override was
  used. A6: the `?? "NOK"` fallback is gone — a null-currency movement resolves
  its organization or throws. A7: new `validation.ts` (`assertIsoInstant`) rejects
  non-instant `occurredAt`/`asOf`; lot `expiryDate`/`openedDate` use the existing
  `assertIsoDate`. A8: supplying both `lotId` and `lot` is rejected. A9: reversing
  a `revaluation` movement is rejected. A10: an override that leaves negative
  quantity adds `requires_revaluation: true` to the audit (the DEC-010 exception
  queue is not modelled yet). A11: a batch `idempotencyKey` containing `:` is
  rejected. A12: the fake normalises `occurredAt`/lot `receivedAt` to
  `toISOString()`.
- **Persistence (`packages/persistence/src/repositories/inventory.ts`).** P1:
  new `findOrCreateStockLot` (`INSERT … ON CONFLICT DO NOTHING` then `SELECT`),
  now used by the application lot path; the now-dead application port methods
  `findStockLotByNumber`/`createStockLot` were removed from the port, adapter and
  fake. P2: `saveStockBalance` throws when the update matches no row (callers must
  lock first). P3: `lockOrCreateStockBalance` documents that it MUST run inside a
  transaction. P4: the persistence `createTestStockMovement` comment names the
  documented `0017` trigger no-op.
- **Docs.** D1: the `0017` runbook preflight note now states the plain
  `ADD CONSTRAINT … FOREIGN KEY` takes a `ShareLock` on `stock_lot`, and points to
  the `NOT VALID` → `VALIDATE` form when the table may already hold rows.

Tests added: the posting-path revaluation + clean-zeroing cases, the foreign-org
replay rejection, `lotId`+`lot` rejection, negative-override `requires_revaluation`,
batch pre-validation, strict-instant rejections, UTC normalisation in the fake;
`findOrCreateStockLot` idempotency and the `saveStockBalance` no-op guard at the
persistence layer. **Reviewer note:** the reviewer's literal sequence
`3 @ 0.0001` then `-3` is arithmetically clean (3 × 0.0001 = 0.0003; 0.0003 / 3 =
0.0001 exactly), so it cannot leave a residual; the test keeps that literal
receipt and adds a `27 @ 0.0000` top-up so the 4 dp average rounds to `0.0000`,
which reproduces the same defect class and now posts the correction.

Verified (exact): `npm run typecheck`, `npm run lint`, `npm run build` and
`npm run format:check` pass; without `DATABASE_URL` **549 passed / 134 skipped
(683)**; with it **683 passed / 683 (68 files)**; `npx prettier --write/--check`
run on every touched file. Rollback: discard the working tree; no new migration or
generated file.
