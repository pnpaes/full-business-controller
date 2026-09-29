# 105 — 2026-09-28 — UX reconciliation wave (`6011fe6`)

On branch `main`; **committed** as a single commit `6011fe6` (17 files: 16
modified, 1 new). The **reconciliation queue** recorded in handoffs `103`
(Wave 1) and `104` (Wave 2) is **fully delivered**; the accompanying docs commit
lands on top. **No migration, no schema and no API change.**

## What was delivered, per priority.

The queue (handoff `104`, "Reconciliation queue") had six items; this wave
delivered all six in priority order, keeping the tree compiling at each step.

### P1 — Field help/message spacing

`FieldMessage` (`packages/ui/src/patterns.tsx`), the `CheckboxField` help and the
`TextField` message (`packages/ui/src/components.tsx`) each gained a `spacing[1]`
top margin, so the error/help text sits clear of the control's bottom border.
**Honest correction:** the reported "overlap" was **not** text painted over the
border — measured, the control-to-help inset was a too-tight **4 px**; it is now
**8 px**. Verified in the `/close` "Begin a close" modal and the `/styleguide`
field specimens.

### P2 — Real job counts

`countJobsByStatus` added to `packages/persistence/src/repositories/jobs.ts` (one
grouped `count(*)` plus the oldest `created_at` per status, org-scoped;
re-exported by the barrel) and consumed by `/jobs`. The capped fetch, the "50+"
chip, the "first 50 shown" and "exact count" workarounds are gone — the
dead-letter hero and every status chip show true counts. New
`packages/persistence/src/repositories/jobs.postgres.test.ts`.

### P3 — One `MetricBand` from the shared package

`insights/page.tsx` imports `MetricBand` from `@aquarela/ui`; the legacy
`MetricBand`/`MetricBandItem` export and its dead CSS were removed from
`home-modules.tsx`.

### P4 — `formatRelativeAge`

`formatJobAge` was promoted from `apps/web/app/(app)/jobs/jobs-labels.ts` into the
shared `packages/ui/src/format.ts` as `formatRelativeAge` (output unchanged:
`just now` / `Xm` / `Xh` / `Xd`, future clamped; its tests moved with it). `/jobs`
consumes the shared version and no longer owns the helper.

### P5 — Shared `AreaTabs`

`AreaTabs` + `areaTabActiveHref` extracted into `packages/ui/src/patterns.tsx` as
a pure, next-free component (longest exact/parent-prefix match, `pathname` passed
in) and rendered in `/styleguide`; `administration/tabs.tsx` and `costs/tabs.tsx`
migrate to it with identical URLs, labels and active behaviour. **Honest
correction:** only **two** literal copies existed — `sales/**` and `insights/**`
already composed the shared `Tabs` primitive, so nothing was forced there.

### P6 — `/close` hero + payroll-detail polish

`/close` gets one `MetricBand` hero (closing) with locked/reopened secondaries
instead of three equal `KpiCard`s; in the payroll detail the export card moves
directly under the hero and the snapshot metadata collapses by default.

## Verification.

`format:check` / `typecheck` / `lint` clean; `next build` exit 0; the full suite
**5496/5496 (405 files)** — up **+4 tests / +1 file** from the new
`jobs.postgres.test.ts`; `db:migrate` a no-op. Every visible change was verified
in the browser by reading the captures.

## Honest corrections.

- The `SelectField` help-text "overlap" is a too-tight 4 px control→help inset,
  now 8 px — not text over the border.
- Only two literal tab-strip copies existed (`administration`, `costs`); `sales`
  and `insights` already used the shared `Tabs` primitive, so the reconciliation
  did not migrate them.

## Remaining.

The reconciliation queue is **fully delivered**; nothing from it remains. The
remaining UX work is the area waves — Wave 3 (Inventory / Purchasing / Production)
onward, per `docs/ux/reviews/README.md`.

## Rollback.

`git revert 6011fe6` — UI plus one additive persistence read (`countJobsByStatus`);
**no migration, schema or API change**, and no posted money or stock fact is
touched. This docs commit reverts on its own (docs only).
