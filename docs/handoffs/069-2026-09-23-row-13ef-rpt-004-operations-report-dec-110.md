# 2026-09-23 — Row 13e/13f `RPT-004` operations report delivered (`DEC-110`); row 13's reporting set is complete

`main`; HEAD before the slice was **`0d9119c`** (the row-13d handoff). The slice
lands as **`fdf7dc0`** `feat(domain)`, **`353c0bc`** `feat(persistence)`,
**`fa7cfe2`** `feat(application)`, **`ae2352f`** `feat(web)`, the
`docs(decisions)` commit (`DEC-110`) and this `docs(context)` handoff. Nothing
pushed; nothing applied to DigitalOcean. Verification at the committed tree:
`typecheck`, `lint`, `format:check`, `build` clean; **3443/3443 tests with
`DATABASE_URL` (225 files)**; `npm audit --omit=dev` = 0; `db:migrate` a no-op
through `0059`; **89 tables**.

- **Delivered (`RPT-004`, `DEC-110`, split 13e stock/waste + 13f production).**
  `buildOperationsReport` returns the `DEC-108` envelope with four sections:
  - **Stock value** — point-in-time Σ `stock_movement.value_delta` where
    `occurred_at <= asOf`, by location (the ledger, not the `stock_balance`
    projection); echoes `asOf`.
  - **Stock variance** — Σ `stock_count_line.variance_qty` over approved counts
    in the half-open window on `stock_count.cutoff`, and the **booked adjustment
    value** = Σ `stock_movement.value_delta` where `source_type='stock_count'`,
    tied to the source count's location — **never** `variance_qty × cost` (the
    `DEC-067`/`DEC-008` valuation is asymmetric).
  - **Production yield** — completed batches in the half-open window on
    `actual_finish`, by location/recipe: planned/actual output, both the stored
    `yield_variance_pct` semantics and the derived actual/planned ratio, and
    `inputValue` = Σ|`production_consumption.value_delta`| + output value.
  - **Waste** — the `DEC-018` **`stage`** axis (not free-text `reason_code`),
    half-open `occurred_at` window, `moving_average`-only value (`DEC-068`),
    item-only events included, unit-blind quantity.
  - Uniform half-open `[from,to)` flow windows; `RPT-002` per-section
    drill-downs; every response carries the `FND-006` as-of/scope/period and the
    `DEC-110` caveats. API `GET /api/v1/reports/operations` + `/records`; the
    Insights → Operations screen renders the three sections with the meta line,
    the definitions/caveats, honest empty states and drill-down links.
- **Reviews:** three reviewers (qwen/minimax/glm); **no blockers, no majors**
  (minimax and qwen found none beyond minors; glm's majors were the fake waste
  scope, the window inconsistency, the Σ|Δ| input value and the variance
  location tie). Accepted fixes: uniform half-open windows, the fake location
  scope, Σ|`value_delta`| for production input, the variance/count location tie,
  the stock-value drill-down `asOf`, the FND-006 meta per section, and the added
  tests (org isolation, zero-movement/multi-output batches, cross-location count
  sourcing, boundary exclusion, clamps/notes). Recorded, not fixed: the
  per-row scalar subquery in the variance read (perf only); no covering index;
  `sumWasteByProductVariant` (RPT-005) stays inclusive while the RPT-004 waste
  section is half-open; `stock_turn`, multi-currency, `DEC-028` reversal pairing
  and item→product attribution remain deferred.
- **Observed flake:** one full-suite run during this session failed a single
  test (not the new RPT-004 tests, which pass in isolation and in the three
  subsequent full runs). Not reproduced; recorded for CI watchfulness.
- **Reversibility:** each layer is an independently revertible commit
  (`git revert <sha>`). **No migration and no data written**; schema stays
  **89 tables / `0059`**.
- **Next:** row 13 is complete (`REC-003`–`REC-006`, `RPT-001`–`RPT-005`); the
  remaining buildable work is the **cost-card composition assembler** (unblocks
  the contract's full variable/full cost, so the reporting slices can show real
  contribution and full cost), the row-11 **import mapping writer** (populate
  `sales_line.product_variant_id`), the deferred close follow-ups
  (correction-posting wiring `DEC-028`/`DEC-073`, `daily_close`), the
  receipt→ledger wiring (OPS `storage_area_id` policy), and the
  test-deployment rehearsal / golden-fixture sign-off.
