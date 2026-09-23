# 2026-09-23 — The daily (location, day) close exposed operator-driven (`DEC-119`)

`main`; HEAD before this slice's docs commit is **`a1c9ee7`** (the `DEC-118`
docs commit). The slice lands as the `docs(decisions)`, `test(application)`,
`feat(web)` and this `docs(context)` handoff commits (uncommitted at
handoff-writing time; the orchestrator commits the layers). **No backend
production code changed** — no command, route, schema or gate change; no new
API route. Nothing pushed; nothing applied to DigitalOcean. Verification at
the tree (Node 22,
`DATABASE_URL=postgres://aquarela:aquarela@localhost:5432/aquarela`):
`typecheck`, `lint`, `format:check`, `build` clean (the new `ƒ /close` route
listed); **3648/3648 tests with `DATABASE_URL` (240 files)**;
`npm audit --omit=dev` = 0; `db:migrate` a no-op on re-run through `0062`;
**89 tables** (**no migration**). The baseline before the slice was
3640/3640 (239 files); the slice added the labels test file and 7 more tests.
(An earlier full-suite run under heavy load reported two file-level failures
with all tests passing; a clean re-run gave 240/240 files and 3648/3648
tests — a transient load artefact, not a regression.) Next free decision id
`DEC-120`.

- **Delivered (`DEC-119`).** Research found the backend already complete —
  `beginPeriodClose`/`lockPeriodClose` accept both scopes
  (`packages/application/src/close/{begin-period-close.ts,
  lock-period-close.ts}`), `resolveClosePeriod` derives the window
  (`packages/domain/src/period-close.ts`), and the API routes exist under
  `apps/web/app/api/v1/close/**` — but there was **no close UI at all**, so an
  operator could not create or lock a location daily close and the `DEC-117`
  reversal gate's location arm was unreachable in practice. Resolved as a
  UI-plus-tests slice.
  - **Web** (`feat(web)`) — a new `/close` register UI under
    `apps/web/app/(app)/close/`: `page.tsx` (a server page gating on
    `PERIOD_CLOSE_READ_ROLES`), `begin-close-form.tsx` (a begin form with a
    location selector filtered to the caller's allowed locations plus a
    `periodStart` day, and a role-gated company month option), a close
    register table + row actions (`close-register-table.tsx`,
    `close-actions.tsx`) with a lock action and a reopen action carrying a
    **mandatory** reopen reason, and `close-labels.ts` (+ `close-labels.test.ts`)
    mapping the `PERIOD_CLOSE_STATUS`/`PERIOD_CLOSE_SCOPE_TYPE` vocabularies.
    `scopeLimited` (the `DEC-107` organization-wide prerequisite evaluation)
    is surfaced in the UI, not hidden. Wiring: a `Close` nav entry in
    `apps/web/app/(app)/shell-nav.tsx` and a tasks-page pointer in
    `apps/web/app/(app)/tasks/page.tsx`.
  - **Application tests** (`test(application)`) — a **joining test** (unit +
    Postgres) in `packages/application/src/sales/{sales.test.ts,
    correct-sales-line.postgres.test.ts,test-support.ts}` that creates and
    locks a location close through the **real** `beginPeriodClose`/
    `lockPeriodClose` commands and proves `correctSalesLine` is then
    **blocked** for that location and day, while another location is allowed —
    the `DEC-117` gate's location arm is live, not fake-seeded. Test-only
    application changes (the fake wiring); no production code.
  - **Decision** (`docs(decisions)`) — `DEC-119` recorded in
    `12_OPEN_DECISIONS.md` (both tables), provisional pending owner/OPS
    confirmation: closes stay operator-driven (an explicit begin + lock, no
    scheduler); the `company` month close is offered only to
    `PERIOD_CLOSE_COMPANY_WRITE_ROLES`; `scopeLimited` is surfaced;
    recorded-not-fixed: the close **list** route is not location-filtered for
    a scoped caller (`DEC-105` provisional), there is no route exposing
    `isPeriodLocked`, and the `open` status stays unreachable through the API
    by design.
  - **No migration was needed and no backend production code changed** — the
    backend already supported both scopes end to end; the slice adds only a
    screen over the existing `period_close` schema object, so there is no
    schema object to add. Schema stays through `0062`, 89 tables.
- **Review:** two reviewers (`reviewer-qwen` adversarial, `reviewer-glm`
  code-level). **No blockers, no majors, and only two trivial minors, both
  declined.** Both verified: the joining tests drive the **real**
  `beginPeriodClose`/`lockPeriodClose` (a falsification check — removing the
  lock made the gate allow — confirmed the lock is what blocks); the
  Postgres test executes rather than skips; the "another location allowed"
  control is non-vacuous; the access gate is server-side (not merely hidden
  UI); the location selector is filtered to the caller's allowed locations;
  the company option is role-gated; the begin body matches the API exactly;
  `scopeLimited` is visible; the labels match the
  `PERIOD_CLOSE_STATUS`/`PERIOD_CLOSE_SCOPE_TYPE` vocabularies; the backend is
  untouched (no command, route, schema or gate change; no new route); and the
  decisions file's rows are intact. **Declined with reasons:** (a) an N+1
  `findUserById` bounded by ≤100 register rows — bounded and material for
  this screen only; (b) an exported `CloseTone` props type with no external
  importer — a harmless preview-typing export.
- **Reversibility:** each layer commit is independently revertible with
  `git revert <sha>`
  — the web layer reverts the screen, the nav/tasks wiring and the labels
  module (the API and commands remain usable directly); the test layer
  reverts only coverage; the decisions commit reverts `DEC-119`'s rows.
  **No migration, no schema change and no data written by the slice**
  (migrations stay through `0062`; **89 tables**): creating and locking a
  close through the UI is an ordinary operator action writing normal
  append-only `period_close` rows, not a slice side effect. **No backfill.**
  `db:migrate` is a no-op on re-run through `0062`. Nothing pushed; nothing
  applied to DigitalOcean.
- **Next:** `DEC-120` — the row-11 backfill posture. `DEC-113` wired the
  sales-import mapping writer, so **new** imports populate
  `sales_line.product_variant_id`, but every already-posted `sales_line`
  keeps a null variant id, so the `DEC-108`/`DEC-109` reporting variant chain
  still resolves those rows by SKU/`external_mapping` only. Objective: decide
  and either (a) implement an **idempotent, reversible** backfill that
  resolves historical `sales_line.product_variant_id` from the existing
  SKU/`external_mapping` data (dry-run first, batched; an update of a derived
  column, not a posted money fact), or (b) record a **no-backfill** posture
  with the reason — and record it as **`DEC-120` in both tables of
  `12_OPEN_DECISIONS.md` before or with the implementation** (Rule 3; next
  free id). Read `DEC-113`, `DEC-033`, `DEC-041`, `DEC-108`, `DEC-109`, the
  mapping writer (`packages/application/src/imports/map-import-rows.ts`), the
  variant-resolution chain (`packages/application/src/reporting/**`,
  `packages/persistence/src/repositories/reporting.ts`) and the `sales_line`
  schema first; keep it additive and reversible, with a `.test.ts` per
  branch, and commit in layers with the rollback approach in the body.
  Record explicitly whether updating a derived column on a posted row is
  compatible with the append-only rule (it is not a financial or stock fact)
  or whether the resolution must instead happen at read time. Then the
  `DEC-116`/`DEC-117`/`DEC-118` follow-ups (recomputing the transaction
  header at posting time, partial/delta corrections, a persisted reversal
  reason or `adjustment_period` link, gating the exported `reverseSalesLine`,
  an approval/override path, channel-precise reconciliation matching); the
  `DEC-119` recorded-not-fixed items (the period-close list route's missing
  location filter, no route for `isPeriodLocked`); the remaining close-outs
  (`denominator_source` DB CHECK, per-channel packaging, the cost-card
  version chain, the per-item override, `behavior` filtering, partial-window
  proration); and the test-deployment rehearsal / golden-fixture sign-off
  (parked on owner inputs).
