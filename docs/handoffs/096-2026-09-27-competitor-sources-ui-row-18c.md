# 096 — 2026-09-27 — Competitor sources UI, row 18 slice 18c (`ADR-0010`, `DEC-149`)

On branch `main`; **committed** as `edf2ba9` — working tree clean, pushed. No
migration.

## What was built.

The screen over 18a's source model (row 18 is now complete: 18a sources, 18b
collector, 18c UI).

- `apps/web/app/(app)/insights/competitors/page.tsx` — a **Sources** section on
  the existing competitors screen: a terms filter chip row
  (`pending`/`approved`/`rejected`/`all`), a table (URL/identifier, competitor,
  type, mode, terms pill with a hover description, active window, rate-limit
  note) and per-row actions via the new client component. The screen calls the
  same `listCompetitorSources` the API serves, so they cannot drift.
- `competitor-source-forms.tsx` — `RegisterSourceForm` (manual opens `pending`;
  the `automated` option is offered only to the terms roles and explains it
  registers already approved, per 18a) and `CompetitorSourceActions` (Approve
  terms / Reject terms for `owner`/`admin`, Deactivate for the write roles),
  each behind a confirmation `Modal`, posting same-origin then
  `router.refresh()`; the server's `error` is surfaced.
- `competitor-labels.ts` (+ test) — `termsStatusView`/`termsFilterLabel` and the
  filter list. All content renders as plain text.

**Advisory/no-action posture:** approving terms permits automated collection
only once the collector's kill switch is on; the modal says so ("does not start
collection now"). Nothing here publishes or changes a price.

## Verification.

typecheck / lint / format:check clean; `next build` exit 0; **5249/5249 tests
(386 files)** with `DATABASE_URL`; labels test 4/4. **Browser-verified** as
`owner`: a seeded pending source rendered with its terms pill and actions, the
filter chips and the register form rendered, and the Approve-terms confirmation
modal opened with the correct copy and cancelled cleanly. The seeded row was
deleted and the screenshots removed.

## Deferred / recorded.

- No source **edit** (mode/URL) or delete: `collection_mode` is set at
  registration (18a); a manual→automated change needs a new source (URL unique)
  or a future command.
- No content-hash dedupe in the collector (18b) — repeated runs re-record
  pending observations.
- `WF-003` employee login remains **paused pending the owner's decision**.

## Rollback.

`git revert edf2ba9` — the screen is additive and every action stays gated by
the API; no migration, no posted money or stock fact touched.
