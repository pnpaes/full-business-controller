# 2026-09-25 — Forecast-vs-actual tracking delivered (DEC-138, row-15 override owner-authorized)

`main`; nothing pushed; nothing applied to DigitalOcean.
This slice is an **owner-authorized override** of roadmap row 15's
`blocked (data)` gate (the formal gate is I11 history/grain quality,
`DEC-011`): the forecast-vs-actual tracking slice is delivered with
accuracy that **stays honest** — `insufficient_history` below 4 completed
periods and `no_snapshot` when none exists are first-class results, and
**no fabricated number is ever shown or persisted**. Per handoff
[`082`](082-2026-09-25-integrations-registry-intg-001.md) (the Integrations
registry — do not restate it).

**What was decided and what was built.** The owner authorized the row-15
override in-session; **`DEC-138`** is recorded as **accepted
(2026-09-25, owner)**. The slice built migration `0070` (expand-only:
`forecast_snapshot` + `forecast_override`), the persistence/application
layers, the routes and the tracking screen. Grain is **`day_location`
only** — the declared category/product grains are **refused at the
port** (`requireSupportedForecastGrain`, `forecast-scope.ts`), the
`DEC-011` ceiling. Accuracy is MAPE over completed periods with
`insufficient_history` below 4; snapshots carry metric, `forecast_grain`,
scope columns, `as_of`, model and a jsonb projection
(`jsonb_typeof='array'`) with nullable accuracy; overrides are
**append-only with a mandatory reason** (DB trigger + a non-blank
check), **advisory only — never auto-applied**. Access reuses
`SALES_REPORT_READ_ROLES` for read (owner, general_manager,
location_manager, analyst, finance, admin) and `FORECAST_WRITE_ROLES`
for write/override (owner, general_manager, admin), fail-closed;
mutations carry same-origin plus the shared `DEC-135` throttle. No
external call and **no posted money or stock fact changed**.

- **Commits (chronological; each independently revertible).**
  1. `e52f4e5` `feat(forecast)`: migration
     `0070_forecast_snapshot_forecast_override.sql` (expand-only) plus
     the persistence and application layers.
  2. `7c06fdd` `feat(web)`: the routes and the tracking screen.
  3. `4ba3ced` `fix`: the review hardening.
  This handoff/`CONTEXT.md` update is a further `docs(...)` commit on top.
- **Migration `0070`.** Expand-only; the down companion is
  `0070_forecast_snapshot_forecast_override_down.sql`; the journal stamp
  is `1790370103369`; sha256
  `872068e2029c56682b4ae413862fd0771daad817c95c9d5b1286d2f2f5d2317a`.
  Public tables go **95 → 97**; `ai_analysis_run` and `reorder_policy`
  remain deliberately deferred.
- **Routes.** `GET`/`POST /api/v1/analytics/forecasts` and
  `POST /api/v1/analytics/forecasts/overrides`; the singular
  `GET /api/v1/analytics/forecast` is untouched.
- **Verification at the slice.** `typecheck`, `lint`, `format:check`
  clean; `next build` exit 0; **4873/4873 tests (349 files)** with
  `DATABASE_URL`; `0070` applied to the dev DB (a no-op re-run); the
  `0070` **down path was rehearsed on a scratch DB** (both tables
  present → absent → triggers removed → dropped) — never on the dev DB.
- **Review reconciliation.**
  `reviewer-qwen` (model `opencode-go/qwen3.7-plus`) — one **major**
  **accepted and fixed in `4ba3ced`**: a cross-organization `snapshotId`
  in `recordForecastOverride` (IDOR, `DEC-061`) — the load is now scoped
  by `(id, organizationId)` plus a grain check; a transaction-port type
  hole fixed in the same commit. Two minors **accepted and fixed in
  `4ba3ced`**: the period format was not validated in the command, and
  the snapshot/grain mismatch. Clean: accuracy correctness, append-only
  triggers, org-scoping, access, validation, honesty, no regression.
  `reviewer-minimax` (model `opencode-go/minimax-m3`) — two **majors**:
  (1) the `0070` runbook row was missing — **accepted, this docs wave**;
  (2) the `DEC-011` grain ceiling is app-only (the DB check accepts
  category/product) — **DECLINED with reason**: the DB models the full
  declared `forecast_grain` vocabulary and the implementation ceiling is
  enforced at the single port `requireSupportedForecastGrain`; no
  production path can persist an unsupported grain, and narrowing the
  check would force another migration when category/product land. Three
  minors: the `sql` re-export tag — **accepted, fixed in `4ba3ced`**;
  the `actor_id` FK deferred (already commented in-tree) — **accepted
  as recorded**, no change; `period` stored as `text` — **accepted as
  the repo's opaque-bucket pattern** (the `data_quality_exception`
  `scope` jsonb precedent), no change.
- **Browser verification PASS** (designer + Kilo-driven): at 1280/390
  `/insights` and `/insights/forecast` render the live tracking card in
  the genuine `no_snapshot` state with no fabricated number; the
  section shows grain/freshness and the management actions, and the
  override form **requires a reason** (an empty reason is refused, no
  `POST`, no row). Layout clean; screenshots read back, artifacts
  removed.
- **The honest posture.** Because I11 history is still partial, accuracy
  is only reported over at least 4 completed periods; below that the
  result is `insufficient_history`, and with no snapshot it is
  `no_snapshot` — honesty is a modelled state, never a fabricated
  figure.
- **What is deferred.** The category/product grains (the `DEC-011` auto
  promotion, awaiting I11); an automated snapshot cadence (gated on the
  `ADR-0004` worker/outbox layer, like INTG-002 publishing); accuracy
  maturing as I11 history accrues.
- **Rollback (Rule 2).** Run
  `packages/persistence/drizzle/0070_forecast_snapshot_forecast_override_down.sql`
  (destructive only to forecast snapshots/overrides; **no posted money
  or stock fact is affected**), then `git revert` each commit. See the
  reversibility-log entry appended with this handoff.
