# 2026-09-20 — Slice 6 code-review follow-up (uncommitted)

Applied the accepted slice-6 code-review findings to the still-uncommitted slice-6
work (working tree dirty at HEAD `15b9b68`; nothing applied to DigitalOcean). No
behavioural change beyond the added index; dead code removed and two duplications
folded onto the domain primitives.

- **Dead code removed:** `findCostPoolByCode` (interface, Postgres store, fake
  store, repository) and `listCostPools` (repository) plus their imports/assertions
  in `costing.test.ts`; the unused `CostingAuditAction` type and its re-export.
  `listCostPoolsByCode` is kept and its test now asserts the code listing.
- **Migration `0013`:** generated `0013_labor_rate_lookup_index.sql` adds
  `labor_rate_lookup_idx` on
  `(organization_id, cost_center_id, role_code, effective_from)` to cover the
  `findEffectiveLaborRate` as-of lookup; hand-written
  `0013_labor_rate_lookup_index_down.sql` drops it (not in `_journal.json`). Journal
  `when` `1789864504597`; 47 tables total (index only, no table).
- **De-duplication:** `packages/domain/src/index.ts` now re-exports `rescale` and
  `normalizeCurrency`; `toLoadedHourlyRate` delegates to `rescale` and
  `registerOperatingCost` to `normalizeCurrency` (its `DomainError` surfaces
  unchanged; the bad-currency test regex was updated to the shared message).
- **Half-open parity:** a Postgres-gated `findEffectiveLaborRate` test locks
  `asOf === effectiveFrom` (included) and `asOf === effectiveTo` (excluded);
  `isEffective` in the fake cross-references `repositories/costing.ts` as the
  authority.

Verified (exact): `npm run typecheck`, `npm run lint`, `npx prettier --check` on
every touched file pass; without `DATABASE_URL` **404 passed / 88 skipped (492)**;
with `DATABASE_URL` **492 passed / 492 (52 files)**; `npm run build` and
`npm run format:check` pass; `npm audit --omit=dev` = 0. `grep` confirms no source
references to `findCostPoolByCode` / `listCostPools` / `CostingAuditAction`.
Migration: `db:migrate` applies through `0013` (ledger `when` `1789864504597`),
a second run is a no-op, and the down was rehearsed (drop index → delete the
`0013` ledger row → re-migrate restores the index and the ledger row).

Rollback: the slice is uncommitted and purely additive — discard the working tree
(or, once committed, `git revert`); `0013` is additive with the tested down path
above. Next: commit the slice-6 work, then **slice 7 — cost card + snapshots +
price scenario + approval** (see "Resume here").
