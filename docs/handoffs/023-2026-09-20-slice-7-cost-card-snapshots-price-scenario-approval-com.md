# 2026-09-20 — Slice 7 cost card + snapshots + price scenario + approval committed (`400c95b`)

Implemented, verified and committed slice 7 per `docs/BUILD_ROADMAP.md` (§4 row 7) on
`main`, at HEAD `8f3ac5d` (slice 6) beforehand:

- **Domain:** new `packages/domain/src/pricing.ts` (the `CALCULATION_CONTRACT.md`
  §10 price-scenario maths: required net price from the target contribution, unit
  contribution before/after labour, break-even input helpers) and
  `packages/domain/src/cost-card.ts` (the §3/§8 cost-card semantics with the
  `DEC-047` cost-source precedence and `DEC-060` calculate/snapshot/approve flow),
  both unit-tested and exported from the domain barrel.
- **Application:** new `CostCardStore` and `PriceScenarioStore` ports and services
  under `packages/application/src/costing/` (`calculateCostCard`,
  `snapshotCostCard`, `approveCostCard` with the supersede rule, `calculatePriceScenario`,
  `submitPriceScenario`, `approvePriceScenario`), plus audit actions and validation.
- **Persistence:** generated migrations `0014_cost_card_pricing` (four deferred
  `price_scenario` columns + `snapshot_component_kind_check`; journal `when`
  `1789866859108`) and `0015_calculation_snapshot_cost_card_index` (the
  `calculation_snapshot_cost_card_idx` covering
  `calculation_snapshot(cost_card_id, created_at)`; `when` `1789867750326`);
  hand-written `0016_cost_card_approved_scope` (the partial-unique
  `cost_card_approved_scope_key`, `NULLS NOT DISTINCT WHERE state = 'approved'`,
  preventing two approved cards in one
  `(organization, product variant, location, channel)` scope — the approve-supersede
  race fix; `when` `1789867797172`). Each has an unjournaled `_down.sql`; 0000–0013
  untouched; ledger 17 rows through `0016`.
- **Decisions:** `DEC-058` (closed `snapshot_component_kind` vocabulary),
  `DEC-059` (the deferred `price_scenario` columns land here), `DEC-060`
  (cost-card calculation/snapshot/approval semantics; "unapprove" deliberately
  not implemented). Next free id is now `DEC-061`.

Adversarial reviews ran and were reconciled, per `docs/BUILD_ROADMAP.md` §2:
`reviewer-qwen` (the §7–§10 maths) — no blockers or majors;
`reviewer-glm` (application code) — no blockers; accepted the approve-supersede race
fix via `cost_card_approved_scope_key`, the missing rejection tests, boundary
validation and the dead-surface removal (the dead `orderBy` documented in the prior
work-log entry);
`reviewer-minimax` (schema/migrations) — clean; accepted the missing
`Calculation_snapshot(cost_card_id, created_at)` index (became `0015`) and a down-file
note. **Declined with reasons:** further index re-shaping, and lifting the
`channelId` "any channel" query limitation.

Verified (exact): `npm run lint`, `npm run typecheck`, `npm run build` and
`npm run format:check` pass; without `DATABASE_URL` **466 passed / 112 skipped
(578)**; with `DATABASE_URL` **578 passed / 578 (60 files)**; `npm audit --omit=dev`
= 0; `db:migrate` applies `0014`–`0016` and re-runs as a no-op; the `0015`/`0016`
down paths were rehearsed. The six golden fixtures in
`docs/phase0/GOLDEN_FIXTURES.md` remain **unsigned** — no cost is "verified" yet.
The 16 slice-7 open (owner) points are recorded in `docs/BUILD_ROADMAP.md` §5.

Rollback: `git revert 400c95b` removes the code, migrations `0014`–`0016` and the
`DEC-058`–`DEC-060` entries together; the migrations are additive with tested down
paths. Next: **slice 8 — stock ledger + balances + lots/storage — blocked (owner)
on `ADR-0005` acceptance (Proposed)**; the unblocked work is owner decisions/sign-offs
(see "Resume here").
