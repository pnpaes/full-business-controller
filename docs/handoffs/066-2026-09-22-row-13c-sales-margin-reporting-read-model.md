# 2026-09-22 — Row 13c delivered: the sales & margin reporting read model + Management-home wiring (`RPT-001`–`RPT-003`, `FND-006`)

`main`; HEAD **`e592188`** (unchanged — this slice is **uncommitted**, per the
session instruction). No migration: the read model is on-demand over the
canonical facts, so `db:migrate` stays a no-op and the schema remains **89
tables / migrations through `0059`**. Verification at the working tree:
`typecheck`, `lint`, `format:check`, `build` clean; **3255/3255 tests with
`DATABASE_URL` (214 files)** (baseline 3112/3112, 208 files → +143 tests, +6
files); `npm audit --omit=dev` = 0.

- **Delivered — domain (`packages/domain/src/reporting.ts` + `.test.ts`).**
  `SALES_REPORT_GRAINS` (`day`/`week`/`month`); `periodBucket(grain, isoInstant)`
  → `YYYY-MM-DD` / ISO-8601 `YYYY-Www` (Monday–Sunday, ISO week-numbering year,
  `DEC-032`) / `YYYY-MM`, all UTC; `netSalesFromLine` (the source `net_amount`
  when present, else `gross − included_tax − discount − refund` via
  `unitNetSales` on the exclusive basis — a `ponytail:` note records the source
  preference ceiling); `contributionBeforeLabour`; `contributionMarginPctOrNull`
  (a named wrapper over `contributionMarginPct`, `null`/`n/a` when net ≤ 0,
  `DEC-063`). Decimal-only, `DomainError` on malformed input.
- **Delivered — application (`packages/application/src/reporting/`).** The
  `ReportingStore` port (org-scoped `DEC-061`; read-only — no `writeAudit`,
  because a report writes no audit fact), `buildSalesReport` → `{ asOf, scope,
  period, grain, currency: "NOK", groupBy, groups, totals, truncated, notes }`,
  `listSalesReportRecords` (the `RPT-002` drill-down with resolved `netSales`),
  `createPostgresReportingStore`, `FakeReportingStore` (transaction
  snapshot/restore), unit tests and a `reporting.postgres.test.ts` for the SQL.
- **Delivered — persistence (`packages/persistence/src/repositories/reporting.ts`).**
  `summarizeSales` (one SQL group-by per group key) and `listSalesLineRecords`
  (per-line drill-down, fetches one past `limit` for a conservative
  `truncated`). Rules: `sales_line.option_kind = 'included'` excluded from
  revenue/margin (`SALE-011`, and its ledger cost with it); a null
  variant/category groups as one `unmapped` bucket; reversal lines are negated
  rows so a plain sum nets them; `ingredientCost` is the moving-average
  `value_delta` of the line's `sales_line`-sourced stock movements
  (`source_type = 'sales_line'`, `source_id = sales_line.id` — verified against
  `postTheoreticalConsumption`), sign-corrected, `0` when none posted. The SQL
  mirrors the domain `netSalesFromLine` source preference inline (documented in
  the module header); the two are pinned together by the postgres test.
- **Delivered — web API.** `GET /api/v1/reports/sales` and
  `GET /api/v1/reports/sales/records`; `access.ts`
  (`SALES_REPORT_READ_ROLES` = owner, general_manager, location_manager,
  finance, admin, analyst; `kitchen`/`front_of_house`/`purchasing` excluded),
  `reporting-rows.ts` (required `from`/`to` ISO instants with `from <= to`,
  `grain`/`groupBy` checked against the same vocabularies the application uses,
  UUID filters, `limit` 1–500 / `offset` ≤ 500; unknown → 400), `limiters.ts`
  (a per-IP read throttle), and route tests (200/401/403/400, the
  multi-location rule and the scoped-caller rules).
- **Delivered — UI.** `apps/web/app/(app)/page.tsx` now reads
  `buildSalesReport` directly (the reconciliation-page precedent): Net sales,
  Units, Transactions and **Contribution before labour** KPIs, each with a
  **period · scope · freshness** meta line (`FND-006`); a totals-only location
  comparison labelled as such (`RPT-003`; normalized measures deferred); a
  display-only grain selector; a real daily net-sales trend sparkline; honest
  empty states (`08:72`); and the misleading "Gross margin %" placeholder
  replaced by contribution terminology (`DEC-063`). New
  `apps/web/app/(app)/insights/reports/page.tsx` renders the same report by
  `groupBy` with a per-group drill-down link to the records route;
  `insights/reports/report-labels.ts` (+ `.test.ts`) holds the pure
  period/format helpers.
- **Metric sources and caveats.** Net sales from the sales lines (source
  `net_amount` preferred, else derived); ingredient cost from the stock ledger's
  moving-average value posted for the line; **contribution before labour/fees**
  = net sales − ledger ingredient cost. **Direct labour, channel fees,
  allocated overhead and full cost are not computable today** (no cost-card
  composition assembler has a production caller), so the report never claims a
  full cost or gross margin; every response carries the caveat in `notes`.
- **Deviations / recorded points.** (1) The repo has **no GET-route limiter
  precedent**; `limiters.ts` adds a read throttle applied inline (documented) —
  the alternative was to omit it, but the task listed the file. (2) The
  summary's group list is capped at `SALES_REPORT_MAX_GROUPS = 500` with a
  conservative `truncated` (totals still cover every group). (3) `actorId` is
  carried on both commands for parity/future audit but unused (a read writes no
  fact). (4) The drill-down route accepts the caller's whole scope as a
  `locationIds` list: the page passes it for non-location groups so a
  multi-location caller's drill-down works (the summary route pins a
  multi-location caller with no filter and expands in memory; the records query
  carries the list on the body).
- **Review findings applied (adversarial pass, all uncommitted).** F1 **variant
  resolution:** the persistence group-by resolves the variant
  `product_variant_id → sku → external_mapping(product_variant, effective window,
  transaction source) → null` for both the product/category group-by and the
  filters (previously it joined the never-written `product_variant_id`, so
  product/category returned one `unmapped` group). F2 **window-level transaction
  count:** `summarizeSales` now returns `{ rows, transactions }` where
  `transactions` is a separate ungrouped `count(distinct sales_transaction.id)`
  (`countSalesTransactions`), so a transaction spanning groups is counted once
  (PostgreSQL rejects `count(distinct …) over ()`). F3 **multi-location
  drill-down:** the records route/parser accept `locationIds=a,b`, scoped to the
  caller; the page sets the caller's full scope on non-location group links.
  F4 the fake applies the `SALE-011` `included` exclusion on the drill-down (and
  its divergence from the SQL group-by is documented). F5 the drill-down response
  carries `SALES_REPORT_DRILLDOWN_INCLUDED_NOTE`. F6 a new records route test
  (200/401/403/400, out-of-scope 403, multi-location). F7 the dead `groupBy`
  drill-down parameter was removed. F8 `withTransaction` was removed from the
  port/adapter/fake (no caller). F9 `transactions` returns as text (`::text`) and
  the adapter converts safely. F10 comment/label fixes (ordering, id-label
  fallback, `SALES_REPORT_UNMAPPED_NOTE` wording, drill-down `grain` echo-only,
  blank-vs-null `net_amount`, transaction-count scope). F11 the added assertions:
  the `unmapped` group's totals, the `SALES_REPORT_MAX_GROUPS` truncation
  flag/note, the category `unmapped` bucket, and drill-down `netSales` equal to
  the domain `netSalesFromLine` for a reported and a derived line. **Declined
  (unchanged):** `actorId` parity, no new indexes/materialization, the net-sales
  preference and the ingredient-cost ledger join.
- **Explicitly out of scope (not built):** menu engineering (`RPT-005`),
  stock/production/waste reporting (`RPT-004`), normalized location measures,
  full cost/allocation, materialized aggregates/MVs and the refresh job (gated
  on `ADR-0004`), scope controls, and any new table. `DEC-108` (the coordinator's
  provisional decisions) was **not** edited.
- **Unverified / not run:** no live browser check of the two pages (the routes
  and helpers are unit-tested; the pages are server components); no adversarial
  reviewer pass (no subagent-spawn tool was available in this session); no
  multi-connection concurrency test (the slice is read-only).
- **Reversibility:** the whole slice is a single uncommitted working-tree
  change; no migration, no data written. Revert by checking out the touched
  files. When committed, split into the usual layer commits
  (`feat(domain)`, `feat(persistence)`, `feat(application)`, `feat(web)`,
  `feat(ui)`, `docs(context)`) — each independently revertible with
  `git revert <sha>`.
- **Next:** menu engineering (`RPT-005`) is the remaining row-13 item; the
  import mapping gap that leaves `sales_line.product_variant_id` null is the
  data prerequisite for product/category grouping to show real labels.
