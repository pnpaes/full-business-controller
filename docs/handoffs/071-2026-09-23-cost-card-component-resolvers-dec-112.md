# 2026-09-23 — Cost-card component resolvers delivered (`DEC-112`)

`main`; HEAD before the slice was **`180b1bb`** (the `DEC-111` context handoff).
The slice lands as **`8cf86c9`** `docs(decisions)`, **`bfb1a07`**
`feat(domain)`, **`fb081ef`** `feat(persistence)`, **`7748969`**
`feat(application)` and **`8bf8c71`** `feat(web)`, plus this `docs(context)`
handoff. Nothing pushed; nothing applied to DigitalOcean. Verification at the
committed tree: `typecheck`, `lint`, `format:check`, `build` clean;
**3547/3547 tests with `DATABASE_URL` (233 files)**; `npm audit --omit=dev` =
0; `db:migrate` a no-op on re-run through `0062`; **89 tables** (no new
table). Next free decision id `DEC-113`.

- **Delivered (`DEC-112`).** Three of the four cost-card component resolvers —
  the resolvers `DEC-111` left as explicit inputs — are wired into the
  composition assembler; `otherVariableCost` stays an explicit input (no source
  exists). Precedence: **a resolved value wins over the caller's explicit
  input**; an `undefined` result keeps the explicit input; provenance records
  the `resolved` flags and the per-component source (`recipe_labour_rule`/
  `channel_fee_rule`/`operating_cost_pool` vs `command_input`).
  - **Direct labour** — `recipe_version.preparation_minutes` now means
    **direct-labour minutes per batch**, valued at the effective `labor_rate`
    for the version's new nullable `(labor_cost_center_id, labor_role_code)`
    pair (all-or-nothing column pair, written through `registerRecipeVersion`)
    and divided by `approved_usable_output` in one B3 step (new domain
    `unitDirectLaborCost`).
  - **Channel variable cost** — a `channel_fee_rule` reader: percentage kinds
    (`commission_pct`/`processing_pct`) computed on `gross_price`/`net_price`
    per `fee_basis`; fixed kinds (`fixed_per_order`/`delivery_subsidy`/
    `discount_funding`) divided by `unitsPerOrder` via the new domain
    `perUnitFixedFee`; per-rule amounts summed at B-money through the existing
    `channelVariableCost`. New `registerChannelFeeRule` write command +
    `POST /api/v1/costing/channel-fee-rules`.
  - **Allocated unit overhead** — new nullable `operating_cost.cost_pool_id`
    links costs to a pool; the pool amount is the Σ of linked costs effective
    at `asOf` restricted to the period overlap; the closed
    `ALLOCATION_DENOMINATOR_SOURCE` vocabulary (`explicit`, `eligible_products`,
    `equal_share`) closes the free-text source; overhead is
    `allocatedUnitOverhead(poolAmount, totalDriverVolume, {fallback})`.
  - **Migration `0060`** adds the resolver columns + the vocabulary;
    **`0061`** adds the cross-org guards; **`0062`** adds the
    `channel_fee_rule` lookup index. Schema stays additive — **89 tables**,
    no backfill.
- **Reviews:** three reviewers (`reviewer-qwen` adversarial logic,
  `reviewer-minimax` structural/schema/migration, `reviewer-glm` code-level).
  **Accepted fixes:** the `registerChannelFeeRule` overlap check is now scoped
  to the same `fee_kind` (matching the `channel_fee_rule_no_overlap` EXCLUDE on
  `(channel_id, fee_kind)`) — a major; the `channel_fee_rule` lookup index +
  migration `0062` — a structural major; lazy `unitsPerOrder` validation; an
  accurate percentage-basis error message; no wasted `countEligibleProducts`
  read in the `equal_share` branch; a runbook preflight note for `0060`.
  **Declined (with reasons):** qwen's "overhead period filter compares `Date`
  vs `string`" is a **false positive** — `operating_cost` uses `date` columns
  (drizzle returns strings; only `channel_fee_rule` is `tstz`); glm's
  "`fallbackUsed` misreported in the `equal_share` branch" is **by design**
  (`denominator_source = equal_share` *is* the equal-share spread); resolved
  zero-cost components are dropped from the snapshot by design; the
  `as AllocationFallback` casts are guaranteed by the DB CHECK; the
  `recipe_version` trigger re-firing on UPDATE is acceptable overhead.
- **Deferred / open from `DEC-112`:** the `other_variable_cost` source; the
  volume-based denominators (`revenue`, `transactions`, `sales_units`,
  `production_*`), which fail closed and need the period-scoped sales read
  wiring; a DB CHECK for `denominator_source`; per-channel packaging; the
  cost-card version chain; the per-item cost-selection override; the
  period-overlap operating-cost read; the recurrence→period normalisation and
  `behavior` filtering; the golden-fixture sign-off.
- **Reversibility:** each of the five commits is independently revertible with
  `git revert <sha>`. The schema is additive (nullable columns + vocabulary +
  index, no backfill); the migration down-path order is **`0061` org-guard
  down → `0062` index down → `0060` resolver-columns down**. Nothing pushed;
  nothing applied to DigitalOcean.
- **Next:** the row-11 import mapping writer (populate
  `sales_line.product_variant_id` so product labels are real; the variant
  chain resolves by sku meanwhile); alternatives: the deferred volume-based
  denominators; the deferred close follow-ups (correction-posting wiring
  `DEC-028`/`DEC-073`, `daily_close`); the receipt→ledger wiring once the OPS
  `storage_area_id` policy lands.
