# 2026-09-23 — Allocation pool recurrence→period normalisation delivered (`DEC-115`)

`main`; HEAD before this slice's docs commit is **`e00c07b`** (the `DEC-114`
docs commit). The slice lands as the `docs(decisions)`, `feat(domain)`,
`feat(application)` and this `docs(context)` handoff commits (uncommitted at
handoff-writing time; the orchestrator commits the layers). Nothing pushed;
nothing applied to DigitalOcean. Verification at the tree: `typecheck`, `lint`,
`format:check`, `build` clean; **3585/3585 tests with `DATABASE_URL` (235
files)**; `npm audit --omit=dev` = 0; `db:migrate` a no-op on re-run through
`0062`; **89 tables** (no new table, **no migration**). The baseline before the
slice was 3571/3571 (234 files); the slice added one new test file
(`packages/domain/src/recurrence.test.ts`, 12 tests) and 2 resolver tests.
Next free decision id `DEC-116`.

- **Delivered (`DEC-115`).** `DEC-112` recorded the pool amount as "Σ of the
  linked operating costs effective at `asOf` restricted to the period overlap
  (**recurrence unscaled**, `behavior` unfiltered)", so an `annual` recurring
  cost inflated a one-month pool 12×. **The specification is silent on how a
  recurring cost normalises to an allocation period**
  (`04_CALCULATIONS.md` §4.6 defines
  `allocated_pool_amount = period_cost_pool × entity_driver_share` but never
  builds `period_cost_pool` from recurring costs; `DEC-027` /
  `CALCULATION_CONTRACT.md` §13 speak only to freezing at period lock), so the
  posture was recorded provisionally and implemented additively.
  - **Domain** (`feat(domain)`) — `packages/domain/src/recurrence.ts` (new):
    `normaliseRecurringCostsToPeriod` scales each linked cost's `amount` (a
    **per-recurrence-unit** amount) to the half-open `[periodFrom, periodTo)`
    UTC window by the exact rational factor `periodDays / nominalDays`, with
    `nominalDays` **calendar-anchored at `periodFrom`** (`daily` = 1, `weekly`
    = 7, `monthly` = days in `periodFrom`'s calendar month, `quarterly` = the
    days in the three calendar months from `periodFrom`'s month, `annual` = the
    twelve months incl. leap → 365 or 366). A calendar-month period therefore
    scales a `monthly` cost by exactly 1 and an `annual` cost by
    `periodDays/365` (approximately, not exactly, 1/12). `one_off` contributes
    its face value **once**, only when `periodFrom <= effective_from <
    periodTo`. The contributions are summed **exactly** over a common
    denominator (BigInt rationals, LCM of the nominal day counts) and rounded
    **once** at `MONEY_SCALE` (4 dp HALF_UP) — never at intermediate algebra
    (`CALCULATION_CONTRACT.md` B0–B4). An unknown recurrence throws a
    message-only `DomainError`. `recurringCostContributesToPeriod` reports
    whether a cost contributes a non-zero scaled amount.
    `packages/domain/src/recurrence.test.ts` (new) covers the calendar
    arithmetic (December quarter span, leap-year annual, month overflow), the
    `one_off` half-open boundary, the single-round sum and the fail-closed
    unknown recurrence; the export is added to the
    `packages/domain/src/index.ts` barrel.
  - **Application** (`feat(application)`) —
    `packages/application/src/costing/resolve-allocated-unit-overhead.ts`: the
    pool sum now calls `normaliseRecurringCostsToPeriod` over the linked costs
    instead of summing face values, and `operatingCostIds` now lists **only
    non-zero contributors** (a `one_off` outside its period or a zero amount is
    excluded) via `recurringCostContributesToPeriod`. The JSDoc documents the
    `operatingCostIds` semantics change. Tests in
    `resolve-allocated-unit-overhead.test.ts`.
  - **Decision** (`docs(decisions)`) — `DEC-115` recorded in
    `12_OPEN_DECISIONS.md` (both tables), provisional pending owner/OPS/FIN
    confirmation; supersedes `DEC-112`'s "recurrence unscaled" clause for the
    pool amount.
  - **No migration was needed** — the normalisation is a computation over the
    existing `operating_cost.amount`/`recurrence`/`effective_from` columns; no
    schema object changes. Schema stays through `0062`, 89 tables; **no data
    written**, no backfill.
  - **Deferred with reasons (recorded in `DEC-115`):** partial-window
    proration, `behavior` filtering, a cross-currency guard, and the
    `denominator_source` DB CHECK.
- **Review:** two reviewers (`reviewer-qwen` adversarial, `reviewer-glm`
  code-level). **No blockers, no majors.** Both independently recomputed the
  expected pool figures and confirmed them; both verified the calendar
  arithmetic (December quarter span, leap-year annual, month overflow), the
  exact BigInt rational sum with a single HALF_UP round, the `one_off`
  half-open boundary, and the clause-by-clause match to the decision row.
  **One minor accepted:** a JSDoc clarification documenting the
  `operatingCostIds` semantics change (contributors only, not every linked
  cost). **Three minors declined with reasons:** (a) the public domain
  function returns `"0.0000"` for a zero-length period rather than throwing —
  defensible, and the resolver validates `periodTo > periodFrom` upstream;
  (b) a datetime-string caller of `one_off` would mis-compare — unreachable,
  the only caller passes `yyyy-mm-dd`; (c) a negative amount is not guarded in
  the domain function — the write path and the `operating_cost_amount_check`
  control amounts.
- **Prose correction during the slice:** the `DEC-115` decision prose had
  claimed an annual cost scales by exactly 1/12 — false under the row's own
  `periodDays/365` (or `/366`) definition — corrected to
  `periodDays/365` (approximately 1/12).
- **Reversibility:** each layer commit is independently revertible with
  `git revert <sha>`. **No migration, no schema change and no data written**
  (migrations stay through `0062`; **89 tables**): the domain module
  (`recurrence.ts` + test + barrel line) and the resolver change revert
  independently — reverting the resolver restores the previous face-value sum,
  which is the `DEC-112` behaviour. No backfill. Nothing pushed; nothing
  applied to DigitalOcean.
- **Next:** `DEC-116` — correction/reversal posting wiring (`DEC-028`/
  `DEC-073`): financial/stock facts are append-only (reversals, not edits) and
  the correction path is defined, but the reversal/correction posting is not
  wired end to end; decide and record the posture as `DEC-116` in both tables
  of `12_OPEN_DECISIONS.md` before or with the implementation, keep it
  additive and append-only, and never edit a posted fact. Then the remaining
  `DEC-112`/`DEC-114`/`DEC-115` close-outs (the `denominator_source` DB CHECK,
  per-channel packaging, the cost-card version chain, the per-item override,
  `behavior` filtering, partial-window proration), the row-11 backfill posture
  once decided, `daily_close`, and the test-deployment rehearsal /
  golden-fixture sign-off (parked on owner inputs).
