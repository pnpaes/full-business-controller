# 104 — 2026-09-28 — UX Wave 2: Workforce (`9dfb501`, `59adf31`, `929768c`)

On branch `main`; **committed** as `9dfb501` (register + employee detail, 10
files), `59adf31` (shifts / worked hours / my-shifts, 5 files) and `929768c`
(payroll / close / account security, 11 files, one file deleted). The three code
commits were unpushed when this handoff was written and are pushed together with
this docs commit. **No migration, no schema and no API change this wave.**

## What was delivered, per slice.

### Register + employee detail (`9dfb501`)

- The register's inline create card became a header **"New employee"** action
  opening a `FormModal`; the two filter-chip rows became one `FilterBar`
  (status `SegmentedControl` + location select) that preserves the existing
  `?show=`/`?location=` URL state; rows now link to the employee detail and the
  row-level **Retire** action is removed; the empty state is
  `EmptyState variant="plain"`; the rate cell uses `formatMoney`; `InfoTip`s
  cover the employment type, base rate and retirement; internal codes are gone
  from user-visible copy.
- **The audit's blocker** — `Retire` rendering as a full-width bar inside the
  read-only profile card — is fixed: it now lives in a separate **"Danger zone"**
  card whose confirmation states the consequence (marked retired, off the active
  register and shift assignment, record kept, not a deletion) **before** the
  button. Edit moved to a header action opening a `FormModal`, the profile
  renders as a `DescriptionList`, and shifts / worked hours / personnel documents
  are `Collapsible` sections. The two equal `KpiCard`s became one `MetricBand` +
  `MetricHero` (worked hours) with a base-rate `MetricSecondary`.
- **`DEC-151` is unchanged:** the role is a fixed select, positions a
  multi-select, self-assignment stays strict and a manager override is still
  recorded.

### Shifts / worked hours / my-shifts (`59adf31`)

- **Shifts:** "Plan shift" is a header action opening the create form in a
  `FormModal`; the inline form card and the blue alert band are gone (the caveats
  became `InfoTip`s); the roster window is stated once with an `InfoTip` carrying
  the UTC-calendar-day rule; the pending self-assignment queue uses the plain
  empty state so no box nests inside the card.
- **Worked hours:** one `MetricBand` + `MetricHero` for total hours with a
  separate employees count replaces the two equal KPI cards; a `FilterBar`
  replaces the filter card; dates render as ISO text; the cells use
  `formatNumber`/`formatMoney`/`groupDecimal`; `InfoTip`s explain the `HALF_UP`
  rounding and the derivation.
- **My shifts:** the roster action is a real secondary button inside the
  permission card and the page carries a scope header. The weekly-cap and
  pending-approval `InfoTip`s live in the linked-employee branch, which the
  `owner` login cannot render — **verified by code path only** (below).
- **`DEC-151` untouched:** self-assignment stays strict (the employee must hold
  the shift's position) and a manager override is still recorded.

### Payroll / close / account security (`929768c`)

- **Payroll list:** "Generate a report" is a header action opening a `FormModal`;
  the `DEC-104` caveat is an `InfoTip` rather than copy; the register's empty
  state is the plain variant. **Payroll detail:** one `MetricBand` + `MetricHero`
  (expected pay) with hours and lines as secondaries replaces the card wall;
  `InfoTip`s cover supersede, `HALF_UP`, the snapshot schema and the
  pre-month-end gate; export moved into a `FormModal` with a `FileField` and
  confirms with a `SuccessToast`.
- **Close:** "Begin close" opens in a `FormModal`. Locking and reopening are
  irreversible, so they are separated from the routine reading surface into their
  own section, each behind a confirmation stating the consequence **before** the
  button, with reopening requiring a reason; mutations refresh via a toast; the
  register's empty state is the plain variant. The superseded
  `close-actions.tsx` is **deleted** (no references remain; replaced by
  `close-state-actions.tsx`).
- **Account security:** the `Account` breadcrumb is restored, TOTP and the
  session rules are explained with `InfoTip`s, and disabling MFA states its
  consequence before the button.

## Verification (the integrator's, verbatim).

`typecheck` / `lint` / `format:check` clean; `next build` exit 0; the full suite
**5492/5492 (404 files)**; `db:migrate` a no-op (no migration this wave).

## Independent acceptance outcome.

An independent pass checked **19 criteria: 17 PASS with file:line evidence**, 2
declared **unverifiable here**, and 1 FAIL **declined as a false positive**:

- *Unverifiable 1:* the `my-shifts` weekly-cap / `pending_approval` `InfoTip`s sit
  in the linked-employee branch the `owner` login cannot render.
- *Unverifiable 2:* there is no separate session-revocation feature to check.
- *Declined false positive, with evidence:* the close register **does** render the
  plain empty state — `close-register-table.tsx:29-37` returns
  `<EmptyState variant="plain" title="No closes yet">`, and `close/page.tsx:205`
  renders `<CloseRegisterTable rows={rows} />`. The verifier inspected only the
  page, not the component.

Every browser claim in the wave was verified by **reading the captures**.

## Honest limits still open.

- The roster assign form cannot pass a manager `override`, so the `DEC-151`
  override path stays **backend-only** (pre-existing).
- `/close` still shows three equal `KpiCard`s rather than a hero status.
- The payroll-detail export card is not lifted under the hero.
- The snapshot metadata is not collapsed by default.

## A real defect found in a Wave 0 primitive.

`SelectField`'s help text overlaps the control border
(`packages/ui/src/patterns.tsx`). It affects **every** field, so it belongs in the
reconciliation wave, not in an area slice.

## Dev-DB rows created this wave (cleanup).

- `employee` `734ca711-f6cc-4861-b86d-6bca7029234d` ("Demo Employee Modal", owner
  org).
- Payroll report `155cadaa-ea8a-4e6c-83ac-7f5dee48b86f`.

The audit's earlier payroll seed `6af7cb2a-…` no longer resolves in the owner org,
so detail routes must be reached with data the app itself creates.

## Incident and lesson (it changes how the next session briefs workers).

The wave was interrupted by an upstream **"Account budget exceeded"**. At that
moment **2a had zero edits** and **2b/2c had partial, never-verified edits**.
Recovery was three `general` agents that first made the inherited edits compile,
then completed the plan. Two rules follow:

1. A partial wave must never be left without a **written inventory and a revert
   path**.
2. In this configuration the **`designer` and `writer` agent types have no write
   tools and no shell**, so implementation, docs and commits go to **`general`**,
   with browser evidence either produced by a `general` or checked by the
   coordinator reading the captures.

## Reconciliation queue (open).

1. A `countJobs`-by-status read in
   `packages/persistence/src/repositories/jobs.ts` (+ re-export), consumed by
   `apps/web/app/(app)/jobs/page.tsx`.
2. A shared `AreaTabs` replacing the now-**third** copy of the tab strip
   (`administration/tabs.tsx`, `costs/tabs.tsx`).
3. Promote `formatJobAge` to a shared formatter if reused.
4. Drop Home's legacy `MetricBand` export (`insights/page.tsx` imports it from
   `home-modules.tsx`).
5. Fix the `SelectField` help-text overlap (`packages/ui/src/patterns.tsx`).
6. Promote `/close` to a hero and finish the payroll-detail polish.

## Rollback.

`git revert` each of `9dfb501`, `59adf31` and `929768c` **independently** — app
route UI only, no schema, API, data or migration change in any of the three, so
each reverts on its own with no data step. `929768c` additionally restores the
deleted `close-actions.tsx`. This docs commit also reverts on its own (docs only).
