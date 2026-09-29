# 103 — 2026-09-28 — UX Wave 1: Home, Jobs, Administration (`f694d4d`, `5ab6e4e`, `86b26cb`)

On branch `main`; **committed** as `f694d4d` (home, 2 files), `5ab6e4e` (jobs,
4 files incl. a 9-test `jobs-labels.test.ts`) and `86b26cb` (administration,
13 files, 9 new). The three code commits were unpushed when this handoff was
written and are pushed together with this docs commit. **No migration, no schema
and no API change this wave.**

## What was delivered, per slice.

### Home (`f694d4d`)

- The question-plus-chart focal module and the four-equal-KPI wall became **one
  ranked `MetricHero`** (net sales plus a day-over-day delta) whose `InfoTip`
  carries the former `DEC-063`/`RPT-003` contribution definition, so the decision
  code no longer leaks into user copy.
- The location comparison and the exceptions queue became `Collapsible`, collapsed
  by default.
- Wave 0 formatters are applied to every money/number/axis value; the empty state
  is `EmptyState variant="plain"`.

### Jobs (`5ab6e4e`)

- The dead-letter queue is the ranked hero (`MetricBand`/`MetricHero`: exhausted
  retries, kept 30 days, weekly review) with the retention/review rationale in an
  `InfoTip`, so `DEC-139` no longer leaks into user copy; Running is secondary.
- A status-vocabulary `InfoTip` on the filter chips; "offset 0" → "page 1".
- Retry and Discard each get an `InfoTip` plus a confirmation stating the
  consequence **before** the button; `SuccessToast` on completion; a plain empty
  state; `formatNumber` for counts; a new jobs-local `formatJobAge`.

### Administration (`86b26cb`)

- One ~7,700 px page of eight stacked sections became a **hub** (page header +
  section tabs + six area cards with live counts, **812 px measured**) with
  per-area sub-routes `users`, `integrations`, `tax-rules`, `units`,
  `data-quality` and `audit`; the 50-row audit log moved to `/administration/audit`.
- The three inline `<details>` create forms became `FormModal`/`Modal` plus
  `SuccessToast`.
- A real defect was found and fixed in the follow-up pass: the integration create
  path wrapped the form-rendering `IntegrationForm` in `FormModal` (a nested
  `<form>`); it now uses the plain `Modal`, and two unused imports were removed.

## Verification (the integrator's, verbatim).

`format:check` / `typecheck` / `lint` clean; `next build` exit 0 ("Compiled
successfully in 13.4s"); the full suite **5492/5492 (404 files)** in one run with
no flake; `db:migrate` a no-op (no migration this wave); `storage/tmp/` empty; no
stray artifacts; wave diffstat **694 insertions / 930 deletions (net −236)**.

## Honest limits.

- **Home:** verified in the **empty** state (the dev DB is empty); the
  **before-screenshot was not captured**; the delta chip needs ≥2 days of data; and
  a legacy `MetricBand` export was **kept in `home-modules.tsx`** because the
  out-of-scope `apps/web/app/(app)/insights/page.tsx` imports it from there.
- **Jobs:** `listJobs` has no count query, so the hero derives its counts from a
  bounded fetch (51 rows → "50+") and says so in the meta; `formatJobAge` is
  jobs-local; the dev DLQ is empty, so the hero was verified at zero.
- **Administration — remaining polish:** `EmptyState variant="plain"` in
  `tax-rule-register.tsx` / `user-access-manager.tsx`, and `InfoTip`s on tax
  applicability/basis, conversion direction, and the integration write-terms gate.

## Cross-cutting needs reported (deliberately not done — the reconciliation queue).

1. A `countJobs`-by-status read in
   `packages/persistence/src/repositories/jobs.ts` (+ re-export), consumed by
   `apps/web/app/(app)/jobs/page.tsx` and optionally
   `apps/web/app/api/v1/jobs/route.ts`.
2. The duplicated `Tabs` config (audit cross-cutting finding #5) —
   `administration/tabs.tsx` is now a **third** copy of the `costs/tabs.tsx`
   pattern, so a shared `AreaTabs` belongs in a Wave 0b.
3. Promote `formatJobAge` to a shared formatter if any other screen needs relative
   time.
4. Home's legacy `MetricBand` export exists only for `insights/page.tsx`.

## Process lesson (it changes how the next session briefs workers).

Every `designer` agent in Waves 1–2 exhausted its step budget **during
reconnaissance with zero edits**: it read the area's ~10 files plus `packages/ui`
and the styleguide before writing anything. What worked was **resuming with the
plan fully inlined**, with docs/styleguide/`packages/ui` reads **explicitly
forbidden** and a stop-safe order where each step leaves the tree compiling. The
conclusion for future waves: **one `general` agent implements with the plan
inlined, and a separate visual pass produces the browser evidence**; briefs must
inline the **Wave 0 primitive API map** (`packages/ui/src/shell.tsx` `MetricHero`
:291, `MetricSecondary` :397, `MetricBand` :435, `SectionCard` :499,
`EmptyState` :590; `info-tip.tsx`; `modal.tsx` `FormModal`; `toast.tsx`
`SuccessToast`; `patterns.tsx` `Collapsible` :486, `Tabs` :949, `DataTable` :667,
`FilterBar` :729, `DescriptionList` :838, `FormSection`/`FormActions` :873/:907,
`FileField` :447; `format.ts` `groupDecimal` :85, `formatNumber` :93,
`formatMoney` :104, `formatAxisValue` :111, `axisLabel` :125). Also note the
tooling fact: the `designer` and `writer` agent types have **no write tools/shell**
in this configuration, so docs and commits go to `general`.

## Rollback.

`git revert` each of `f694d4d`, `5ab6e4e` and `86b26cb` **independently** — no
migration, no schema change and no API change in any of the three, so each reverts
on its own with no data step. This docs commit also reverts on its own
(`git revert` the docs commit; docs only).
