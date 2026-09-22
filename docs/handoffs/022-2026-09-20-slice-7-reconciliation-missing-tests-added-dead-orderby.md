# 2026-09-20 — Slice 7 reconciliation: missing tests added, dead `orderBy` removed (uncommitted)

Finished the incomplete slice-7 test surface in the still-uncommitted slice-7 working
tree at HEAD `8f3ac5d`. No migration edits and no application behaviour change beyond
removing the now-dead ordering in the repository read.

- **Dead code:** `listApprovedCostCardsForScope`
  (`packages/persistence/src/repositories/cost-card.ts`) no longer `.orderBy`s
  `calculated_at` — the `cost_card_approved_scope_key` partial unique index
  (`NULLS NOT DISTINCT`, `WHERE state = 'approved'`) guarantees at most one approved
  card per `(organization, product variant, location, channel)`. The JSDoc now states
  the index invariant. `desc` stays imported (still used by
  `listCalculationSnapshotsForCostCard`).
- **Persistence tests (`cost-card.test.ts`):** replaced the failing
  "orders approved cards by calculated_at descending" (it seeded two approved cards in
  one scope, now rejected by the index) with "returns the single approved card in
  scope and excludes drafts"; added "rejects a second approved card in the same
  channel scope" and "rejects a second company-wide approved card (null channel,
  NULLS NOT DISTINCT)" — both assert the `cost_card_approved_scope_key` message via
  `rejectionCause`; added "installs the 0015/0016 ... indexes" querying `pg_indexes`
  for `cost_card_approved_scope_key` and `calculation_snapshot_cost_card_idx`
  (mirroring `costing.test.ts`'s `pg_constraint` guard).
- **Application tests:** `approveCostCard` not-found and cross-organization rejections
  (`cost-card.test.ts`); `approvePriceScenario` from `submitted` succeeds and from
  `rejected` is rejected, plus `calculatePriceScenario` rejecting a negative
  `fixedCost` even when the unit contribution is non-positive
  (`price-scenario.test.ts`).

Verified (exact): `npm run lint`, `npm run typecheck`, `npm run build` and
`npm run format:check` pass; without `DATABASE_URL` **466 passed / 112 skipped (578)**;
with `DATABASE_URL` **578 passed / 578 (60 files)**; `npm audit --omit=dev` = 0.
`DATABASE_MIGRATIONS_URL=… npm run db:migrate` is a no-op (ledger 17 rows through
`0016`); `pg_indexes` confirms both indexes present. `npx prettier --write` run on all
four touched files.

Rollback: the whole slice-7 tree is uncommitted and purely additive — discard the
working tree (or, once committed, `git revert`); migrations `0014`–`0016` are additive
with down companions. Next: adversarial review and atomic commit of slice 7 (see
"Resume here").
