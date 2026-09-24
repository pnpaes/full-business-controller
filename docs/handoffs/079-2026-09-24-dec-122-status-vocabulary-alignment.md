# 2026-09-24 — Align the `DEC-122` task slice to the schema status vocabulary (delete the translation)

`main`; HEAD **`56a072f`**. The `DEC-122` task slice is **uncommitted** at
handoff-writing time (untracked `packages/application/src/tasks/**`,
`apps/web/app/api/v1/tasks/**` and the four
`apps/web/app/(app)/tasks/**` client files; modified
`apps/web/app/(app)/tasks/page.tsx`, `packages/application/src/index.ts`,
`packages/persistence/src/repositories/workflow.ts` (+
`updateTaskStatusIfCurrent`) and `users.ts` (+ `listAssignableUsers`)). This
session is a **vocabulary-alignment fix, not a new slice**. Nothing pushed;
nothing applied to DigitalOcean. Verification at the tree (Node 22,
`DATABASE_URL=postgres://aquarela:aquarela@localhost:5432/aquarela`):
`typecheck`, `lint`, `format:check`, `build` clean; **3868/3868 tests with
`DATABASE_URL` (254 files)**; `db:migrate` a no-op on re-run (63 migrations,
89 public tables — **no migration**). The 3859-test pre-alignment baseline
grew by 9 tests (the machine test now covers 8 legal transitions and more
illegal/unknown cases). Next free decision id still `DEC-120`.

- **The problem.** The new Tasks slice spoke `done`/`cancelled`, but the live
  `task_status_check` constraint (`0050_workflow_platform.sql`) allows
  `open, in_progress, blocked, resolved, dismissed`. The slice had worked
  around this by translating `done↔resolved` and `cancelled↔dismissed` at the
  Postgres boundary, documented as a `ponytail:` ceiling. That translation made
  the domain and the UI lie about what the database stores (a report or audit
  reading the table sees `resolved`/`dismissed` while the app says
  `done`/`cancelled`). **Fixed by aligning the slice to the schema's real
  vocabulary and deleting the translation — not by migrating.**
- **The new machine** (`packages/application/src/tasks/status-machine.ts` + its
  test): `open → {in_progress, blocked, dismissed}`;
  `in_progress → {resolved, blocked, dismissed}`;
  `blocked → {in_progress, dismissed}`; `resolved` and `dismissed` are
  terminal; an unknown current status or an unlisted transition is rejected
  with a message-only `DomainError`. The vocabulary is exactly what the
  existing CHECK permits, so **no CHECK change and no migration**.
- **Files changed.**
  - Application: `status-machine.ts` (+ `status-machine.test.ts`),
    `postgres-store.ts` (the `DOMAIN_TO_STORED_STATUS` /
    `STORED_TO_DOMAIN_STATUS` maps, the `toStoredStatus`/`toDomainStatus`
    helpers and every call deleted; statuses stored verbatim), `types.ts`
    (JSDoc), `test-support.ts` (JSDoc), `assign-task.ts` (message now
    "cannot assign a task that is resolved or dismissed"),
    `tasks.test.ts`, `tasks.postgres.test.ts`.
  - Web API: `task-rows.ts` (validation via `TASK_STATUSES` — now the schema
    vocabulary), `route.test.ts`, `[id]/transition/route.ts` (+ test),
    `[id]/assign/route.ts` (JSDoc).
  - Web UI: `task-labels.ts` (+ test) now carries the transition map and
    `taskAllowedTargets(status)`; `task-filters.tsx` filter chips;
    `page.tsx` (status validation via `TASK_STATUSES`, per-row targets from
    `taskAllowedTargets`).
- **Kept unchanged (deliberately):** the atomic compare-and-set
  `updateTaskStatusIfCurrent` (correct and valuable); the access posture
  (read-for-all, write for owner/GM/admin/location_manager); the minimal
  active-`app_user` assignee read; no `task↔approval` link; no `location_id`
  on `task`.
- **Sweep result.** No `done`/`cancelled` task-status remains anywhere except
  as deliberate negative-test fixtures (a `"done"` status filter/body that must
  be **rejected**, and an unknown/legacy current status that must fail the
  guard). Unrelated domains that legitimately use `done`/`cancelled` are
  untouched: HMS corrective-action status `done`/`verified`
  (`CORRECTIVE_ACTION_STATUS`), production/scheduling `cancelled`, the
  inventory stock-count `cancelled` status, and the period-close checklist
  `done` boolean.
- **Decision text.** The `DEC-122` row in `12_OPEN_DECISIONS.md` already
  records the schema vocabulary (`open → {in_progress, blocked, dismissed}` …
  `resolved`/`dismissed` terminal), so the recorded decision and the code now
  agree; no decision edit was needed for this alignment.
- **Rollback / recovery (Rule 2).** The change is a pure, reversible code edit
  with no migration and no data write: reverting the session's edits restores
  the previous (translating) slice byte-for-byte, and the DB schema never moved
  (the CHECK already permitted the schema vocabulary). Nothing committed, so no
  history rewrite is involved.
- **Next:** commit the `DEC-122` slice (uncommitted), then resume the recorded
  next task — `DEC-120`, the row-11 `sales_line.product_variant_id` backfill
  posture (`DEC-113`/`DEC-033`/`DEC-041`/`DEC-108`/`DEC-109`).
