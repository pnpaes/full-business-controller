# 2026-09-22 — Row 13c review findings applied: variant resolution, window transaction count, multi-location drill-down (`RPT-001`–`RPT-003`)

`main`; HEAD **`e592188`** (unchanged — the whole row-13c slice, this review pass
included, is **uncommitted**). No migration: the read model stays on-demand over
the canonical facts, so `db:migrate` is a no-op and the schema remains **89
tables / migrations through `0059`**. Verification at the working tree:
`typecheck`, `lint`, `format:check`, `build` clean; **3255/3255 tests with
`DATABASE_URL` (214 files)** (baseline 3112/3112, 208 files → +143 tests, +6
files); `npm audit --omit=dev` = 0.

This entry records the adversarial-review fixes on the delivered 13c slice (see
`066-…md` for the slice's own delivery). No decision changed; `DEC-108`/`DEC-109`
are the authority for the resolution rules and were **not** edited.

- **F1 — the full variant-resolution chain (`packages/persistence/src/repositories/reporting.ts`).**
  `resolvedVariantIdExpression()` resolves, in order: `sales_line.product_variant_id`
  → `sales_line.sku = product_variant.sku` within the organization (index
  `sales_line (organization_id, sku)`) → the effective `external_mapping` for the
  transaction's `source_system` (`internal_entity_type = 'product_variant'`,
  matched on `sku` or `external_id`, half-open `[effective_from, effective_to)`),
  → `null` (the `unmapped` bucket). The expression feeds the `product` group-by,
  the `productName` join and the `category`/`productVariantId` filters (both the
  summary and the drill-down). Previously the group-by joined
  `sales_line.product_variant_id` directly, which the row-11 importer never
  writes, so `groupBy=product`/`category` returned one `unmapped` group and the
  dimension filters matched nothing. The chain is a `ponytail:`-noted correlated
  subquery — no migration, no materialization (`ADR-0004`/`ADR-0007`).
- **F2 — window-level transaction count.** `summarizeSales` now returns
  `{ rows, transactions }`; `transactions` comes from a separate **ungrouped**
  `count(distinct sales_transaction.id)` (`countSalesTransactions`, text cast)
  over the same filtered line set. `buildSalesReport` uses it for
  `totals.transactions` instead of summing the per-group counts, so a transaction
  spanning several `category`/`product`/`channel` groups is counted **once**.
  (PostgreSQL rejects `count(distinct …) over ()`, and a grouped count cannot be
  summed into a window total.)
- **F3 — multi-location drill-down.** The records route/parser accept
  `locationIds=a,b`: the list is checked against the caller's scope (a 403 if any
  id is out of scope) and passed whole, so a multi-location caller's drill-down
  works. An explicit `locationId` (a location group's own id) narrows to that
  location; otherwise an explicit `locationIds` list is used; otherwise a scoped
  caller is pinned to their full scope. `recordsHref` sets the caller's full
  scope on every non-location group link. Previously the page passed the whole
  scope to the summary but the drill-down 400'd for a multi-location caller.
- **F4 — the fake applies the `SALE-011` `included` exclusion.**
  `FakeReportingStore.listSalesLineRecords` filters `optionKind !== "included"`;
  the header documents the **summarize-side divergence** (the fake seeds
  pre-aggregated groups, so it cannot recompute the distinct count or apply the
  exclusion there; the Postgres tests pin the adapter).
- **F5 — the drill-down states the omission.** `SALES_REPORT_DRILLDOWN_INCLUDED_NOTE`
  ("…retained for consumption but excluded from this revenue/margin view,
  `SALE-011`") is carried in the response `notes`.
- **F6 — the missing records route test.** New
  `apps/web/app/api/v1/reports/sales/records/route.test.ts` mirrors the summary
  route tests (200/401/403/400, role matrix, out-of-scope 403, the
  multi-location scope cases, the parser cases, and that `groupBy` is ignored).
- **F7 — the dead `groupBy` drill-down parameter removed** (query type, parser
  and route pass-through): it was validated then dropped.
- **F8 — `withTransaction` removed** from the `ReportingStore` port, the Postgres
  adapter and the fake (read-only module, no caller).
- **F9 — safe count cast.** `transactions` returns as text (`count(distinct …)::text`,
  the `::bigint`-equivalent) and the adapter converts with a
  `Number.isSafeInteger` guard — no `::int` overflow ceiling.
- **F10 — comment/label corrections.** The drill-down orders **oldest** first
  (comment fixed); a non-null id whose joined name is missing falls back to the
  **id**, not the `Unmapped` label; `SALES_REPORT_UNMAPPED_NOTE` reworded to "no
  value for the grouped dimension"; `grain` documented as echo-only on the
  drill-down; the blank-vs-null `net_amount` asymmetry documented (SQL `coalesce`
  collapses NULL only, the domain treats blank as absent, and `numeric` cannot
  store a blank); `totals.transactions` documented as counting transactions with
  at least one non-`included` line.
- **F11 — strengthened tests.** New Postgres cases: sku-only resolution to
  variant/product/category, an effective `external_mapping` fallback, the
  `category` `unmapped` bucket, the window-level distinct count (one transaction,
  two categories → total 1), and drill-down `netSales` equal to the domain
  `netSalesFromLine` for a reported and a derived line. New unit cases: the
  `unmapped` group's totals, the `SALES_REPORT_MAX_GROUPS` truncation flag/note,
  the `included` drill-down exclusion with its note.
- **Declined (unchanged, per instruction):** `actorId` parity on the read
  commands; no new indexes or materialized aggregate (the correlated-subquery
  cost and index gaps are recorded, not fixed); the net-sales source preference
  and the ingredient-cost ledger join semantics.
- **Unverified / not run:** no live browser check of the two pages (the routes
  and helpers are unit-tested; the pages are server components); no
  multi-connection concurrency test (read-only); the external-mapping fallback is
  covered only by a synthetic fixture (no real POS export exercises it).
- **Reversibility:** the whole slice (delivery + this review pass) is a single
  uncommitted working-tree change; no migration, no data written. Revert by
  checking out the touched files. When committed, split into the usual layer
  commits (`feat(domain)`, `feat(persistence)`, `feat(application)`, `feat(web)`,
  `feat(ui)`, `docs(context)`) — each independently revertible with
  `git revert <sha>`.
- **Next:** menu engineering (`RPT-005`) over synthetic fixtures; the variant
  resolution chain now exists, while the row-11 importer still never writes
  `sales_line.product_variant_id` (the mapping writer remains the data
  prerequisite for real product labels).
