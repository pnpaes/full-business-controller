# 089 — 2026-09-27 — The jobs operator screen (`/jobs`)

On branch `main`; **committed** as `2796411` — working tree clean, **pushed**
to `origin/main`, nothing applied to DigitalOcean. No migration, no new
dependency.

## What was decided and what was built.

The jobs layer had an API (`GET /api/v1/jobs`, `/api/v1/jobs/[id]`, and the
`retry`/`discard` mutations) but no operator surface, so the manual weekly DLQ
review still meant reading SQL. This closes that gap with the first-party
screen.

- `apps/web/app/(app)/jobs/page.tsx` — a server page mirroring `close/page.tsx`:
  `getServerSession()` → `/login`, the `JOBS_READ_ROLES` gate (fail-closed with
  an explicit "not available for your role" state), a status filter defaulting
  to **`dead_lettered`** (the weekly review queue), a bounded page (50) with a
  simple offset pager, and an org-scoped `listJobs` read — the same persistence
  read `GET /api/v1/jobs` serves, so the screen and the API cannot drift.
- `apps/web/app/(app)/jobs/jobs-register.tsx` — the client register: status pill
  (labels module), kind, queue, `attempts/maxAttempts`, created/finished
  timestamps. It **never renders `payload` or `error`** (the API omits them
  too). Retry and Discard appear only on `dead_lettered` rows and only when the
  caller holds `JOBS_ADMIN_ROLES`; each opens a confirmation modal and POSTs to
  the existing routes, then `router.refresh()`.
- `apps/web/app/(app)/jobs/jobs-labels.ts` (+ test) — pure status→tone/label and
  timestamp helpers (the `close-labels.ts` precedent); the only new test.
- `apps/web/app/(app)/shell-nav.tsx` — a "Jobs" entry in `AREAS`.

## Commit basis.

Single commit `2796411` (`feat(web)`); reverts independently.

## Verification.

`npm run typecheck`, `npm run lint`, `npm run format:check` clean;
`npm run build` exit 0 (the `/jobs` route emits); `DATABASE_URL=… npm run test`
→ **5081/5081 (369 files)**; the labels test is 6/6. **Browser-verified** as
`owner` against the dev server: the dead-lettered default view renders a seeded
row (pill, `5/5` attempts, queue/kind, created time) with the filter chips and
the nav entry; the Discard confirmation modal renders and cancels cleanly
without mutating the row; the `succeeded` filter shows the empty state. The
seeded row was deleted afterwards.

## Deferred / recorded.

- The screen polls on navigation (`router.refresh()` after an action); there is
  no live auto-refresh — a polling client is a later nicety.
- The wide table keeps a designed horizontal scroll rather than a responsive
  card layout.
- `DEC-104` items 5/9/10 remain open; `JOBS_READ_ROLES`/`JOBS_ADMIN_ROLES` remain
  provisional (`DEC-101`); INTG-002 publishing stays gated on I15/I18 under
  `DEC-015`; the Terraform HCL is unvalidated until CI has the binary.

## Rollback.

`git revert 2796411` — the screen is additive and every action stays gated by
the API, so removing the page cannot weaken the server. No business row and no
posted money or stock fact is touched.
