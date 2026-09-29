# Reversibility log

- **2026-09-28 UX Wave 2 (`9dfb501`, `59adf31`, `929768c`; pushed)**: the three
  code commits (workforce register + employee detail; shifts / worked hours /
  my-shifts; payroll / close / account security) are UI/composition refactors of
  existing screens — **no migration, no schema change and no API change**, so
  each reverts **independently** with `git revert <sha>` and needs **no data
  step**. `929768c` also deletes the superseded `close-actions.tsx`, which the
  revert restores; the other two commits are additive or in-place UI edits only.
  The docs-only commit on top reverts on its own too. No posted money or stock
  fact is touched. Details:
  [handoff 104](104-2026-09-28-ux-wave-2-workforce.md).
- **2026-09-28 UX Wave 1 (`f694d4d`, `5ab6e4e`, `86b26cb`; pushed)**: the three
  code commits (home, jobs, administration) are UI/composition refactors of
  existing screens — **no migration, no schema change and no API change**, so
  each reverts **independently** with `git revert <sha>` and needs **no data
  step**. The docs-only commit on top (`docs: record UX Wave 1 …`) reverts on its
  own too. No posted money or stock fact is touched. Details:
  [handoff 103](103-2026-09-28-ux-wave-1-home-jobs-administration.md).
- **2026-09-28 UX wave (`d943326`, `dcb284a`, `f6a73c1`; pushed)**: Wave 0 is
  additive in `packages/ui` (+ the styleguide); `0080_role_position.sql` adds the
  role FK, `position`, `employee_position` and `shift.position_id` and its down
  drops them (the role-code normalisation is **not** reverted — take a backup);
  the defect commit is additive route boundaries plus copy-only changes. Scratch
  DS rehearsed for `0080`; no posted money or stock fact is touched. Commits
  revert independently. Details:
  [handoff 102](102-2026-09-28-session-compaction-ux-programme.md).
- **2026-09-28 Stock-item purpose (`DEC-150`, `7427b43`; pushed)**: migration
  `0079_item_purpose.sql` (nullable add → backfill from `ITEM_TYPE` → NOT NULL +
  check + index, plus the forward-only `product_variant` guard) and its down
  companion. **Migration rollback** = the down file (drops the guard, the index
  and the column; operator re-classifications are lost, so take a backup),
  rehearsed on a **scratch DB** (column + index + trigger present → down →
  absent, 103 public tables intact), never the dev DB. **Rollback** =
  `git revert 7427b43`; existing variant links are unaffected and no posted money
  or stock fact is touched. Details:
  [handoff 101](101-2026-09-28-item-purpose-dec-150.md).
- **2026-09-27 M1 regression gates (`d818583`; pushed)**: the migration-chain
  rehearsal, the day-one bootstrap smoke, the E2E smoke and the env-drift test —
  all additive test/CI files plus the 13 env-documentation additions (commented,
  value-less). **No migration.** Rollback = `git revert`; nothing in the app
  changes. The chain gate itself is the machine-check proof that every
  migration's down applies in reverse (76/76 on a scratch DB). Details:
  [handoff 100](100-2026-09-27-m1-day-one-and-smoke-gates.md).
- **2026-09-27 Follow-ups: invite-accept page, self-assign race guard, AI cost
  pricing (`38797a1`, `21f9687`, `17095cc`; pushed)**: the invite page is
  additive; the race guard is a stricter concurrency behaviour with no schema or
  data change; the pricing change makes `cost_estimate` real and is reverted by
  the commit **plus** unsetting `LLM_PRICE_*` (which returns it to `null`).
  **No migration** in any of the three. No posted money or stock fact is touched.
  Details: [handoff 099](099-2026-09-27-invite-page-race-guard-ai-pricing.md).
- **2026-09-27 WF-003 employee login + self-assignment, and competitor capture
  idempotency + source editing (`d5193d3`; pushed)**: two migrations and their
  downs in one commit — `0077_user_invite.sql` (new `user_invite` + nullable
  `app_user` invite columns) and `0078_competitor_observation_content_hash.sql`
  (nullable `content_hash` + a partial unique index). Each migration's down was
  rehearsed on a **scratch DB** (`0077`: table + columns present → down →
  absent, 102 public tables remained; `0078`: column + partial index present →
  down → absent, 103 tables and `competitor_source`'s 18 columns intact), never
  the dev DB. **Rollback** = run both down files (no `app_user`/session/reset/
  observation row and no posted money or stock fact is touched) then
  `git revert d5193d3` — the commit carries both slices because the migrations
  share the drizzle `_journal.json`, so a partial revert would strand a journal
  entry. Details: [handoff 097](097-2026-09-27-wf-003-employee-login-self-assignment.md),
  [handoff 098](098-2026-09-27-competitor-idempotency-and-source-edit.md).
- **2026-09-27 Competitor sources UI, row 18 slice 18c (`edf2ba9`; pushed)**:
  the Sources section on the competitors screen + the source forms/actions and
  the terms labels. **No migration.** Rollback = `git revert edf2ba9` — the
  screen is additive and every action stays gated by the API. No posted money or
  stock fact is touched. Details:
  [handoff 096](096-2026-09-27-competitor-sources-ui-row-18c.md).
- **2026-09-27 Competitor collector, row 18 slice 18b (`ADR-0010`, `DEC-149`;
  uncommitted authoring)**: the `competitor-collector.ts` client (robots,
  per-host delay, budget, backoff, fact extraction, content hash) and the
  `outbox.maintenance.competitor_collection` cron. **No migration.**
  **Rollback** = `git revert` the slice, or set `COMPETITOR_COLLECTION_ENABLED=false`
  for an immediate stop (the cron is registered but makes no request while off).
  Observations already written stay `pending` and can be rejected; nothing is
  auto-published or applied and no posted money or stock fact is touched.
  Details: [handoff 095](095-2026-09-27-competitor-collector-row-18b.md).
- **2026-09-27 Competitor sources, row 18 slice 18a (`ADR-0010`, `DEC-143`,
  `DEC-149`; uncommitted authoring)**: migration `0076_competitor_source.sql`
  (new `competitor_source` + nullable `competitor_observation` extensions) and
  its down companion, plus the application commands and the sources routes.
  **Migration rollback** = the down file (drops the five §4C columns and the
  table; the `DEC-126` competitor/observation data stays intact), rehearsed on a
  **scratch DB** (table + columns present → down → absent, 15 pre-existing
  observation columns remained), never the dev DB. **Rollback** = `git revert`
  — no collector or external write exists yet, and no posted money or stock fact
  is touched. Details:
  [handoff 094](094-2026-09-27-competitor-sources-row-18a.md).
- **2026-09-27 AI advisory, row 17 (`ADR-0009`, `DEC-142`; uncommitted authoring)**: migration
  `0075_ai_advisory.sql` (two tables, append-only run + mutable suggestions) + its down companion,
  the application/HTTP review foundation and the `/ai` screen, plus the `LlmPort` adapter and the
  `outbox.maintenance.ai_advisory` cron. **Migration rollback** = the down file (drops the triggers
  then both tables; no posted money or stock fact), rehearsed on a **scratch DB** (tables +
  triggers present → down → absent, 99 tables remained), never the dev DB. **Rollback** =
  `git revert` — the cron ships disabled (`AI_ADVISORY_ENABLED` default false) and makes no external
  write; approving a suggestion triggers no action. Details:
  [handoff 092](092-2026-09-27-ai-advisory-row-17-adr-0009.md).
- **2026-09-27 Password reset via SendGrid (`DEC-147`; uncommitted authoring)**:
  the `MailPort` seam, the SendGrid v3 adapter (`apps/web/lib/mail.ts`), the
  `deps.ts` wiring and the three optional env vars. **No migration.** Rollback =
  `git revert` the slice — the request then mints and stores the token but sends
  nothing (the pre-slice deferred behaviour). No schema change; no posted money
  or stock fact is touched; the token is never logged and never placed in a URL.
  Details: [handoff 091](091-2026-09-27-password-reset-sendgrid-dec-147.md).
- **2026-09-27 Receipt → stock ledger (`50b231e`; pushed)**: `feat(inventory,receiving)`
  + migration `0074_receipt_stock_ledger_area.sql` (two expand-only nullable FKs
  plus two cross-location coherence guards) and its down companion. **Migration
  rollback** = run the down file (drops the guards then the columns; no
  `stock_movement` or other ledger row is touched), rehearsed on a **scratch DB**
  (columns + triggers present, guards reject cross-location values, down applied,
  columns/triggers absent, 99 tables remain), never the dev DB. **Rollback** =
  `git revert 50b231e` — pre-`0074` receipts revert to posting nothing. No posted
  money or stock fact is edited; the new movements are ordinary ledger appends.
  Details: [handoff 090](090-2026-09-27-receipt-to-ledger-dec-145.md).
- **2026-09-27 Jobs operator screen (`2796411`; pushed)**: `feat(web)` — the
  `/jobs` server page + client register + labels, and the nav entry. No
  migration, no dependency. **Rollback** = `git revert 2796411`; the screen is
  additive and every action stays gated by the API, so removing the page cannot
  weaken the server. No business row and no posted money or stock fact is
  touched. Details: [handoff 089](089-2026-09-27-jobs-operator-screen.md).
- **2026-09-27 DLQ review automation + DB-backed worker heartbeat
  (`918b80a` + `d070983`; pushed)**: (1) `feat(jobs,web)` `918b80a` — the
  dead-letter commands (`retryDeadLetteredJob` / `discardDeadLetteredJob`),
  the persistence resets/clears, and the `GET /api/v1/jobs` +
  `/retry` + `/discard` routes; **rollback** = `git revert` (additive;
  retry/replay are id-deduped on `outbox_event.id`). (2) `feat(jobs)`
  `d070983` — migration `0073_worker_heartbeat.sql` + down companion
  (`DROP TABLE worker_heartbeat`), the heartbeat writer and the monitor
  check; **migration rollback** = run the down file (liveness state only),
  rehearsed on a **scratch DB** (table present → down → absent), never the
  dev DB. No business row and no posted money or stock fact is touched.
  Details: [handoff 088](088-2026-09-27-dlq-review-automation-and-worker-heartbeat.md).
- **2026-09-27 Job retention index + scheduled delivery (`94bd965` +
  `d3602d0`; pushed)**: (1) `feat(persistence)` `94bd965` — migration
  `0072_job_org_created_at_idx.sql` (expand-only index on
  `job (organization_id, created_at)`) + `0072_job_org_created_at_idx_down.sql`
  (drops the index; no row touched) + snapshot/journal + the runbook row.
  **Migration rollback:** run the down file — the index only, no table and no
  row; rehearsed on a **scratch DB** (index present → down applied → index
  absent while `job` and its other two indexes stayed), never the dev DB.
  (2) `fix(jobs)` `d3602d0` — `OutboxDispatchEvent.scheduledAt` reaches
  pg-boss `startAfter`, and `replayUnpublishedOutbox` preserves the
  projection's schedule; **rollback** = `git revert` (additive: unscheduled
  events keep the immediate path). No posted money or stock fact is touched.
  Details: [handoff 087](087-2026-09-27-job-retention-index-and-scheduled-delivery.md).
- **2026-09-27 Jobs-202 producer + retention/alerts slice (the jobs layer
  complete; `DEC-139` fully delivered; two commits `ba27b79` + `054355f`,
  closed by this docs update; nothing pushed)**: the file set groups by the
  landed commits — (1) `feat(jobs,web)` `ba27b79` — the HTTP 202 producer:
  new `packages/jobs-runtime/src/producer.ts`
  (`enqueueJobWithDispatch(boss, db, input)`, the canonical one-transaction
  enqueue; `payroll-schedule.ts`'s enqueue delegates to it),
  `apps/web/lib/jobs.ts` (the `globalThis`-cached web `PgBoss`),
  `apps/web/app/api/v1/workforce/payroll-reports/...` (`?async=true` →
  `202` + Location), `apps/web` deps + `next.config.mjs`; (2) `feat(jobs)`
  `054355f` — `JobStore.deleteExpiredJobs` (terminal-only, org-scoped,
  batched) + `JobStore.countStuckJobs` + the `jobs.stuck_pending` handler
  alert, the maintenance-cron prune after the outbox replay (`retentionDays`
  90, `retentionLimit` 1000), the `registerMonitor` cron (`MONITOR_QUEUE`,
  `MONITOR_CRON` default `*/5 * * * *`) with the structured alerts
  (`jobs.dead_letter`, `jobs.queue_depth`, `jobs.oldest_queued_age`) and
  the `info` heartbeat, and the worker heartbeat log raised `debug`→`info`.
  **Uncommitted→committed framing:** the epics were authored uncommitted on
  top of the handoff-085 tree and are now committed as the two commits
  above. **No migration** in either epic — the prune is org-scoped on the
  existing `job_org_status_scheduled_idx` (single-tenant deployment; a
  system-wide prune + `(organization_id, created_at)` index is the recorded
  follow-up), and migrations and the `pgboss` schema are untouched.
  **Rollback:** `git revert ba27b79` and `git revert 054355f` — each commit
  reverts independently. **No posted money or stock fact** — the slice only
  enqueues jobs, prunes terminal `job` rows (`succeeded`/`failed`/
  `dead_lettered`) and emits log alerts; the `pgboss`/`job` tables are
  **disposable operational state** (the facts live in
  `public.outbox_event`), so no schema drop or data recovery is needed
  beyond the reverts. Nothing pushed; nothing applied to DigitalOcean.
  Details and the review reconciliation:
  [handoff 086](086-2026-09-27-jobs-202-producer-retention-alerts.md).
- **2026-09-26 Payroll-schedule slice (the first real async
  producer/consumer + the job-progress route; ADR-0004/`DEC-139` item 5 +
  `DEC-104`; committed as `ecbe35b` + `0da0593`, closed by the docs commit
  `67e932d`; nothing pushed)**: file set —
  `packages/jobs-runtime/src/{payroll-schedule.ts,handlers.ts,queues.ts,consumer.ts,worker.ts,scheduler.ts,index.ts}`
  (+ tests), `packages/application/src/scheduling/generate-payroll-report.ts`
  (`actorId` widened to `string | null`),
  `packages/domain/src/{period-close.ts,index.ts}` (`lastDayOfUtcMonth`
  export only), `apps/web/app/api/v1/jobs/{access.ts,[id]/route.ts,
  [id]/route.test.ts}`, `apps/scheduler/src/main.ts` (`PAYROLL_CRON`) and
  `infra/modules/app-platform/main.tf` (scheduler `ORGANIZATION_ID` env).
  **No migration** — the report writes ride the existing `payroll_report`
  table and its lock; migrations and the `pgboss` schema are untouched, and
  the `0700`-style down paths are untouched. **Rollback:** revert the
  commits (`0da0593`, `ecbe35b`, `67e932d`); **no posted money or
  stock fact** — the slice only creates `payroll_report` rows through the
  existing system command, queued jobs and audit rows, all ordinary
  operator-grade appends. Suggested layering: `feat(jobs)` (producer +
  consumer + route + terraform) then `docs`. Nothing pushed; nothing
  applied to DigitalOcean. Details and the review reconciliation:
  [handoff 085](085-2026-09-26-payroll-schedule-producer-consumer.md).
- **2026-09-26 Jobs-runtime slice (pg-boss worker wiring + scheduler cron;
  ADR-0004/DEC-139; committed as `ecbe35b` + `8572510`, closed by the docs
  commit `67e932d`; nothing pushed)**: the file set groups by the landed
  commits — (1)
  `feat(jobs)` — `packages/jobs-runtime/**`, the additive
  `packages/application/src/jobs/**` change, `apps/worker` + `apps/scheduler`,
  root
  `package.json`/`tsconfig.json`/`vitest.config.ts`/`package-lock.json`;
  (2) `feat(persistence)` — `packages/persistence/scripts/migrate.mjs`,
  `infra/bootstrap/pgboss-grants.sql`, `packages/persistence/package.json`;
  (3) `test(jobs)` — `packages/jobs-runtime/src/jobs-runtime.postgres.test.ts`
  (or folded into 1); (4) `docs` — this handoff/`CONTEXT.md` update.
  **Migration rollback:** migration `0071_job` is unchanged (landed in
  `c66eb27`) and its own down file is untouched, so the only new runtime
  artifact is the migrator-owned `pgboss` schema — run
  `DROP SCHEMA pgboss CASCADE` (destructive **only to the disposable queue
  metadata**: the facts are retained in `public.outbox_event`), rehearsed on
  a **scratch DB** (`public.job`/`public.outbox_event` and the 98 public
  tables survived intact; never rehearsed on the dev DB).
  **Rollback statement:** revert the commits (`ecbe35b`, `8572510`,
  `67e932d`), then drop the schema; no posted money or stock fact is
  touched. Nothing pushed; nothing applied to DigitalOcean. Details and the
  review reconciliation: [handoff
  084](084-2026-09-26-jobs-runtime-pgboss-wiring.md).
- **2026-09-25 Forecast-vs-actual tracking slice (DEC-138, the row-15
  owner-authorized override; nothing pushed)**: in chronological order
  `e52f4e5` (`feat(forecast)` — migration
  `0070_forecast_snapshot_forecast_override.sql` expand-only +
  persistence + application), `7c06fdd` (`feat(web)` — the routes + the
  tracking screen), `4ba3ced` (`fix` — the review hardening), plus the
  docs commit carrying this handoff/`CONTEXT.md` update on top.
  **Migration rollback:** run
  `packages/persistence/drizzle/0070_forecast_snapshot_forecast_override_down.sql`
  — destructive **only to forecast snapshots/overrides** (both tables
  dropped; no posted money or stock fact is affected) — then
  `git revert <sha>` each commit; the down path was **rehearsed on a
  scratch DB** (both tables present → absent → triggers removed →
  dropped), never on the dev DB. Migrations now through `0070`; **97
  public tables**; `ai_analysis_run`/`reorder_policy` remain deferred.
  Nothing pushed; nothing applied to DigitalOcean. Details and the
  review reconciliation: [handoff
  083](083-2026-09-25-forecast-tracking-dec-138.md).
- **2026-09-25 Integrations registry slice (INTG-001, `DEC-137`; nothing
  pushed)**: in chronological order `9508f1e` (`feat(integrations)` —
  migration `0069_integration_source.sql` expand-only + persistence +
  application use cases + seed), `02c3081` (`docs` — ADR-0011 Accepted +
  `DEC-137` + roadmap row 16), `ef23028` (`feat(integrations)` — the
  GET/POST/PATCH routes + the Administration register screen + labels),
  `23f803f` (`fix` — dedupe `allowed_operations` + the down-file rehearsal
  note), `64415db` (`docs` — the runbook `0069` row + the ADR-0011 status
  refs), plus the docs commit carrying this handoff/`CONTEXT.md` update on
  top. **Migration rollback:** run
  `packages/persistence/drizzle/0069_integration_source_down.sql` —
  destructive **only to registry configuration** (the `integration_source`
  table is dropped; no posted money or stock fact is affected) — then
  `git revert <sha>` each commit; the down path was **rehearsed on a
  scratch DB** (table present → absent → dropped), never on the dev DB.
  Migrations now through `0069`; **95 public tables**; `publish_run` is
  **not built** (still deferred in `NOT_EXPECTED_TABLES` — INTG-002 is
  gated on `ADR-0004`). Nothing pushed; nothing applied to DigitalOcean.
  Details and the review reconciliation: [handoff
  082](082-2026-09-25-integrations-registry-intg-001.md).
- **2026-09-25 design-system + storage-port wave close-out (nothing
  pushed)**: the four in-flight agents from [handoff
  081](081-2026-09-25-design-system-and-storage-port-wave.md) and the two
  later workstreams all landed and were committed.
  `2805deb`, `4c423c5`, `358bc58` — the a11y/touch-target work;
  **design-system/a11y presentation only**; `git revert <sha>` each,
  independently. **No migration.** `9c2c976`, `ac98d87`, `bef5459` — the
  tax-rule authoring slice; `git revert <sha>` each. **No migration**
  (`tax_rule` already had every column). `67ee852`, `6bfd5cd` — the
  receiving `applied_tax_rate` provenance slice;
  **`goods_receipt_line.applied_tax_rate`; the rollback is run
  `packages/persistence/drizzle/0068_goods_receipt_line_applied_tax_rate_down.sql`
  (back up first — the drop loses the captured rates on rows recorded
  after `0068`), then `git revert 67ee852`; `6bfd5cd` is a type-only
  revert.** `3054512` — the build fix keeping the domain barrel out of
  the client bundle; **`git revert 3054512`; no migration, no schema
  change.** `1a791eb` — the costing channel read; **`git revert 1a791eb`;
  no migration, no schema change.** `2a4a189` + `5013011` — the
  **DEC-135** rate-limiter shared Postgres store, one logical layer with
  migration `0067`. `2a4a189` was committed only in part while a second
  session ran concurrently in the same worktree (the reflog shows two
  `reset: moving to HEAD` events on HEAD at 11:46:02 and 11:49:18 from
  the collision), so it is **NOT trustworthy alone**: it left HEAD broken
  in two ways — the committed per-route `limiters.ts` declared
  `checkSalesReportThrottle` async while its call sites still called it
  synchronously (every request was denied on the
  reporting/analytics/simulation routes), and migration
  `0067_rate_limit_counter.sql` was committed without the drizzle table
  definition in `packages/persistence/src/schema/platform.ts`, its barrel
  export and the `EXPECTED_TABLES` entry. `5013011` completes the same
  layer and its own body states "2a4a189 alone should not be trusted".
  **Rollback: run
  `packages/persistence/drizzle/0067_rate_limit_counter_down.sql` (the
  unjournalled down companion, destructive only to throttling state; the
  down path was rehearsed on a scratch DB — the `0067` row in
  `docs/runbooks/persistence-migrations.md`), then `git revert 5013011`
  followed by `git revert 2a4a189`, or both together. Never revert
  `2a4a189` alone:** that would leave the async limiter signatures and
  the missing schema definition inconsistent again. Migrations now
  through `0068`; the `0068` down path was
  rehearsed on a scratch DB (recorded in the commit body and
  `docs/runbooks/persistence-migrations.md`). Nothing
  pushed; nothing applied to DigitalOcean.
- **2026-09-25 design-system + storage-port wave (8 commits; nothing
  pushed)**: in chronological order `c451c38` (docs — the `DEC-129` shell
   claim corrected, decision ids `DEC-130`/`DEC-131` reallocated),
  `ca32ca2` (docs — the HMS + Administration documentation pass;
   docs-only), `223651c` (`feat(ui)` — the design-system recipes on the
   primitives, `packages/ui/**`), `4ad6c5d` (`feat(ui)` — the shell re-seated
   on the light sidebar contract inline, the dead re-seating layer removed),
   `889089f` (`fix(ui)` — the stale nav-hover styling), `da430a6`
   (docs — eight stale styleguide claims corrected), `9de4c5c`
   (`feat(files)` — the **DEC-132** storage port:
   `packages/application/src/files/**` + the two document routes) and
   `4e2736c` (docs — the `DEC-132` row) — **each independently revertible
   with `git revert <sha>`, in any order**: `DEC-129` commits touch only
   `packages/ui/**` and docs, and `DEC-132` touches the new files package
   plus its two routes. **The storage port needs no migration rollback:**
   `file_object` is unchanged (its columns came from `DEC-085`,
   migrations `0035`/`0036`, already reverted-under separately), so the
   only runtime artifact is blob files under the gitignored
   `FILE_STORAGE_ROOT` written by the upload route — data written by
   ordinary operator actions through the existing commands, not slice
   side effects; the port's transaction compensation already removes the
   bytes if the metadata write fails, and reverting the code simply stops
   new uploads while existing metadata rows stay coherent. The
   `VERIFY-1` dev-seed data recorded by `ca32ca2` lives in the unpushed
   dev database only — not a migration concern. **No migration, no schema
   change by the wave** — migrations stay through `0066`; **93 tables**;
   `db:migrate` a no-op on re-run. Four follow-on agents were in flight
   with nothing committed at handoff time (two design-system screen
   rollouts, two fixers) — their output, when committed, will be its own
   entries. Nothing pushed; nothing applied to DigitalOcean. Details and
   the in-flight census: [handoff
   081](081-2026-09-25-design-system-and-storage-port-wave.md).
- **2026-09-24 W7 review-fix commit `f3adeb8` (nothing pushed)**:
  `f3adeb8` `fix(web): resolve the six findings from the W7 review` — 5
  files, all under `apps/web/app/(app)/**`; **presentation and validation
  only** (no route, command, vocabulary or business-rule change; nothing
  under `packages/**`; no test asserted any replaced string). **No
  migration, no schema change and no data written** — migrations stay
  through `0066`, **93 tables**; `db:migrate` a no-op on re-run.
  **Independently revertible with `git revert f3adeb8`** — it does not touch
  the six wave commits' files in a coupled way, and reverting it restores
  the six defects it fixed. Nothing pushed; nothing applied to
  DigitalOcean.
- **2026-09-24 W7 UI-refinement wave (6 commits, HEAD `01a9cda`; nothing
  pushed)**: `54022c7`, `5227552`, `f3201ff`, `733ee83`, `c202c39`,
  `01a9cda` — all web-layer changes under `apps/web/**` only (new forms and
  actions over routes/commands that already existed, copy corrections, token
  conformance, pickers replacing raw-UUID inputs). Each is **independently
  revertible with `git revert <sha>`**, in any order — no shared
  migration/schema objects. **No migration, no schema change and no data
  written by the wave** (migrations stay through `0066`; **93 tables**;
  `db:migrate` a no-op on re-run): forms call the existing `POST`/`PATCH`
  routes, which append ordinary rows through the existing commands — not
  slice side effects; the two-copy fixes (`c202c39`) change no behaviour at
  all. Staging caveat (not a rollback concern):
  `apps/web/next-env.d.ts` and `apps/web/tsconfig.json` are generated
  artifacts rewritten by every `next build`/`next dev` — normalise with
  `git checkout -- apps/web/next-env.d.ts apps/web/tsconfig.json` before
  staging any commit. Nothing applied to DigitalOcean.
- **2026-09-24 `DEC-122` task-status vocabulary alignment (uncommitted at
  handoff time; nothing pushed)**: a pure repository edit across
  `packages/application/src/tasks/**` and
  `apps/web/app/{api/v1/tasks/**,(app)/tasks/**}` plus the `DEC-122` slice's
  uncommitted `page.tsx`. Reverting the session's edits restores the previous
  (translating) `DEC-122` slice byte-for-byte. **No migration and no schema
  change** (the `task_status_check` constraint already permitted the schema
  vocabulary; migrations stay through `0062`; **89 tables**) and **no data
  written** by the alignment — the only production change is that the Postgres
  adapter no longer rewrites `done`/`cancelled` to `resolved`/`dismissed`, so
  rows already written by the translating slice (stored as `resolved`/
  `dismissed`) now read back as `resolved`/`dismissed` and are handled by the
  aligned machine directly. `db:migrate` is a no-op on re-run. Nothing applied
  to DigitalOcean.
- **2026-09-23 daily (location, day) close exposed (`DEC-119`; 4 commits incl.
  the `docs(decisions)` commit; nothing pushed)**: 1. `docs(decisions)`
  (`DEC-119`); 2. `test(application)` — the joining tests + the fake wiring
  (`packages/application/src/sales/{sales.test.ts,
  correct-sales-line.postgres.test.ts,test-support.ts}`); 3. `feat(web)`
  (the `/close` register UI under `apps/web/app/(app)/close/**` +
  `shell-nav.tsx` + `tasks/page.tsx`); 4. this `docs(context)` update — each
  independently revertible with `git revert <sha>`. **No migration, no schema
  change and no data written by the slice** (migrations stay through `0062`;
  **89 tables**): the backend already supported both scopes, so no backend
  production code changed — no command, route, schema or gate change, no new
  route. Reverting the web layer removes the screen (the API and the
  `beginPeriodClose`/`lockPeriodClose` commands remain usable directly);
  reverting the tests removes only coverage; creating and locking a close
  through the UI is an ordinary operator action writing normal append-only
  `period_close` rows, not slice data. **No backfill.** `db:migrate` is a
  no-op on re-run through `0062`. Nothing applied to DigitalOcean.
- **2026-09-23 settlement reconciliation nets line-level reversals
  (`DEC-118`; 4 commits incl. the `docs(decisions)` commit; nothing pushed)**:
  1. `docs(decisions)` (`DEC-118`); 2. `feat(persistence)` (the new read-only
   `sumSalesLineGrossForChannelPeriod` aggregate + tests in
   `packages/persistence/src/repositories/sales.ts`/
   `sales.postgres.test.ts`); 3. `feat(application)` (`sumSalesForChannelPeriod`
   delegating to it, the widened `reconcileSettlement` re-run patch + the
   forwarded `updatedBy`, across `packages/application/src/reconciliation/**`);
   4. this `docs(context)` update — each independently revertible with
   `git revert <sha>`. **No migration, no schema change and no data written by
   the slice** (migrations stay through `0062`; **89 tables**): the change is a
   read change plus one new read-only aggregate over existing columns
   (`sales_line.gross_amount`, `option_kind`, the transaction header's
   `channel_id`/`currency`/`occurred_at`). **No posted fact is edited** — a
   re-run changes only the re-derived reconciliation values
   (`status`/`expected_amount`/`actual_amount`/`tolerance`/`difference`,
   preserving `resolution_note`) and only on an explicit operator re-run
   (the only caller is a `POST` route). Reverting the code restores the
   header-basis read (a re-run would then re-derive the old figures); the
   persistence and application layers revert independently. **No backfill and
   no automatic historical re-evaluation.** `db:migrate` is a no-op on re-run
   through `0062`. Nothing applied to DigitalOcean.
- **2026-09-23 downstream-reconciliation reversal gate (`DEC-117`; 5 commits
  incl. the `docs(decisions)` commit; nothing pushed)**: 1. `docs(decisions)`
  (`DEC-117`); 2. `feat(domain)` (`packages/domain/src/reversal-gate.ts` +
  `reversal-gate.test.ts` + the `packages/domain/src/index.ts` barrel line);
  3. `feat(persistence)` (the read-only gate reads + tests in
  `packages/persistence/src/repositories/reconciliation.ts`/
  `reconciliation.postgres.test.ts`); 4. `feat(application)` (the gate
  evaluated inside `correctSalesLine`'s transaction + the
  reconciliation/sales port, store and test wiring across
  `packages/application/src/reconciliation/**` and `sales/**`); 5. this
  `docs(context)` update — each independently revertible with
  `git revert <sha>`. **No migration, no schema change and no data written**
  (migrations stay through `0062`; **89 tables**): the gate is a pure
  predicate plus two read-only reads over the existing `period_close` and
  `reconciliation` columns, and the only command change is evaluating it
  before any write. Reverting the code restores the ungated reversal (the
  `DEC-116` behaviour); the domain, persistence and application layers
  revert independently. **Append-only holds on both paths** — a blocked
  reversal posts nothing (no reversal line, no movement reversal, no
  audit); an allowed reversal writes only new rows. **No backfill.**
  `db:migrate` is a no-op on re-run through `0062`. Nothing applied to
  DigitalOcean.
- **2026-09-23 correction/reversal posting wiring (`DEC-116`; 5 commits incl.
  the `docs(decisions)` commit; nothing pushed)**: 1. `docs(decisions)`
  (`DEC-116`); 2. `feat(persistence)` (the source-scoped `onlyReversible`
  movement read + tests in `packages/persistence/src/repositories/
  inventory.ts`/`inventory.test.ts`); 3. `feat(application)`
  (`correctSalesLine` + the port/store wiring + tests across
  `packages/application/src/sales/**` and `inventory/**`); 4. `feat(web)`
  (`POST /api/v1/sales/lines/[id]/reverse` + route test, the
  `reverseSalesLine` limiter, `sales-rows.ts`, the `ReverseLine` action,
  `run-actions.tsx`); 5. this `docs(context)` update — each independently
  revertible with `git revert <sha>`. **No migration, no schema change and no
  data migration** (migrations stay through `0062`; **89 tables**): the wiring
  rides on the existing `sales_line.reversal_of_id` partial unique index and
  the `stock_movement.reversal_of_id`/idempotency columns. **Append-only:**
  nothing is deleted or edited — a reversal writes new rows (a negated
  `sales_line` and new reversal `stock_movement` rows), so reverting the code
  leaves existing reversal rows intact and the ledger balanced, and the
  persistence filter, the application command and the web layer revert
  independently. **No backfill** (reversals are neither computed nor
  rewritten). `db:migrate` is a no-op on re-run through `0062`. Nothing
  applied to DigitalOcean.
- **2026-09-23 allocation pool recurrence→period normalisation (`DEC-115`; 4
  commits incl. the `docs(decisions)` commit; nothing pushed)**: 1.
  `docs(decisions)` (`DEC-115`); 2. `feat(domain)`
  (`packages/domain/src/recurrence.ts` + `recurrence.test.ts` + the
  `packages/domain/src/index.ts` barrel line); 3. `feat(application)` (the
  resolver's pool sum + the `operatingCostIds` contributor filter + the
  resolver tests); 4. this `docs(context)` update — each independently
  revertible with `git revert <sha>`. **No migration, no schema change and no
  data written** (migrations stay through `0062`; **89 tables**): the
  normalisation is a pure computation over the existing
  `operating_cost.amount`/`recurrence`/`effective_from` columns. The domain
  module and the resolver change revert independently — reverting the resolver
  restores the previous face-value sum, which is the `DEC-112` behaviour.
  **No backfill** (the pool amount is derived at query time). `db:migrate` is
  a no-op on re-run through `0062`. Nothing applied to DigitalOcean.
- **2026-09-23 volume-based allocation denominators (`DEC-114`; 4 commits incl.
  the `docs(decisions)` commit; nothing pushed)**: 1. `docs(decisions)`
  (`DEC-114`); 2. `feat(persistence)` (`schemas/domain-enums.yaml`,
  `packages/persistence/src/schema/vocabularies.ts`, `reporting.ts` + the new
  `reporting.postgres.test.ts`); 3. `feat(application)` (the resolver branch,
  the port member + store wiring, the tests); 4. this `docs(context)` update —
  each independently revertible with `git revert <sha>`. **No migration, no
  schema change and no data written** (migrations stay through `0062`; **89
  tables**): `allocation_rule.denominator_source` is free text with a
  non-empty CHECK only, so widening `allocation_denominator_source` is a
  code-side lockstep change (YAML + TS) — reverting the vocabulary and
  reverting the additive `sumSalesVolume` read are independent; the
  application layer reverts as a unit. No backfill (the read is derived from
  existing `sales_line` facts at query time). `db:migrate` is a no-op on
  re-run through `0062`. Nothing applied to DigitalOcean.
- **2026-09-23 row-11 sales-import mapping writer (`DEC-113`; 4 commits incl.
  the `docs(decisions)` commit; nothing pushed)**: 1. `fd277ff`
  `docs(decisions)` (`DEC-113`); 2. `c0fc7de` `feat(persistence)`; 3.
  `7d96270` `feat(application)`; 4. `cba124a` `feat(web)` — each independently
  revertible with `git revert <sha>`. **No migration and no schema change**
  (migrations stay through `0062`; **89 tables**): the write is a purely
  additive read-method set plus an additive write of
  `normalized.product_variant_id` on staging rows the writer already owns.
  Reverting the code leaves existing rows untouched — a reverted writer simply
  stops populating the key and the poster reads `null`, so the line stays
  unposted (no data loss). The `feat(web)` layer reverts independently.
  Historical `sales_line` backfill is **not** done (the recorded `DEC-113`
  posture). `db:migrate` is a no-op on re-run through `0062`. Nothing applied
  to DigitalOcean. A follow-up review closed the same stale-key hole on the
  **mapped** branch (a remap that changes the resolution path, e.g. variant →
  item): the matched branch now strips the previous mapping keys before re-adding
  the fresh ones. Purely an application-layer guard plus one extra test — no
  schema or migration impact, so the four commits remain independently
  revertible with `git revert <sha>`.
- **2026-09-23 cost-card component resolvers (`DEC-112`; 5 commits incl. the
  `docs(decisions)` commit; nothing pushed)**: 1. `8cf86c9`
  `docs(decisions)` (`DEC-112`); 2. `bfb1a07` `feat(domain)`; 3. `fb081ef`
  `feat(persistence)`; 4. `7748969` `feat(application)`; 5. `8bf8c71`
  `feat(web)` — each independently revertible with `git revert <sha>`.
  Migrations **`0060`** (resolver columns + `ALLOCATION_DENOMINATOR_SOURCE`
  vocabulary), **`0061`** (cross-org guard triggers) and **`0062`**
  (`channel_fee_rule` lookup index) are additive — nullable columns, no new
  table, no backfill; the rehearsed down-path order is **`0061` down → `0062`
  down → `0060` down** (drop the cross-org guards, drop the lookup index, drop
  the resolver columns). Schema stays **89 tables**;
  `db:migrate` is a no-op on re-run through `0062`. Nothing applied to
  DigitalOcean.
- **2026-09-23 cost-card composition assembler (`DEC-111`; 4 commits incl. this
  docs commit; nothing pushed)**: 1. `182342b` `feat(application)`; 2. `0ee79f7`
  `feat(web)`; 3. the `docs(decisions)` commit (`DEC-111`); 4. this
  `docs(context)` update — each independently revertible with
  `git revert <sha>`. **No migration and no data written** (reads + one new write
  path over existing tables); schema stays **89 tables / `0059`**; `db:migrate`
  is a no-op. Nothing applied to DigitalOcean.
- **2026-09-23 row-13e/13f `RPT-004` operations report (`DEC-110`; 6 commits incl.
  this docs commit; nothing pushed)**: 1. `fdf7dc0` `feat(domain)`; 2. `353c0bc`
  `feat(persistence)`; 3. `fa7cfe2` `feat(application)`; 4. `ae2352f`
  `feat(web)`; 5. the `docs(decisions)` commit (`DEC-110`); 6. this
  `docs(context)` update — each independently revertible with
  `git revert <sha>`. **No migration and no data written** (on-demand reads over
  the canonical facts); schema stays **89 tables / `0059`**; `db:migrate` is a
  no-op. Nothing applied to DigitalOcean.
- **2026-09-22 row-13d menu engineering (`RPT-005`, `DEC-109`; 5 commits incl.
  this docs commit; nothing pushed)**: 1. `af2b81c` `feat(domain)`; 2. `b360c82`
  `feat(persistence)`; 3. `eb6dbb6` `feat(application)`; 4. `7f7dfc7`
  `feat(web)`; 5. this `docs(context)` update — each independently revertible
  with `git revert <sha>`. **No migration and no data written** (on-demand read
  model over the canonical facts); schema stays **89 tables / `0059`**;
  `db:migrate` is a no-op. Nothing applied to DigitalOcean.
- **2026-09-22 row-13c sales & margin reporting read model + its review fixes
  (`RPT-001`–`RPT-003`, `FND-006`, `DEC-108`; 6 commits incl. this docs commit;
  nothing pushed)**: 1. `e79c88e` `feat(domain)`; 2. `ea9140e`
  `feat(persistence)`; 3. `b76fc0b` `feat(application)`; 4. `3957ad8`
  `feat(web)`; 5. `4d495d2` `docs(decisions)` (`DEC-108`/`DEC-109`); 6. this
  `docs(context)` update — each independently revertible with
  `git revert <sha>`. **No migration and no data written** (the read model is
  on-demand over the canonical facts); schema stays **89 tables / `0059`**;
  `db:migrate` is a no-op. The review fixes (F1–F11: the variant-resolution
  chain, the window-level distinct transaction count, the multi-location
  drill-down scope, the `included`-line disclosure, the fake exclusion, the
  removed dead seams, safe count casts, doc/label fixes and the added tests) are
  folded into the same layer commits. Nothing applied to DigitalOcean.
- **2026-09-22 row-13b close prerequisites + `adjustment_period` slice
  (`REC-003`/`REC-005`/`REC-006`/`DEC-027`, provisional `DEC-106`/`DEC-107`; 6
  commits incl. this docs commit; nothing pushed)**: 1. `3ee7b25`
  `fix(persistence)` — the missing `0058` snapshot + chain (metadata only);
  2. `2de4072` `feat(persistence)` — `adjustment_period` + migration `0059`;
  3. `faeb049` `feat(application)`; 4. `6ac1158` `feat(web)`; 5. `c903954`
  `feat(close)` — prerequisites + snapshot v2 + the row-13a race fix;
  6. `956ceb6` `docs(decisions)` (`DEC-106`/`DEC-107`); 7. this `docs(context)`
  update — each independently revertible with `git revert <sha>`. Migration
  **`0059_adjustment_period` adds one table** (additive; down drops
  `adjustment_period`, 89 → 88); the rehearsed down order is a single step; on a
  DB rollback delete the ledger row (`when` `1790113826232`) and re-migrate; 89
  tables after re-apply. `0059` sha256
  `51cd81f25b2551e1705028b9f04d242ee71f9387769db0328a6620bee632f1cf`; down sha256
  `cbf3b711c2dfb552e1d07622287a0d18c2ff29edbc92f2802f41cad073752e87`. No
  migration for the prerequisites slice (jsonb snapshot only). Nothing pushed;
  nothing applied to DigitalOcean.
- **2026-09-22 row-13a period close/lock slice (`REC-003`/`REC-006`/`DEC-027`,
  provisional `DEC-105`; 5 commits incl. this docs commit; nothing pushed)**:
  1. `415297b` `feat(persistence)` (close schema + repository + `0057`/`0058`);
  2. `0daecac` `feat(domain)`; 3. `0139ac1` `feat(application)`; 4. `c46e1a1`
  `feat(web)`; 5. `7694050` `docs(decisions)` (`DEC-105`); 6. this
  `docs(context)` update — each independently revertible with
  `git revert <sha>`. Migration **`0057_period_close` adds one table** (additive;
  down drops `period_close`, 88 → 87); **`0058_period_close_org_guard` is
  trigger-only** (down 88 → 88); the rehearsed down order is **`0058` →
  `0057`**. If the DB is rolled back, delete the two ledger rows (`created_at`
  `1790110579392` / `1790110580000`) and re-migrate; 88 tables after re-apply
  (rehearsed 2026-09-22 — see the work log). `0057` sha256
  `b2cbad1af69cbfca470cd31dd7d84e2ed9154cc4c170666fa2bb3d11e90f3e31`; `0058`
  (amended after the adversarial review — the locked-row immutability also covers
  tenancy and the lock actor) sha256
  `63bcd67b11649d84e4c97342e6b859baec6b95e97d20719bdc967756267d10b3`. Nothing
  pushed; nothing applied to DigitalOcean.
- **2026-09-22 row-14b-2 payroll-report slice (`WF-005`/`DEC-104`; 7 commits
  incl. this docs commit; nothing pushed)**: 1. `f17fb29`
  `feat(persistence)`; 2. `87e92f5` `feat(domain)`; 3. `321d6e5`
  `feat(application)`; 4. `2285e2e` `feat(web)`; 5. `40595a9`
  `fix(scheduling)` — the review fixes; 6. `2690959` `docs(decisions)` —
  `DEC-104`; 7. the roadmap update; 8. this `docs(context)` update —
  each independently revertible with `git revert <sha>`. Migration
  **`0055_payroll_report` adds one table** (additive; down drops
  `payroll_report`, 87 → 86); **`0056_payroll_report_org_guard` is
  trigger-only** (down 87 → 87); the rehearsed down order is **`0056` →
  `0055`**. If the DB is rolled back, delete the two ledger rows
  (`created_at` `1790069367957` / `1790069368959`) and re-migrate; 87
  tables after re-apply (rehearsed 2026-09-22 — see the work log). Nothing
  pushed; nothing applied to DigitalOcean.
- **2026-09-22 row-14b-1 worked-hours slice (`WF-004`/`DEC-103`; 7 commits
  incl. this docs commit; nothing pushed)**: 1. `a67fe49`
  `feat(persistence)`; 2. `826800e` `feat(domain)`; 3. `74d9210`
  `feat(application)`; 4. `9b8e8fc` `feat(web)`; 5. `dce1a15`
  `fix(workforce)` — the review fixes; 6. `5c1dd73` `docs(decisions)` —
  `DEC-103`; 7. `f49490a` `docs(roadmap)`; 8. this `docs(context)` update —
  each independently revertible with `git revert <sha>`. Migration
  **`0053_shift_adjustment` adds one table** (additive; down drops
  `shift_adjustment`, 86 → 85); **`0054_shift_adjustment_org_guard` is
  trigger-only** (down 86 → 86); the rehearsed down order is **`0054` →
  `0053`**. If the DB is rolled back, delete the two ledger rows
  (`created_at` `1790067016722` / `1790067030453`) and re-migrate; 86
  tables after re-apply (rehearsed 2026-09-22 — see the work log). Nothing
  pushed; nothing applied to DigitalOcean.
- **2026-09-22 staff document library slice (`DEC-088`/`DEC-100`; 6 commits
  incl. this docs commit; nothing pushed)**: 1. `2784f18` `docs(decisions)` —
  `DEC-100`; 2. `ee47947` `feat(persistence)`; 3. `2aabd1b`
  `feat(application)`; 4. `3fe7d4a` `feat(web)`; 5. `838d11a` `docs(runbook)`
  — the migration-ledger/rehearsal + roadmap entries; 6. this
  `docs(context)` update — each independently revertible with
  `git revert <sha>`. Migration **`0048_staff_documents` adds three tables**
  (additive; down drops `document_acknowledgement` → `document_version` →
  `document`, 81 → 78); **`0049_staff_documents_org_guard` is trigger-only**
  (down 81 → 81); the rehearsed down order is **`0049` → `0048`**. If the DB
  is rolled back, delete the two ledger rows (`created_at`
  `1790054700573` / `1790054714766`) and re-migrate; 81 tables after
  re-apply (rehearsed 2026-09-22 — see the work log). Nothing pushed;
  nothing applied to DigitalOcean.
- **2026-09-22 `employee` + personnel-documents slice (`DEC-087`/`DEC-099`;
  5 commits incl. this docs commit; nothing pushed)**: 1. `246c735`
  `docs(decisions)` — `DEC-099`; 2. `59ad19e` `feat(persistence)` — the
  `employee` + `employee_document` tables (migrations `0046`/`0047`), the
  `employee_document_kind` vocabulary, the schema/repository + tests; 3.
  `4faa6aa` `feat(application)` — the workforce commands/queries + store port
  - adapter + fake + tests; 4. `603054f` `feat(web)` — the
    `/api/v1/workforce/**` routes with role + location scope; 5. `5b932a8`
    `docs(runbook)` — the migration-ledger/rehearsal entries; 6. this
    `docs(context)` update — each independently revertible with
    `git revert <sha>`. Migration **`0046` adds two tables** (additive; down
    drops `employee_document` then `employee`, 78 → 76); **`0047` is
    trigger-only** (down 78 → 78); the rehearsed down order is **`0047` →
    `0046`**. If the DB is rolled back, delete the two ledger rows (`when`
    `1790035770192` / `1790035771192`) and re-migrate; 78 tables after re-apply.
    `0047` was amended **before commit** to add the `employee_user_org_guard`
    (the uncommitted ledger hash was updated and the rehearsal re-run). Nothing
    pushed; nothing applied to DigitalOcean.
- **2026-09-22 HMS compliance / evidence export slice (`DEC-093`/`DEC-098`;
  5 commits incl. this docs commit; nothing pushed)**: 1. `05caf1b`
  `docs(decisions)` — `DEC-098`; 2. `7cb4f68` `feat(persistence)` — the
  optional `from`/`to` period filter on the five HMS list queries +
  repository tests; 3. `275c3d5` `feat(application)` — the compliance
  evidence export bundle (`build-compliance-export.ts`) + store port +
  adapter + fake + tests; 4. `00508a3` `feat(web)` — the
  `GET /api/v1/hms/compliance-export` route with fail-closed per-source scope
  - the query/parser + route test; 5. this `docs(context)` commit — each
    independently revertible with `git revert <sha>`. **No migration** was
    needed (migrations stay through `0045`; **76 tables** unchanged), so there
    is **no schema-rollback concern** and no ledger row to delete; nothing
    pushed; nothing applied to DigitalOcean.
- **2026-09-21 HMS equipment / maintenance slice (`DEC-092`/`DEC-097`; 6
  commits incl. this docs commit; nothing pushed)**: 1. `35561da`
  `docs(decisions)` — `DEC-097`; 2. `d5b7001` `feat(persistence)` — the
  equipment/maintenance tables (migrations `0044`/`0045`) + the repository +
  tests; 3. `da53faa` `feat(application)` — the commands/queries + adapter +
  fake; 4. `37c3a74` `feat(web)` — the equipment/maintenance routes; 5. `23e175f` `docs(runbook)` — the migration-ledger/rehearsal entries; 6. this `docs(context)` commit — each independently revertible with
  `git revert <sha>`. Migration **`0044` adds two tables** (additive; down
  drops `maintenance_log` then `equipment`, 76 → 74); **`0045` is
  trigger-only** (down 76 → 76); the rehearsed down order is
  **`0045`→`0044`**. If the DB is rolled back, delete the two ledger rows
  (`created_at` `1790030048087` / `1790030073708`) and re-migrate; 76 tables
  after re-apply. Nothing pushed; nothing applied to DigitalOcean.

- **2026-09-21 HMS checklists slice (`DEC-091`/`DEC-096`; 6 commits incl.
  this docs commit; nothing pushed)**: 1. `bd27b18` `docs(decisions)` —
  `DEC-096`; 2. `60a4c51` `feat(persistence)` — the checklist tables
  (migration `0042`) + the repository + tests; 3. `d5994fd`
  `feat(application)` — the commands/queries + adapter + fake; 4. `ff6c8d0`
  `feat(web)` — the checklist routes; 5. `c66ad68` `docs(runbook)` — the
  migration-ledger/rehearsal entries; 6. this `docs(context)` commit — each
  independently revertible with `git revert <sha>`. Migration **`0042` adds
  two tables** (additive; down drops `checklist_run` then
  `checklist_template`, 74 → 72); **`0043` is trigger-only** (down 74 → 74);
  the rehearsed down order is **`0043`→`0042`**. If the DB is rolled back,
  delete the two ledger rows (`created_at` `1790027667971` / `1790027669000`)
  and re-migrate; 74 tables after re-apply. Nothing pushed; nothing applied
  to DigitalOcean.

- **2026-09-21 HMS incidents + corrective-actions slice (`DEC-090`/
  `DEC-095`; up to 6 commits incl. this docs commit; nothing pushed)**:
  1. `docs(decisions)` — `DEC-095`; 2. `feat(persistence)` — the incident +
     corrective-action tables (migration `0040`) + the repository + tests;
  2. `feat(application)` — the commands/queries + adapter + fake; 4.
     `feat(web)` — the incident/corrective-action routes; 5. `docs(runbook)`
     — the migration-ledger/rehearsal entries; 6. this `docs(context)`
     commit — each independently revertible with `git revert <sha>`.
     Migration **`0040` adds two tables** (additive; down drops
     `corrective_action` then `hms_incident`, 72 → 70); **`0041` is
     trigger-only** (down 72 → 72); the rehearsed down order is
     **`0041`→`0040`**. If the DB is rolled back, delete the two ledger rows
     (`created_at` `1790024758839` / `1790024895228`) and re-migrate; 72
     tables after re-apply. Nothing pushed; nothing applied to DigitalOcean.

- **2026-09-21 HMS monitoring slice (`DEC-089`; 5 commits incl. this docs
  commit; nothing pushed)**: 1. `feat(persistence)` — `monitoring_point` +
  `monitoring_reading` (migration `0037`), the append-only triggers incl. a
  TRUNCATE guard (`0038`), the org-coherence guards (`0039`), the vocabulary
  keys, the repository + tests; 2. `feat(domain)` — `isReadingInRange`; 3. `feat(application)` — the HMS store port + commands/queries + adapter +
  fake + tests; 4. `feat(web)` — the `/api/v1/hms/monitoring-points` routes
  with role + location-scope enforcement; 5. `docs(runbook)` + this docs
  commit — each independently revertible with `git revert <sha>`. Migration
  **`0037` adds two tables** (additive); **`0038`/`0039` are trigger-only**;
  the rehearsed down order is **`0039`→`0038`→`0037`** → 68 tables. If the DB
  is rolled back, delete the three ledger rows (`created_at` `1789995070090`
  / `1789995080123` / `1789996231921`) and re-migrate; 70 tables after
  re-apply. Nothing pushed; nothing applied to DigitalOcean.
- **2026-09-21 Phase A + small-TECH session (3 code commits + this docs
  commit; nothing pushed)**: `bda0b6b` `fix(domain)` — the `numeric(19,
scale)` cap in `parseDecimal` + `packages/domain/src/decimal.test.ts`;
  `8b22468` `chore(vocabularies)` — the `import_disposition` yaml key, the
  exemption removed; `02f7c33` `test(counts)` — `FakeCountStore` rollback
  fidelity; plus this docs commit carrying **Phase A** (`DEC-086`…`DEC-094`
  and the spec amendments) — each independently revertible with
  `git revert <sha>`. **No schema change** — migrations stay through
  `0036`, **68 tables** (unchanged); no data migration; Phase A itself is
  docs-only. Nothing pushed; nothing applied to DigitalOcean.
- **2026-09-21 small-TECH-open-points session (2 code commits + this docs
  commit; nothing pushed)**: `bda0b6b` `fix(domain)` — the
  `numeric(19, scale)` storage-precision cap in `parseDecimal` +
  `packages/domain/src/decimal.test.ts`; `8b22468` `chore(vocabularies)` —
  the canonical `import_disposition` key in `schemas/domain-enums.yaml`, the
  now-empty `YAML_ABSENT_VOCABULARIES` exemption removed, the
  provisional-mirror comments corrected; and this context docs update — each
  independently revertible with `git revert <sha>`. **No schema change** —
  migrations stay through `0036`, **68 tables** (unchanged); no data
  migration; nothing rewrites existing schema objects. Nothing pushed;
  nothing applied to DigitalOcean.
- **`DEC-085` `file_object` slice (committed as five commits since the
  `2d4b98b` baseline; nothing pushed)**: `b3a3e02` `feat(persistence)` — the
  `file_object` table (migration `0035`) + the `import_run.file_object_id`
  FK + the `file_object_org_guard` trigger (migration `0036`) +
  repository/tests; `1fd8e4e` `docs(comments)`; `818b63c` `docs(runbook)`;
  `ebd6ed3` `docs(decisions)` —
  `ADR-0006` accepted + `DEC-085`; and this context docs update — each
  independently revertible with `git revert <sha>`; revert the docs commits
  before persistence if reverting a cohort. Migration `0035` adds one table
  (additive, with the deferred FK `NOT VALID` → `VALIDATE`); `0036` adds a
  trigger; both have rehearsed unjournaled down paths — the down order is
  **`0036` then `0035`** (the runbook documents it). If the DB is rolled
  back, delete the `0035`/`0036` ledger rows (`created_at` `1789990745770` /
  `1789990766802`) and re-migrate; 68 tables after re-apply. Nothing pushed;
  nothing applied to DigitalOcean.
- **2026-09-21 `ADR-0006` acceptance + gate resolution (docs-only)** — edits
  only to `docs/adr/0006-file-storage-and-retention.md`,
  `docs/BUILD_ROADMAP.md` and `CONTEXT.md`; trivially `git revert <sha>`-able
  as a single docs commit. No code, migration, data or decision entry
  changed; nothing pushed; nothing applied to DigitalOcean.
- **`DEC-083` contract-step slice (committed as four commits since the
  `3abe72f` baseline; nothing pushed)**: `4326dec` (feat(persistence) —
  migration `0034_import_disposition_contract` + structural guards),
  `66b0d51` (fix(tooling) — `db:generate` forwards extra args), `2d4b98b`
  (docs(runbook) — document `0034`) and this context docs update — each
  independently revertible with `git revert <sha>`. The `0034` down
  rebuilds `diagnostics.dispositions` from `import_disposition` (value-identical,
  drops nothing); if the DB is rolled back past the migration, delete the
  `0034` ledger row (`created_at` `1789989056234`) and re-migrate. **No
  schema change** (67 tables, data-only). Nothing pushed; nothing applied to
  DigitalOcean.
- **2026-09-21 ADR-gate pause (docs-only, commit `3abe72f`)** — edits only to
  `CONTEXT.md` and `docs/BUILD_ROADMAP.md` (gate list, gated `file_object`
  annotations, pause record, work-log entry); trivially
  `git revert <sha>`-able as a single docs commit. No code, migration, data
  or decision entry changed; nothing pushed; nothing applied to
  DigitalOcean.
- **`DEC-084` PROD-003 variance-producer slice (committed as five commits since
  the `1f06d34` baseline; nothing pushed)**: `accb44c` (`refactor(application)`
  the shared `data-quality` module + the `transfers` refactor), `a819925`
  (`feat(counts)` the `count_variance` producer in `approveStockCount`),
  `875b0ba` (`feat(production)` the `yield_variance` producer in
  `completeProductionBatch` + the web/runbook docs), `46d6ad7`
  (`docs(decisions)` `DEC-084` + roadmap + persistence comments) and this
  context docs update — each independently revertible with `git revert <sha>`;
  revert in reverse order — production/counts before the `data-quality`
  refactor — if reverting a cohort. **No schema change:** migrations stay
  through `0033` (67 tables), no data migration, nothing rewrites existing
  schema objects. Nothing pushed; nothing applied to DigitalOcean.
- **`DEC-083` import-disposition-table slice (committed as seven commits since
  the `36f3c30` baseline; nothing pushed)**: `4587564` (the `DEC-083` decision
  entry), `dbb7d97` (persistence — the `import_disposition` table, migration
  `0033`, + jsonb backfill), `64a7cfc` (imports — read and write dispositions
  via the table), `0f8b7b1` (web), `b2dc8ac` (runbook docs), `7b86165`
  (roadmap docs) and this context docs update — each is independently
  revertible with `git revert <sha>`; revert
  the web/application commits before persistence if reverting a cohort.
  Migration `0033` is **additive** (a new table + journalled jsonb backfill)
  with a **lossless** unjournaled down path — it rebuilds
  `diagnostics.dispositions` from the table (one record per row ordered by
  `source_row_no`, so value-identical but not order-identical to the original
  append order), drops the table and deletes the ledger row; rehearsed via
  down/re-apply. The jsonb keys were retained **frozen**
  (expand → migrate → contract; the contract step was delivered 2026-09-21
  by migration `0034`). Nothing
  pushed; nothing applied to DigitalOcean.
- **`DEC-082` posting-policy-enforcement slice (committed as four commits since
  the `ad2cf5c` baseline; nothing pushed)**: `12f0377` (the `DEC-082` decision
  entry), `22b67c1` (sales — enforce the run's recorded
  `diagnostics.posting_policy` in `postImportRun`), `36094c6` (docs(context)
  handoff) and `36f3c30` (the review fix — reject a corrupt non-string policy
  snapshot instead of coercing it) — each is independently revertible with
  `git revert <sha>`; `git revert 22b67c1` restores the previous
  posting behaviour and `git revert 36f3c30` restores the pre-review snapshot
  handling; neither touches a migration or generated file, so there is
  no data-recovery concern. Nothing pushed; nothing applied to DigitalOcean.
- **`DEC-081` import-profile slice (committed as five commits since
  the `b57fc3d` baseline; nothing pushed)**: `2997587` (the `DEC-081` decision
  entry), `f4a8110` (persistence — the `import_profile` table, migration
  `0031`, and the `import_run_profile_org_guard` trigger, migration `0032`),
  `e9ec176` (imports — resolve a run's import profile by source), `1914795`
  (web — profile-aware import creation and seed) and `cb3aff5` (runbook docs
  for `0031`/`0032`) — each is independently revertible with `git revert <sha>`;
  because the web/application commits consume the persistence types, revert the
  web/application commits before persistence if reverting a cohort. Migrations
  `0031`/`0032` are **additive** with rehearsed unjournaled down paths
  (`0031` down drops `import_run.import_profile_id` first then `import_profile`;
  `0032` down drops the trigger and function), no data migration, nothing
  rewrites existing schema objects. Nothing pushed; nothing applied to
  DigitalOcean.
- **`DEC-080` data-quality-exception slice (committed as three commits since
  the `9d0e055` baseline; nothing pushed)**: `40b5d7e` (the `DEC-080`
  decision entry), `d1d0fad` (persistence migration `0030` — the
  `data_quality_exception` table + repository) and `ddc9e06` (the
  `transfer_discrepancy` producer in `receiveStockTransfer`) — each is
  independently revertible with `git revert <sha>`. Migration `0030` is
  **additive** (a new table, no data migration, nothing rewrites existing
  schema objects) with a rehearsed unjournaled down path (drop the table,
  delete the ledger row, re-migrate). Nothing pushed; nothing applied to
  DigitalOcean.
- **`DEC-079` cross-organization coherence guards (committed as two commits
  since the `a5c3db2` baseline; nothing pushed)**: `8376209` (the `DEC-079`
  decision entry) and `9d0e055` (persistence migration `0029` — the
  `BEFORE INSERT OR UPDATE` coherence guard triggers on `recipe_allergen`,
  `recipe_line` and `goods_receipt_line` + the deferred single-column FK on
  `goods_receipt_line.supplier_item_id`) — each is independently revertible
  with `git revert <sha>`. Migration `0029` is hand-written/journaled,
  forward-only, with a rehearsed **unjournaled** down path (drop the
  triggers/functions and the FK, delete the ledger row, re-migrate); no data
  migration. Nothing pushed; nothing applied to DigitalOcean.
- **`DEC-078` vocabulary/`lotTracked` slice (committed as four commits since
  the `80bbe1c` baseline; nothing pushed)**: `3673633` (the `DEC-078` decision
  entry), `ed93288` (persistence migration `0028` — the
  `settlement_status_check`/`reconciliation_scope_type_check` constraints +
  the vocabulary schema), `39d3364` (the `lotTracked` null-`lotId` guard in
  `postStockMovementInternal`) and `a5c3db2` (`scope_type` validation via
  `assertReconciliationScopeType`, incl. the review-strengthened
  message-assertion tests) — each is independently revertible with
  `git revert <sha>`. Migration `0028` is **additive** (two CHECK
  constraints + the new vocabulary type) with a rehearsed unjournaled down
  path (drop the checks/column default, restore the enum, delete the ledger
  row, re-migrate); no data migration. The docs commits are trivial reverts.
  Nothing pushed; nothing applied to DigitalOcean.
- Revert any commit with `git revert <sha>`; no destructive git operations.
- **Everything through `aa4ab29` is committed** (slices 4–7 and their review fixes
  included, with migrations `0006`–`0016` and additive down paths); `git revert`
  any commit.
- **Slice 7 (`400c95b`)**: `git revert 400c95b` removes the domain
  (`pricing.ts`/`cost-card.ts`), application (`CostCardStore`/`PriceScenarioStore`),
  migrations `0014`–`0016` and the `DEC-058`–`DEC-060` entries together;
  migrations `0014`–`0016` are additive with unjournaled `_down.sql` companions —
  the `0015`/`0016` down paths were rehearsed (drop the indexes/invariant, delete
  the ledger rows, re-migrate).
- **Slice-7 review fixes (`c82a30f`, `083106a`)**: each is an independent commit —
  `git revert c82a30f` removes the cross-organization reference guards on
  `calculateCostCard`/`calculatePriceScenario` plus the `0015`/`0016` runbook
  entries; `git revert 083106a` removes the pricing-primitive wiring into the
  scenario outcome, the two dead read-API removals, the contribution-boundary
  de-duplication and the `0014`/`0016` pre-apply preflight notes. Neither touched
  a migration or a generated file, so neither has a data-recovery concern.
- **Slice 8 + slice-9 persistence + web layers (committed as five layer commits;
  nothing pushed; HEAD `6c69f7f`)**: each is independently revertible with
  `git revert <sha>` — `583da3f` (infra deploy env vars), `b525f30` (stock ledger +
  stock-ops persistence, repositories, migrations `0017`–`0020`),
  `40e736b` (stock-valuation domain + client-safe subpath exports), `c91e512`
  (application slices), `6c69f7f` (design system, app shell, screens). Because they
  are layer commits over shared files, reverting the earliest layer (`b525f30`)
  alone may leave later layers referencing missing exports — revert the cohort
  together (or in reverse order) if reverting more than the topmost commit.
  Migrations `0017` (deferred FK + `goods_receipt` source guard), `0018` (per-org
  idempotency key), `0019` (`stock_movement_org_occurred_idx`) and `0020`
  (slice-9 `stock_count`/`stock_count_line`/`stock_transfer` tables +
  `stock_movement.transfer_id` + the extended source guard) are additive with
  rehearsed down paths (drop the added objects/tables/columns, delete the ledger
  row, re-migrate).
- **Rows 11 + 12 + ADR acceptance + the error-fix (all committed; nothing
  pushed)**: the row-11 import slice (migration `0022`), the row-12 sales +
  settlements + reconciliation slice (migration `0023`, vocabularies
  `RECONCILIATION_STATUS`/`OPTION_KIND`, domain `sales-consumption.ts`,
  application `sales/**` and `reconciliation/**`, web `/api/v1/sales/**` +
  `/api/v1/reconciliations/**` + `(app)/sales/**` + seed), the cross-cutting
  `jsonError`/`mapErrors` error-handling fix and the `ADR-0007`/`ADR-0008`
  acceptances landed on `main` (HEAD `77d913e`); each commit is revertible with
  `git revert <sha>`. Migrations `0022`/`0023` are additive with rehearsed down
  paths (drop the added objects/tables, delete the ledger row, re-migrate); the
  error fix touched no migration or generated file. Slices 9–12 shared barrel
  files, so reverting across a boundary may require reverting the cohort.
- **DEC-072–076 decisions + low-risk implementations (committed as seven
  commits since `bcb625a`; nothing pushed)**: six landed (`aaec400` the five
  decision entries; `dcec861` the eslint ignore for Agent Manager worktrees
  under `.kilo/`; `44eb93a` domain typed `NotFoundError` + `toleranceAmount`;
  `6ff5881` persistence migrations `0024`–`0026`; `301c381` application
  tolerance resolution + mapping conflict + `reverseSalesLine` + typed recipe
  404s; `c0b0d77` web recipe 404s + `conflict` label) plus this handoff/docs
  commit — each is independently revertible with `git revert <sha>`.
  Migrations `0024`–`0026` are additive with rehearsed unjournaled down paths:
  `0024` down drops the `reconciliation_tolerance` table + EXCLUDE constraint;
  `0025` down restores the four-value `MAPPING_STATE` checks (it fails if
  `conflict` rows exist — the preflight is documented); `0026` down drops the
  `sales_line_reversal_of_id_key` partial unique index. The eslint-ignore
  change and the docs commits are trivial reverts. No data migration; nothing
  pushed; nothing applied to DigitalOcean.
- **Price-version slice (`DEC-064`/`DEC-077`, committed as five commits since
  the `c0b0d77` baseline; nothing pushed)**: `4e755a0` (the `DEC-077` decision
  entry), `e94dfe1` (domain effective-window helpers), `414832b`
  (persistence `price_version` + repository + migration `0027`),
  `e2bd2b1` (application approval + reads, incl. the CAS
  `approvePriceScenarioIfApprovable`) and `80bbe1c` (web approve route +
  price-versions API + screens) — each is independently revertible with
  `git revert <sha>`. Migration `0027` is additive (a new table + its EXCLUDE
  constraint) with a rehearsed unjournaled down path (drop the constraint and
  the table, delete the ledger row, re-migrate); no data migration.
  The `4e755a0` docs commit and the handoff/docs commit are trivial reverts.
  Nothing pushed; nothing applied to DigitalOcean.
- **Slice 9 + slice-10 backend (committed as layer commits between `2a5799e`
  and `7f6aa78`)**: the counts/transfers/waste and production work (migration
  `0021`, domain `production.ts`, application `production/**`, the production
  web layer) is committed on `main`; each commit is revertible with
  `git revert <sha>`. Migrations `0020` (slice-9 stock-ops tables, committed in
  `b525f30`) and `0021` (slice-10 production tables) are **additive with
  rehearsed down paths** (drop the added tables/columns/FKs, delete the ledger
  row, re-migrate). Note: slices 9 and 10 shared barrel files
  (`packages/application/src/index.ts`, `packages/domain/src/index.ts`,
  `packages/persistence/src/index.ts`, `schema/index.ts`, `vocabularies.ts`,
  `_journal.json`), so their commits were able to be split only along those
  shared-file boundaries.
- **Deployment env vars (`583da3f`)**: the `ORGANIZATION_ID` /
  `TOTP_SECRET_ENCRYPTION_KEY` wiring in `infra/` is additive and conditional
  (unset adds no env var) — it changes no plan count (still **16 to add / 0
  change / 0 destroy** per env offline); `git revert 583da3f` undoes it. **No
  cloud resource was created and nothing has been applied to DigitalOcean.**
- **Decisions + fixture trail (`aa4ab29`)**: documentation only — the five
  `DEC-061`–`DEC-065` entries, the `ADR-0005` acceptance and the additive golden
  fixture trail/test (`tests/fixtures/`,
  `packages/domain/src/golden-fixtures.test.ts`). No migration or production
  code; `git revert aa4ab29` restores the prior state.
- The `infra/` scaffold, runtime stubs and persistence core are committed; revert
  them with `git revert` if needed. **No cloud resource was created — only offline
  `fmt`/`validate`/`plan` ran, never `apply`; no Terraform state exists, and
  nothing has been applied to DigitalOcean.**
- Migrations 0000–0050 are additive with tested down paths (`0011` down drops the
  four slice-6 tables; `0012` down drops the three EXCLUDE constraints; `0015`/
  `0016` down drop their indexes/invariant — rehearsed; `0017`–`0050` down are
  rehearsed — see the slice-8 bullet, the slice-9/10, row-11, row-12,
  DEC-072–076, price-version, `DEC-078`, `DEC-079`, `DEC-080`, `DEC-081`,
  `DEC-083`, `DEC-085` `file_object`, `DEC-089` HMS monitoring,
  `DEC-090` HMS incidents, `DEC-091` HMS checklists, `DEC-092` HMS
  equipment, `DEC-087` `employee`/personnel-documents, `DEC-088`
  staff-document and `DEC-094` workflow-platform bullets
  above; the `DEC-093` HMS compliance / evidence export slice added **no
  migration**). While the
  database is
  empty the tested recovery is `DROP SCHEMA public CASCADE; DROP SCHEMA drizzle
CASCADE; CREATE SCHEMA public; npm run db:migrate` (see the runbook). Once data
  exists, migrations must be additive (expand → migrate → contract) with a tested
  data-preserving down path (see `AGENTS.md` Rule 2).
- External writes require a documented rollback and per-source approval
  (`DEC-015`).
