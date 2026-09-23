# 2026-09-23 — Volume-based allocation denominators delivered (`DEC-114`)

`main`; HEAD before the slice was **`2c57259`** (the `feat(web)` commit of the
row-11 mapping-writer slice's docs layer). The slice lands as the
`docs(decisions)`, `feat(persistence)`, `feat(application)` and this
`docs(context)` handoff commits (uncommitted at handoff-writing time; the
orchestrator commits the layers). Nothing pushed; nothing applied to
DigitalOcean. Verification at the tree: `typecheck`, `lint`, `format:check`,
`build` clean; **3571/3571 tests with `DATABASE_URL` (234 files)**;
`npm audit --omit=dev` = 0; `db:migrate` a no-op on re-run through `0062`;
**89 tables** (no new table, **no migration**). The baseline before the slice
was 3562/3562 (233 files); the slice added one new test file
(`packages/persistence/src/repositories/reporting.postgres.test.ts`, 3 tests)
and 6 application tests. Next free decision id `DEC-115`.

- **Delivered (`DEC-114`).** `DEC-112` closed the
  `ALLOCATION_DENOMINATOR_SOURCE` vocabulary with only `explicit`,
  `eligible_products` and `equal_share` implemented; the volume-based
  denominators failed closed in `resolveAllocatedUnitOverhead`. This slice
  implements the **sales-derived** denominators — `revenue`, `transactions`,
  `sales_units` — additively and reversibly; the `explicit`/`eligible_products`
  /`equal_share` paths are unchanged.
  - **Persistence** (`feat(persistence)`) — `schemas/domain-enums.yaml` and
    `packages/persistence/src/schema/vocabularies.ts`: `allocation_denominator_source`
    widens to `{explicit, eligible_products, equal_share, revenue, transactions,
    sales_units}` (`sales_units` added as a denominator source only — the
    `DEC-007` `allocation_driver` eight-pool list is unchanged).
    `packages/persistence/src/repositories/reporting.ts`: a new half-open
    `sumSalesVolume` read (org-scoped, `locationId`-scoped,
    `option_kind <> 'included'`, unmapped lines included, reversals netted,
    empty window returns zeros) returning `{ revenue, transactions, units }`;
    the `netSalesExpression()` helper was extracted out of `summarizeSales`
    with **byte-identical rendered SQL**. The inclusive `summarizeSales`
    window is deliberately not reused and not changed.
    `packages/persistence/src/repositories/reporting.postgres.test.ts` (new)
    covers the read.
  - **Application** (`feat(application)`) —
    `packages/application/src/costing/resolve-allocated-unit-overhead.ts`: a
    new branch for the three sales-derived sources that fails closed with a
    message-only `DomainError` on a missing/zero/negative volume and forces
    `stop` semantics (no eligible-entity set for a volume driver). The port
    member is added to `CostCardComponentStore` and wired through
    `packages/application/src/costing/cost-card-composition-postgres-store.ts`;
    `assemble-cost-card-composition.ts` passes the period through unchanged.
    Tests in `resolve-allocated-unit-overhead.test.ts`,
    `assemble-cost-card-composition.test.ts` /
    `.postgres.test.ts` and `costing.test.ts`.
  - **Decision** (`docs(decisions)`) — `DEC-114` recorded in
    `12_OPEN_DECISIONS.md` (both tables), provisional pending owner/OPS/FIN
    confirmation.
  - **No migration was needed** — `allocation_rule.denominator_source` is free
    text with a non-empty CHECK only (`costing.ts:356-359`), so widening the
    vocabulary is a code-side lockstep change (YAML + TS). Schema stays through
    `0062`, 89 tables; **no data written**, no backfill.
  - **Deferred with reasons (recorded in `DEC-114`):**
    `production_hours`/`production_minutes` (the wall-clock duration is
    derivable from `actual_start`/`actual_finish`, but the driver semantic has
    no authority yet), `recorded_time`, `operating_hours`, the
    `denominator_source` DB CHECK, and org-wide volume scope for
    `organization`/`company_wide` rules (the read is single-location — a
    recorded gap; `allocation_rule.scope_type` is not consulted for volume
    denominators, as for `eligible_products`/`equal_share` already).
- **Review:** two reviewers (`reviewer-qwen` adversarial, `reviewer-glm`
  code-level). **No blockers, no majors.** Both confirmed the rendered SQL is
  unchanged by the `netSalesExpression()` extraction, the window is genuinely
  `[from, to)` and timezone-safe, the fail-closed check catches
  zero/negative/non-numeric, the vocabulary widening is in lockstep with the
  YAML and no other consumer mis-handles the new values, and the tests are
  real (not tautologies). **Three minors declined with reasons:**
  (a) `transactions` returns the string `"25"` rather than `"25.000000"` —
  correct, a count is not a quantity; (b) the per-source validation scale
  (`revenue` money-scale 4, `transactions` integer) — unreachable today
  because the only producer casts, so the ceiling is documented in a
  `ponytail:` comment instead of adding a branch; (c) the `rows[0] ?? fallback`
  in `sumSalesVolume` is dead code — defensive only.
- **Reversibility:** each layer commit is independently revertible with
  `git revert <sha>`. **No migration and no schema change** — the vocabulary
  widening (YAML + TS, in lockstep) and the `sumSalesVolume` read are additive;
  reverting the vocabulary and reverting the read are independent; the
  application layer reverts as a unit (port member + resolver branch + store
  wiring); no backfill and no data written, so a reverted tree leaves existing
  rows untouched. Nothing pushed; nothing applied to DigitalOcean.
- **Next:** `DEC-115` — allocation pool period-scoping: recurrence→period
  normalisation (`DEC-112` records the pool amount as "Σ of the linked
  operating costs effective at `asOf` restricted to the period overlap
  (**recurrence unscaled**, `behavior` unfiltered)", so a monthly and an
  annual recurring `operating_cost` are currently summed at face value for a
  one-month period); then the remaining `DEC-112`/`DEC-114` close-outs (the
  `denominator_source` DB CHECK, per-channel packaging, the cost-card version
  chain, the per-item override), the row-11 backfill posture once decided, the
  deferred close follow-ups (`DEC-028`/`DEC-073` correction wiring,
  `daily_close`), and the test-deployment rehearsal / golden-fixture sign-off
  (parked on owner inputs).
