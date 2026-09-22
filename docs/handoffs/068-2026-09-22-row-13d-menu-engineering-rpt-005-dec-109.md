# 2026-09-22 — Row 13d menu engineering delivered (`RPT-005`, `DEC-109`); row 13's dashboards + menu-engineering half is complete

`main`; HEAD before the slice was **`4f77c0c`** (the row-13c handoff). Row 13d
lands as **`af2b81c`** `feat(domain)`, **`b360c82`** `feat(persistence)`,
**`eb6dbb6`** `feat(application)`, **`7f7dfc7`** `feat(web)`, plus this
`docs(context)` handoff. Nothing pushed; nothing applied to DigitalOcean.
Verification at the committed tree: `typecheck`, `lint`, `format:check`, `build`
clean; **3324/3324 tests with `DATABASE_URL` (219 files)**;
`npm audit --omit=dev` = 0; `db:migrate` a no-op through `0059`; **89 tables**.

- **Delivered (`RPT-005`, `DEC-109`).** `buildMenuEngineeringReport` reuses the
  row-13c read model (`summarizeSales({groupBy:"product"})`) — metric definitions
  are not re-derived (`ADR-0007`). **Thresholds are computed medians only:** the
  popularity threshold is the median of per-product units over the report scope
  and period; the contribution threshold is the **category-relative** median of
  "contribution before labour/fees" within each `product.category` (a null
  category is its own group). Classification is `high`/`low` (`>=`), with **no
  Star/Puzzle labels**. Each response carries the threshold statistic, source
  (`computed`), value, scope and **source period**; every row carries its own
  category threshold. Thresholds are computed over **all** resolved products
  before the 500-row cap. The `unmapped` bucket is excluded from the thresholds
  and reported separately. Waste is annotated only where
  `waste_event.product_variant_id` is set, and **only `moving_average`
  valuations** (`DEC-068`).
- **API + UI.** `GET /api/v1/insights/menu-engineering` (the `SALES_REPORT_READ`
  role set, the location-scope ladder, the sales-route throttle) and the
  Insights → Menu engineering page: a contribution/popularity matrix built from
  the existing `Table`/`Badge`/`KpiCard` primitives (no charting dependency),
  showing the actual threshold value + source period, the classification, the
  waste annotation, a drill-down link to the row-13c records route, and an honest
  empty state that cannot contradict the unmapped bucket.
- **Reviews:** three reviewers (qwen/minimax/glm); **qwen found nothing**, no
  blocker overall. Accepted fixes: the `DEC-068` waste filter, pinning the new
  `category`/`productKind`/`optionKinds` on product groups (a row-13c contract
  addition), the contradictory empty state, the capped "Products analysed" count,
  the dead export, the tightened threshold map, fake ordering parity, and the
  added tests (mixed `optionKinds`, waste `value:null`/location/org scoping,
  negative even-count median). Recorded, not fixed: no index for the waste read
  (a future index review); `waste_event.currency` is not cross-checked against
  the hard-coded NOK; the `moving_average` filter also excludes non-`moving_average`
  events from the **quantity** sum (inert while `DEC-068` leaves those methods
  unimplemented); no live browser render of the server-component screen.
- **Reversibility:** each layer is an independently revertible commit
  (`git revert <sha>`). **No migration and no data written** — the read model is
  on-demand over the canonical facts. Schema stays **89 tables / `0059`**.
- **Next:** `RPT-004` (stock value/variance, production yield, waste
  value/reasons reporting) — the last `RPT` item — and the deferred close
  follow-ups (correction-posting wiring `DEC-028`/`DEC-073`, `daily_close`); the
  receipt→ledger wiring once the OPS `storage_area_id` policy lands; the
  cost-card composition assembler (unblocks the contract's full variable cost /
  full cost); the test-deployment rehearsal and golden-fixture sign-off.
