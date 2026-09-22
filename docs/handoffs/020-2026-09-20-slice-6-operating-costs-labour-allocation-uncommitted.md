# 2026-09-20 — Slice 6 operating costs + labour + allocation (uncommitted)

Implemented and verified slice 6 per `docs/BUILD_ROADMAP.md`: `COST-004`, `COST-006`,
`COST-007`, `COST-011`, `COST-013` under `DEC-047`/`DEC-048`/`DEC-006`/`DEC-007`, on
`CALCULATION_CONTRACT.md` §7 and §9. **The work is UNCOMMITTED** — the working tree is
dirty at HEAD `15b9b68` (nothing applied to DigitalOcean). Slice 5's in-flight reviews
were reconciled in the committed `13a29b7`/`15b9b68`.

- **Domain:** new `packages/domain/src/labour.ts` (compounded loaded rate with 2 dp
  per-component rounding, `applyProductiveHoursPct`, `directLaborCost`,
  `labourCostViews`, `contributionBeforeAndAfterDirectLabor`) and
  `packages/domain/src/allocation.ts` (`entityDriverShare`, `allocatedPoolAmount`,
  `allocatedUnitOverhead` with `stop`/`equal_share` fallbacks, `unitFullCost`,
  `fullCostMargin`), both exported from the domain barrel and unit-tested.
- **Persistence:** four new tables in `packages/persistence/src/schema/costing.ts` —
  `operating_cost`, `labor_rate`, `cost_pool`, `allocation_rule` (the `asset`
  register deliberately deferred); new vocabularies `COST_BEHAVIOR`,
  `OPERATING_COST_RECURRENCE`, `ALLOCATION_DRIVER`, `ALLOCATION_FALLBACK`
  (`allocation_fallback` added to `schemas/domain-enums.yaml`); a `dateRange()`
  helper in `columns.ts`; new `repositories/costing.ts`; generated migration
  `0011_cost_allocation.sql` plus hand-written
  `0012_cost_allocation_invariants.sql` (the EXCLUDE constraints
  `cost_pool_no_overlap`, `labor_rate_no_overlap`, `allocation_rule_no_overlap`;
  `operating_cost` deliberately has none), each with a down companion
  (`0011_*_down.sql`, `0012_*_down.sql`). Journal `when` values `1789862475550`
  (0011) and `1789862630158` (0012); 47 tables total.
- **Application:** new `packages/application/src/costing/` — `registerLabourRate`,
  `registerOperatingCost`, `registerCostPool`, `registerAllocationRule`,
  `computeLabourCost`, `allocateCostPool`, a `CostingStore` port +
  `createPostgresCostingStore`, `FakeCostingStore`, `validation.ts` (ISO-date/range
  checks) and `COSTING_AUDIT_ACTIONS`.
- **Decisions:** `DEC-055` (loaded-rate 2 dp per-component rounding;
  `productive_hours_pct` divides the per-paid-hour rate, null = 100 %; paid +
  imputed owner labour share the effective per-productive-hour rate), `DEC-056`
  (allocation fallback `stop` default / explicit `equal_share`; round once at 4 dp),
  `DEC-057` (`cost_pool.code` is versioned, not unique; only overlapping windows
  are rejected). Next free id is now `DEC-058`.

Adversarial reviews ran and were reconciled: `reviewer-qwen` (design, on the §7/§9
maths), `reviewer-minimax` (persistence schema/migration/rollback), `reviewer-glm`
(application code). **Accepted and applied:** the missing `0011` down file (blocker);
`registerCostPool` allowing a non-overlapping successor version (blocker, both code
reviews); deterministic `findCostPoolByCode` + `listCostPoolsByCode`; ISO-date +
currency validation; `equal_share`-without-count and negative-base tests;
same-day/zero-length boundary tests; the `SCOPE_TYPE` comment; runbook notes.
**Declined with reasons:** a closed `denominator_source` vocabulary (would invent
values — recorded as an open owner decision); a shared-only `operating_cost` filter
(no caller; semantics documented); extra composite indexes (low cardinality); the
fake-store tie-break (unreachable given the overlap exclusion); valuing imputed
owner labour at the raw loaded rate instead of the effective rate (`DEC-055`
records the chosen consistent valuation); the `scope_type` structural split
(deferred, comment added).

Verified (exact): without `DATABASE_URL` — lint/typecheck/build/format:check pass,
**404 passed / 87 skipped (491)**; with `DATABASE_URL` — **491 passed / 491
(52 files)**; `npm audit --omit=dev` = 0; `db:migrate` applies through `0012` and a
re-run is a no-op; both down paths rehearsed (`0011` down drops the four tables,
both ledger rows deleted; re-migrate restores 47 tables and the three
constraints).

Rollback: the slice is uncommitted and purely additive — discard the working tree
(or, once committed, `git revert`); migrations `0011`/`0012` are additive with the
tested down paths above. Next: commit this work (Rule 2), then **slice 7 — cost
card + snapshots + price scenario + approval** (see "Resume here").
