# Project context

Canonical orientation for this repository: read this first when resuming work,
and update it at the end of any session that changes anything (code, docs,
decisions, data) — per `AGENTS.md` Rule 1. Reference artifacts by path; don't
duplicate their content.

Per-slice history, commits and rollback inventories live in **`docs/handoffs/`**
(one file per slice + `reversibility-log.md`); this file keeps only the live
orientation and the next step. See "Handover archive" and "Update protocol".

## Resume here (next session)

**Say "resume the work" and start here.** A fresh session must be able to
continue from this section alone. (Rewritten by the 2026-09-27 docs
session, after the jobs layer was completed — the real HTTP `202`
producer, the 90-day retention prune and the `DEC-139` item-8 alert
surfaces are delivered. Per-slice detail lives in the handoff files
under `docs/handoffs/`; this file does not restate them.)

**State:** branch `main`; HEAD **`398e698`** (the P2 platform core is
`c66eb27`; the `ADR-0004`/`DEC-139` docs commit is `3348e78`). The
**jobs layer is complete** — `DEC-139` fully delivered, and the recorded
follow-ups are now closed except the system-wide prune — committed across
nineteen layered commits, newest first: `398e698` (AI advisory row 17, migration
`0075`), `0424d73` (password reset via SendGrid,
`DEC-147`), `50b231e` (receipt → stock ledger,
`DEC-145`, migration `0074`), `5d8e285` (docs: the `DEC-141`–`DEC-148` owner
decision round), `18c4cf3` (docs: the jobs screen), `2796411` (the jobs operator screen),
`4c89702` (docs: `DEC-140`), `d070983` (the DB-backed worker
heartbeat, migration `0073`), `918b80a` (DLQ review automation + the
operator job list), `0aa54f3` (docs), `d3602d0` (honoured `scheduledAt`
via pg-boss `startAfter`), `94bd965` (migration `0072`, the job retention
index), `911ced6` (docs closing the jobs layer), `054355f` (the 90-day
retention prune + the item-8 alert surfaces), `ba27b79` (the real HTTP
`202` producer), `a84ce82`/`67e932d` (docs), `0da0593` (`apps/web` jobs
route + `infra/**` env and plan-time check), `8572510` (persistence:
pgboss provisioning + grants), `ecbe35b` (the runtime + payroll changes).
**Working tree clean; pushed to `origin/main`; nothing applied to
DigitalOcean.** Rollback: **`git revert` each commit**, then
`DROP SCHEMA pgboss CASCADE` **only when unwinding the whole jobs
stack** — facts stay in `public.outbox_event`; migrations `0072`'s and
`0073`/`0074`/`0075`'s down files invert the index, the heartbeat table, the
receipt-area columns and the AI tables. **5188/5188 tests (381 files)**;
migrations through
**`0075`** (101 public tables) plus
the migrator-provisioned **`pgboss`** schema (pg-boss schemaVersion 42);
`db:migrate` a no-op re-run. **Next free decision id `DEC-149`**
(`DEC-141`–`DEC-148` are the 2026-09-27 owner decision round). Know the
`packages/application/src/scheduling/scheduling.postgres.test.ts`
same-instant ordering flake (passes on re-run).

**Review-fix pass (`/review uncommitted`, 2026-09-26), committed in
`ecbe35b`/`0da0593`/`8572510`:** five of six findings fixed, one declined with
evidence
(full detail in handoff `085`'s "Review-fix pass" section). The migrator
(`packages/persistence/scripts/migrate.mjs`) now applies the pgboss runtime
grants itself after provisioning, under advisory lock `8675309`, to the
`PGBOSS_APP_ROLE` (default `app`; no-op when the role is absent; fail-closed
on a grants error), so `infra/bootstrap/pgboss-grants.sql` is
belt-and-braces/recovery only; the pgboss downgrade refusal names the
recovery command (`DROP SCHEMA pgboss CASCADE;`) and a pg-boss schema bump
blocks revert-by-redeploy until the drop; `infra/modules/app-platform/
main.tf` carries a non-blocking Terraform `check "organization_id_set"`
plan-time warning (both tfvars keep `organization_id = ""`; HCL unvalidated
here); and the `packages/jobs-runtime` cron handlers no longer trust
pg-boss-stored `job.data` (configured `organizationId`/`limit` win; a
mismatch logs a warning). Declined: narrowing `GRANT EXECUTE ON ALL
FUNCTIONS` — pinned pg-boss 12.33.2 defines only `create_queue`,
`delete_queue`, `job_now`, `job_table_format`, `job_table_run`,
`job_table_run_async` in `pgboss`, so the blanket grant covers exactly
those. Post-fix verification: **4957/4957 tests (361 files)**;
typecheck/lint/format:check clean; `next build` exit 0; `db:migrate` a
no-op.

**Next task: row 18 (automated connectors, `ADR-0010` Accepted — approved
sources: public competitor websites under the `DEC-020` rules plus the Wolt
menu subject to its terms, Instagram manual).** Delivered since the decision
round: the receipt→ledger wiring (`DEC-145`, `0074`), reset delivery via
SendGrid (`DEC-147`, `0424d73`) and **row 17 AI advisory** (`ADR-0009`,
`DEC-142`, migration `0075`, `398e698` — review foundation + scheduled run,
advisory only, kill switch default off). **WF-003 employee login is PAUSED
pending the owner decision** (account provisioning, approval model,
self-assign limit) — the question was raised and dismissed; do not guess it.
INTG-002 stays deferred (`DEC-141`); the deployment rehearsal stays parked
(`DEC-148`).

- **Scope (do):** pick the next item above; each has its decision row and
  the roadmap entry. The jobs layer and its follow-ups are **complete**
  (`DEC-139`/`DEC-140`).
- **Scope (do not):** no external publishing (INTG-002 stays gated on the
  per-source write terms I15/I18 under `DEC-015`); do not weaken any test
  assertion; do not resolve other recorded inputs silently.
- **Authoritative docs to read first:** `docs/adr/0004-jobs-and-outbox.md`;
  `DEC-139` in `12_OPEN_DECISIONS.md`;
  `docs/handoffs/084-2026-09-26-jobs-runtime-pgboss-wiring.md` + handoff
  `085` (the payroll slice); `docs/runbooks/deployment.md`.
- **Verification (exact):** `export NVM_DIR="$HOME/.nvm"; .
"$NVM_DIR/nvm.sh"; nvm use 22`; `npm run typecheck`; `npm run lint`;
  `npm run format:check`; `npm run build`;
  `DATABASE_URL=postgres://aquarela:aquarela@localhost:5432/aquarela npm
run test` (≥ **5188/5188**, 381 files); `npm run db:migrate` a no-op
  re-run. Normalise the generated `apps/web/next-env.d.ts`/
  `apps/web/tsconfig.json` with `git checkout --` before staging (see the
  durable fact below). Expect the
  `packages/application/src/scheduling/scheduling.postgres.test.ts`
  same-instant ordering flake to occasionally fail (passes on re-run).
  Commit in layers with the rollback approach in each body (Rule 2).
- **Acceptance criteria:** the picked slice/row is delivered per its
  decision rows and this section's rules; the read paths stay org-scoped
  and fail-closed on authorization; the full verification set is green
  (≥ 5188/5188, 381 files) with `build` included. For the follow-up
  option: the prune covers all organizations (the `(organization_id,
created_at)` index landed in migration `0072`, rehearsed down
  path), the heartbeat divergence check is DB-backed or the log alert
  is recorded as sufficient, and the DLQ review loop is automated or
  explicitly rejected with a reason.
- **Rollback:** revert each commit (or `git checkout` the tree
  pre-commit); a schema change is not expected — if one lands, follow
  expand → migrate → contract with a rehearsed down path and a runbook
  row before finishing.

**Honest remainder / open items (recorded, do not silently defer):**

1. The payroll report generated in the month's lead window is
   **provisional** — it under-counts the remaining days of the
   in-progress period (`DEC-104`); `DEC-104` items 5/9/10 stay open and
   the handler's conservative refusal to supersede an `exported` report
   is **deliberate** (it throws inside the same `FOR UPDATE`-locked
   transaction that generates, so the posture holds under redelivery).
2. Delayed delivery is implemented at the enqueue level
   (`OutboxDispatchEvent.scheduledAt` → pg-boss `startAfter`, preserved on
   replay, `d3602d0`) but nothing yet passes a `scheduledAt` — the payroll
   cron fires on its daily lead-window guard, not at a scheduled instant.
3. The jobs access set `JOBS_READ_ROLES`
   (owner/general_manager/finance/admin) is **provisional** per
   `DEC-101`.
4. The **scheduler now requires `ORGANIZATION_ID`** (the maintenance
   replay and the payroll cron are organization-scoped) and exits 1
   without it; `web` and `scheduler` both carry it.
5. Terraform is unvalidated here (the binary is absent in the session
   environment); `infra/modules/app-platform/main.tf` now gives the
   scheduler component `ORGANIZATION_ID` and carries a **non-blocking**
   plan-time `check "organization_id_set"` warning when `organization_id`
   is empty (deliberately not a `validation`/`precondition`: both env
   tfvars keep `organization_id = ""` and the offline `plan` must keep
   working).
6. A post-success projection-write failure causes an extra supersede
   cycle on the next delivery — audit churn only, settled state wins.
7. The **90-day `job` retention prune is organization-scoped
   (single-tenant)** and has no `created_at` index to lean on until the
   `0072` index (it ran off `job_org_status_scheduled_idx`); the
   system-wide prune (the `(organization_id, created_at)` index landed
   in migration `0072`) is the recorded follow-up.
8. The `DEC-139` item-8 alerts are **log surfaces only** —
   `jobs.dead_letter`, `jobs.queue_depth`, `jobs.oldest_queued_age`,
   `jobs.stuck_pending` must be wired to DO log monitoring (grouped/
   deduped; `docs/runbooks/deployment.md`); the **dead-letter alert
   re-alerts every 5 min until reviewed** (30-day retention; the weekly
   DLQ review runbook is in the deployment runbook, review automation
   is the follow-up); the **worker heartbeat is a platform log alert**
   (pg-boss 12 keeps WIP in memory — a DB-backed heartbeat is the
   follow-up if cross-process detection is needed).
9. Queue-existence deploy ordering: the payroll producer creates its
   outbox queue **lazily**, so it works regardless of worker/scheduler
   boot order; a new producing process should do the same.
10. `retryLimit 5` vs `maxAttempts 5`: the 6th delivery of a failed event
    is a settled no-op — documented in `packages/jobs-runtime` code
    (the `reviewer-glm` item).
11. Partitioned queues would need migrator pre-creation, because `app`
    lacks DDL.
12. INTG-002/external publishing is now gated **only** on the per-source
    write terms I15/I18 under `DEC-015` (`ADR-0004` is no longer a gate).

**Process note — one worktree, one writer:** a second session was found
running concurrently in this same worktree before (orphaned background
tasks from a previous session), editing and committing the same files; git
mutations collided and one edit briefly broke the build. Two sessions must
not drive one worktree. **At session start, check for a concurrent writer**
(recent file mtimes, `git reflog`, unexpected new commits) **before
editing**.

**Durable facts:**

1. `npm run build` must be in every verification pass — typecheck/lint/
   tests do not catch client-bundle breakage (the `@aquarela/domain` barrel
   case, fixed by `3054512`).
2. `apps/web/next-env.d.ts` and `apps/web/tsconfig.json` are **generated
   artifacts** rewritten by every `next build`/`next dev` for the active
   `NEXT_DIST_DIR`; normalise with `git checkout -- apps/web/next-env.d.ts
apps/web/tsconfig.json` before staging.
3. The scheduling same-instant ordering flake (above) passes on re-run.
4. Dev server (session-scoped, still current):
   `DATABASE_URL=postgres://aquarela:aquarela@localhost:5432/aquarela`,
   `ORGANIZATION_ID=1448a476-32f2-426f-b153-11a851011e48`; sign in
   `owner` / `LocalDevPass123`; MFA disabled for `owner`; demo data
   seeded including the `zettle-legacy` `import_profile`. A fresh session
   must restart the server.

## Next up (prioritised)

`docs/BUILD_ROADMAP.md` is the ordered execution tracker; §5 carries the
open-point lists. Per-slice detail is in `docs/handoffs/`. The detailed list
lives in the second "Next up" section below.

1. **The jobs layer is COMPLETE — `DEC-139` fully delivered (HEAD
   `054355f`).** The pg-boss wiring, the first real producer/consumer,
   the real HTTP `202` producer (`POST
/api/v1/workforce/payroll-reports?async=true` → `202` +
   `Location: /api/v1/jobs/<id>`), the 90-day `job` retention prune and
   the item-8 alert surfaces (`jobs.dead_letter`, `jobs.queue_depth`,
   `jobs.oldest_queued_age`, `jobs.stuck_pending`; the worker heartbeat
   via a platform log alert) are all committed. **Next task: the last
   `DEC-139` follow-up (the system-wide prune; the `(organization_id,
created_at)` index landed in `0072`) or an owner decision to unblock a
   programme row** — the DLQ review automation and the DB-backed worker
   heartbeat (`jobs.worker_heartbeat_missing`, migration `0073`) landed
   2026-09-27 — exact scope, verification, acceptance criteria and honest
   remainder in "Resume here" (next free decision id `DEC-149`).
2. **Then the honest-gap queue** (each recorded, not silently deferred):
   the remaining `DEC-139` follow-up (the system-wide prune) and the
   standing owner/data-gated items (reset-token
   delivery, the unsigned golden fixtures, the `task`↔`approval` link,
   `WF-003` self-assignment, the deployment prerequisite inputs, the
   receipt→ledger `storage_area_id` policy).
3. **Rows 13/12/11 and the close-outs delivered — COMPLETE.** Row 13 (close
   13a/13b + reporting 13c/13d/13e-f), the cost-card composition chain
   (`DEC-111`/`DEC-112`), the row-11 import mapping writer (`DEC-113`), the
   volume denominators + recurrence normalisation (`DEC-114`/`DEC-115`), the
   correction/reversal wiring (`DEC-116`), the reversal gate (`DEC-117`),
   the settlement netting (`DEC-118`) and the operator-driven daily close
   (`DEC-119`) — all delivered, per their decision rows and handoffs. The
   recorded follow-ups (posture gaps listed above) remain open, not silently
   deferred.
4. **Receipt→ledger wiring — the lead item, gated:** on the **OPS receipt
   destination `storage_area_id` policy** (a recorded owner input). If it has
   not landed it stays blocked; do not resolve the policy silently
   (`post-stock-movement.ts`; `docs/BUILD_ROADMAP.md` §5 slice-8 entry).
5. **Owner/OPS/data inputs** (gate the remaining roadmap items): the OPS
   `storage_area_id` policy; the FIN variance-tolerance thresholds; the
   privacy-review retention periods per file class; history/grain quality (I11);
   the deployment prerequisite inputs; the six golden-fixture signatures; the
   **WF-003 self-assignment login model**; the **`DEC-102`/`DEC-103`/`DEC-104`
   provisional items**.
6. **Test-deployment rehearsal** (`docs/runbooks/deployment.md`) — staging first
   with sanitized/synthetic data only; parked on the deployment prerequisite
   inputs.
7. **Golden-fixture sign-off** — the six fixtures are prepared as machine-readable
   JSON under `tests/fixtures/` (`DEC-065`); finance + product owner sign (the
   "verified" gate); `I8`/`I9` still gate the real rates behind them.
8. **Rows 15–18 and the competitor/planning waves** — competitor manual
   observations landed in the completion programme (see the decisions rows);
   row 15's forecast-tracking slice is **delivered** (`DEC-138`,
   owner-authorized), rows 17–18 remain blocked
   (`ADR-0009`–`0010`; row 16's registry slice INTG-001 is
   delivered, INTG-002 now gated only on I15/I18 under `DEC-015` — `ADR-0004`
   is no longer a gate since its 2026-09-26 acceptance).

## What this is

**Aquarela Business Control** — a secure, testable modular monolith for an Oslo
café with two locations, covering costing, pricing, inventory, production,
sales/imports, workforce and reporting. It is **documentation-first**: Phase 0 is
complete (specification, 65 accepted decisions, artifacts and ADRs).

Built and committed: the foundation scaffold; the Phase 1–2 persistence core; the
auth slices (1a–1e); the UI token foundation; master-data slices 2–3; slice 4
(receipt + price history + landed cost); slice 5 (recipes); slice 6 (operating
costs + labour + allocation); slice 7 (cost card + snapshots + price scenario +
approval); slice 8 (stock ledger + balances + lots/storage); slice 9 (counts +
transfers + waste); slice 10 (production planning + batches, incl. web); row 11
(import framework + external mappings, complete); row 12 (sales + settlements +
reconciliation, complete); the `DEC-072`–`DEC-085` low-risk implementations; the
`DEC-086`–`DEC-094` programme (HMS monitoring/incidents/checklists/equipment/
compliance export; the `employee` + personnel-documents slice; the staff document
library; the schema-only workflow platform); and row 14 (workforce/scheduling —
14a shifts, 14b-1 worked hours, 14b-2 payroll report), which is **complete**;
and the operations-completion programme (`docs/ROADMAP-OPERATIONS-COMPLETION.md`,
waves W1–W7 — wiring, master-data authoring, recipes, production, tasks/
administration, intelligence/simulation, UI refinement; `DEC-120`–`DEC-128`)
which is **delivered as a wave programme**, with an enumerated honest-gap list
in "Next up" / Current status.

Per-slice detail, commits and reconciliation are in `docs/handoffs/`.

## Where things live

- `00_README.md` … `13_AGENT_BUILD_BRIEF.md` — the specification package
  (inputs, rarely edited). Start with `00_README.md`.
- **`12_OPEN_DECISIONS.md` — the accepted decisions (`DEC-001`…`DEC-139`);
  the authority. New decisions are appended here (next free id `DEC-149`).**
- `docs/phase0/` — close-out plan, calculation contract, data dictionary, golden
  fixtures, source-data request, notes. See
  `docs/phase0/CALCULATION_CONTRACT.md`.
- `docs/adr/` — architecture decision records `0001`–`0012`.
- `docs/runbooks/` — operator runbooks (`persistence-migrations.md`, `deployment.md`).
- `docs/BUILD_ROADMAP.md` — the ordered slice backlog and per-slice execution loop
  (a derived execution tracker; decisions and accepted ADRs stay the authority).
- `docs/handoffs/` — **the handover archive**: one file per completed slice
  (verbatim work-log entry, newest first in `README.md`), `reversibility-log.md`
  (per-slice commit/rollback inventory) and `context-sections-archive-2026-09-22.md`.
- `schemas/` — draft DDL and domain enums (`schemas/phase1_2_draft.sql`,
  `schemas/domain-enums.yaml`).
- `samples/` — real POS exports, screenshots and templates (reference data).
- `packages/*` and `apps/*` — code (config, logger, domain, application,
  persistence; `web`, `worker` and `scheduler` runtimes).
- `AGENTS.md` — the rules (handoff/work log, reversibility, decisions).
- `CONTEXT.md` — this file.

## Current status

- **2026-09-27 — AI advisory delivered, row 17 (`ADR-0009`, `DEC-142`,
  migration `0075`, committed `398e698`, pushed):** the append-only
  `ai_analysis_run` provenance + mutable `ai_suggestion` review state machine
  (99→101 tables), the application commands and the `GET /api/v1/ai/suggestions`
  - approve/reject routes (`AI_READ_ROLES`/`AI_DECIDE_ROLES`, fail-closed), the
    `/ai` review-queue screen, and the provider-agnostic `LlmPort` + the
    OpenAI-compatible adapter with the `outbox.maintenance.ai_advisory` cron
    (guard order kill switch `AI_ADVISORY_ENABLED` default false → configured →
    cost caps → call; provider failure records a `failed` run). **Advisory only:
    no external publish, no auto-apply.** **5188/5188 tests (381 files)**; `0075`
    down rehearsed on a scratch DB. **Cost caps are inert until pricing exists**
    (the adapter returns no cost estimate).
- **2026-09-27 — password reset delivered via SendGrid (`DEC-147`,
  committed `0424d73`, pushed):** a transport-agnostic `MailPort`
  (`packages/application/src/auth/mail.ts`) + a SendGrid v3 adapter
  (`apps/web/lib/mail.ts`; `POST /v3/mail/send`, HTTP 202 success, 10 s
  timeout); fail-closed unless `SENDGRID_API_KEY`/`MAIL_FROM`/`APP_BASE_URL`
  are set, transport failure swallowed+logged without the token, reset link
  token-free with the code in the email body (`ADR-0003`), request
  enumeration-safe. Security review passed. **5106/5106 tests (373 files)**.
  No migration.
- **2026-09-27 — receipt → stock ledger wired (`DEC-145`, committed
  `50b231e`, pushed):** migration `0074` adds `location.default_storage_area_id`
  and `goods_receipt.storage_area_id` (expand-only nullable FKs) plus two
  cross-location coherence guards; `recordGoodsReceipt` resolves
  `override ?? location default`, fails closed when neither resolves, and posts
  one `receipt` `stock_movement` per line in the receipt transaction with a
  `receipt-<receiptId>-<lineId>` idempotency key; `POST /api/v1/receiving/receipts`
  takes the optional override and a new Administration route sets the location
  default. **5093/5093 tests (370 files)**; guards + down rehearsed on a scratch
  DB.
- **2026-09-27 — owner decision round (`DEC-141`–`DEC-148`, recorded; next
  free `DEC-149`):** INTG-002 stays deferred/read-only (`DEC-141`);
  `ADR-0009` **Accepted** — AI advisory, advisory-only, provider-agnostic
  adapter (`DEC-142`); `ADR-0010` **Accepted** — approved sources are public
  competitor websites plus Wolt subject to its terms, Instagram manual
  (`DEC-143`); the six `DEC-065` golden fixtures are **signed as-is**
  (`DEC-144`); receipt destination area = the receiving location's default
  with explicit override (`DEC-145`); employees **do** log in for their own
  shifts (`DEC-146`); password reset delivers via **SendGrid** (`DEC-147`); the
  deployment rehearsal stays parked (`DEC-148`).
- **2026-09-27 — the jobs operator screen delivered (committed `2796411`,
  pushed):** a `/jobs` page (server, `JOBS_READ_ROLES`-gated, default
  `dead_lettered` filter, offset pager, the same org-scoped `listJobs` the API
  serves) plus a client register whose Retry/Discard actions are
  `JOBS_ADMIN_ROLES`-only on dead-lettered rows, behind a confirmation modal,
  never rendering `payload`/`error`; a nav entry; pure labels helpers + a test.
  Browser-verified as owner. **5081/5081 tests (369 files)**; no migration.
- **2026-09-27 — jobs operator tooling delivered (committed `918b80a` +
  `d070983`, pushed):** DLQ review automation (`GET /api/v1/jobs`, `POST
/api/v1/jobs/[id]/retry|discard` under `JOBS_ADMIN_ROLES`; retry
  re-dispatches with the maintenance replay as the safety net, discard also
  stamps the outbox published so the replay cannot re-run it) and the
  DB-backed worker heartbeat (migration `0073`, the `worker_heartbeat`
  table; `jobs.worker_heartbeat_missing` > 120 s). No migration in the DLQ
  work; `0073` in the heartbeat. **5075/5075 tests (368 files)**.
- **2026-09-27 — the jobs layer is COMPLETE (`DEC-139` fully delivered;
  HEAD `054355f`, working tree clean, nothing pushed):** the two
  2026-09-26 entries below are committed as part of the seven-commit
  jobs stack (`ecbe35b`…`054355f`). `ba27b79` added the real HTTP `202`
  producer — `POST /api/v1/workforce/payroll-reports?async=true`
  returns `202` + `Location: /api/v1/jobs/<id>`; the `web` process
  needs the migrated `pgboss` schema and creates its outbox queue
  lazily (independent of worker/scheduler boot order). `054355f` added
  the 90-day `job` retention prune and the `DEC-139` item-8 alert
  surfaces (`jobs.dead_letter`, `jobs.queue_depth`,
  `jobs.oldest_queued_age`, `jobs.stuck_pending`; the worker heartbeat
  is a platform log alert — pg-boss 12 keeps WIP in memory; a
  DB-backed heartbeat is the follow-up if needed).
  `docs/runbooks/deployment.md` gained the Monitoring extension (the
  `MONITOR_CRON` env, the `jobs.*` alert keys, monitor liveness, the
  worker heartbeat, the DLQ weekly review and the retention notes) and
  `docs/BUILD_ROADMAP.md` row 20 records completion. **Verification:**
  **4991/4991 tests (362 files)** with `DATABASE_URL`;
  typecheck/lint/format:check clean; `next build` exit 0; `db:migrate`
  a no-op; **no migration**. **Rollback:** per-commit `git revert` +
  `DROP SCHEMA pgboss CASCADE` only when unwinding the whole jobs
  stack. **Next:** the remaining `DEC-139` follow-ups or the next
  programme slice (see "Resume here").
- **2026-09-27 — the last two `DEC-139` follow-ups closed (committed
  `94bd965` + `d3602d0`, pushed):** migration `0072` adds
  `job_org_created_at_idx (organization_id, created_at)` so the
  org-scoped, terminal-only retention prune range-scans `created_at`
  (drizzle-generated, expand-only; down companion drops the index;
  rehearsed on a scratch DB; a data-backed `EXPLAIN` shows the
  `Bitmap Index Scan`), and the `scheduledAt` fix makes
  `OutboxDispatchEvent.scheduledAt` reach pg-boss `startAfter` and
  preserves the projection's schedule on replay. **Verification:**
  **4995/4995 tests (362 files)**; typecheck/lint/format:check clean;
  `next build` exit 0; `db:migrate` a no-op.
- **2026-09-27 — jobs layer completed (committed `ba27b79` + `054355f`,
  since pushed):** the real HTTP `202` producer (`POST
/api/v1/workforce/payroll-reports?async=true` → `202` +
  `Location: /api/v1/jobs/<id>`), the 90-day retention prune and the
  item-8 alert surfaces.
- **2026-09-26 — the first real async producer/consumer delivered
  (committed in `ecbe35b`/`8572510`/`0da0593`/`67e932d`; HEAD at the
  time `3348e78`):** the scheduled monthly payroll-report generation
  (`ADR-0004`/`DEC-139` item 5 + `DEC-104`) + the HTTP job-progress
  route. **What landed (uncommitted at the time; now committed; no migration):** the
  `payroll-schedule` cron producer in `packages/jobs-runtime` (daily,
  default `0 5 * * *`, `missed:'once'`; candidate period = current UTC
  month when `day >= lastDay-3`, else previous UTC month when `day <= 5`
  (outage catch-up), else skip; skip when a live report exists; enqueue
  is atomic with the outbox+job+queue+audit in one transaction via
  `fromDrizzle`); the real `payrollReportGenerateHandler` (reads the
  period from the durable `job` projection; refuses to supersede an
  `exported` report — throwing inside the same `FOR UPDATE`-locked
  transaction that generates, so `DEC-104` items 5/9/10 stay open; calls
  `generatePayrollReport(..., actorId: null)`); `apps/scheduler` passes
  `PAYROLL_CRON`; `packages/application` `generatePayrollReport`
  `actorId` widened to `string | null`; `lastDayOfUtcMonth` exported
  from `@aquarela/domain`; new `GET /api/v1/jobs/[id]` (org-scoped
  job-progress read; `JOBS_READ_ROLES = owner/general_manager/finance/
admin` provisional per `DEC-101`; omits `payload`/`error`;
  400/401/403/404); `infra/modules/app-platform/main.tf` gives the
  scheduler component `ORGANIZATION_ID`. **Verification:**
  typecheck/lint/format:check clean, `next build` exit 0,
  **4957/4957 tests (361 files)** with `DATABASE_URL`; `db:migrate` a
  no-op (`pgboss` schema up to date, pg-boss 42); nothing pushed,
  nothing applied to DigitalOcean. **Review-fix pass** (`/review
 uncommitted`): 5 findings fixed (migrator-applied pgboss grants +
  `PGBOSS_APP_ROLE`; the downgrade refusal names
  `DROP SCHEMA pgboss CASCADE;`; the Terraform plan-time `check
 "organization_id_set"` warning; the cron handlers no longer trust
  pg-boss-stored `job.data`), 1 declined with evidence (narrowing
  `GRANT EXECUTE ON ALL FUNCTIONS` — pg-boss 12.33.2 defines only the six
  queue/partition functions, so the blanket grant covers exactly those);
  post-fix **4957/4957 tests (361 files)**, `db:migrate` a no-op — detail
  in handoff `085`'s "Review-fix pass" section. **Rollback:** `git checkout` the
  tree (or `git revert` each commit once committed); `DROP SCHEMA
pgboss CASCADE` only when unwinding the whole jobs stack. **Next:**
  the HTTP `202` producer + the remaining `DEC-139` items (see
  "Resume here").

- **2026-09-26 — the jobs-runtime pg-boss slice delivered (committed in
  `ecbe35b`/`8572510`/`0da0593`/`67e932d`; HEAD at the time
  `3348e78`; the P2 platform core is `c66eb27):**
`ADR-0004` **Accepted** (2026-09-26, owner/tech lead) per
**`DEC-139`** — runner pg-boss pinned `12.33.2`, delivery shape P2
(`outbox_event`durable, consumers dedup on`outbox_event.id`, the
runner's queue disposable/replayable). **Objective (item 9):** the
pg-boss worker wiring and scheduler cron, proven with a non-external
consumer and a scheduled maintenance job. **What landed
(uncommitted at the time; now committed):** `packages/jobs-runtime` — the boss factory
(`schema:"pgboss"`, `migrate:false`, `createSchema:false`,
`useListenNotify:false`), per-event-type queues `outbox.<eventType>`with DLQ`outbox-dead-letter`and retry/backoff,`createPgBossDispatcher`(binds`send`to the caller's transaction via`fromDrizzle(tx, sql)`, `id = outboxEvent.id`, duplicate → `null`no-op), the idempotent`createOutboxConsumer`, the non-external
`platform.smoke`consumer (append-only audit), and the scheduled
maintenance job **replaying unpublished outbox rows** (P2 recovery);`apps/worker|scheduler` thin wrappers; the pre-deploy migrator
(`packages/persistence/scripts/migrate.mjs`) provisions/migrates
`pgboss`under advisory lock`8675309`(no`_journal.json`entry, no
numbered migration) with the idempotent`infra/bootstrap/pgboss-grants.sql` (`app`DML-only). **Verification:**
typecheck/lint/format:check clean,`build`exit 0,
**4913/4913 tests (357 files)** with`DATABASE_URL`; migrations
through `0071`plus the migrator-provisioned`pgboss`schema
(pg-boss 42);`db:migrate`a no-op re-run; the`DROP SCHEMA pgboss
  CASCADE`down rehearsal kept`public.job`/`public.outbox_event`and
the 98 public tables intact (scratch DB, never the dev DB). **Review
reconciliation:**`reviewer-qwen`two blockers fixed (the`pgboss`GRANTs gap; no runtime DDL);`reviewer-minimax`endorsed the dedicated
migrator step;`reviewer-glm`fixes applied (listeners,`batchSize: 1`,
dead-code removal, `retryLimit`vs`maxAttempts`arithmetic
documented);`qa-verifier`**ACCEPT** on all ten criteria. **Rollback:**`git checkout`the tree (or`git revert`each commit once committed),
then`DROP SCHEMA pgboss CASCADE`— facts stay in`public.outbox_event`;
migration `0071_job`untouched. **Next:** the first real
producer/consumer + the HTTP`202` job URL/progress route (see
  "Resume here").

- **2026-09-25 — the forecast-vs-actual tracking slice delivered
  (`DEC-138`, the row-15 override owner-authorized; HEAD `4ba3ced` +
  the docs commit on top):** roadmap row 15's `blocked (data)` gate
  overridden by owner authorization; accuracy stays honest on history
  (I11). **Objective:** build the forecast-tracking slice — migration
  `0070` (expand-only `forecast_snapshot` + `forecast_override`),
  persistence/application, routes and the tracking screen replacing the
  insights honest-gap card; `insufficient_history`/`no_snapshot` are
  first-class results, no fabricated figure; overrides append-only with
  a mandatory reason, advisory only, never auto-applied. **Commits
  (chronological):** `e52f4e5` (migration `0070` + persistence +
  application), `7c06fdd` (routes + tracking screen), `4ba3ced` (the
  review hardening), plus the `docs(...)` commit on top (handoff
  `083`, runbook row, reversibility log, `DEC-138` row, roadmap row 15,
  CONTEXT). **Verification:** typecheck/lint/format:check clean,
  `next build` exit 0, **4873/4873 tests (349 files)** with
  `DATABASE_URL`; `0070` applied (no-op re-run); the `0070` down path
  rehearsed on a scratch DB (never the dev DB). **Review
  reconciliation:** `reviewer-qwen` — one major (cross-org `snapshotId`
  IDOR) accepted and fixed in `4ba3ced`, plus two minors; a
  transaction-port type hole fixed in the same commit.
  `reviewer-minimax` — (1) the missing `0070` runbook row **accepted**
  (this docs wave); (2) the app-only `DEC-011` grain ceiling
  (the DB check accepts category/product) **DECLINED with reason**: the
  DB models the full declared vocabulary and the ceiling is enforced at
  the single port `requireSupportedForecastGrain`; three minors — the
  `sql` re-export tag fixed, the `actor_id` FK deferral and the text
  `period` accepted as recorded. Browser verification **PASS** at
  1280/390 (`/insights`, `/insights/forecast`, genuine `no_snapshot`,
  empty override reason refused). **Rollback:** run
  `0070_forecast_snapshot_forecast_override_down.sql` (destructive only
  to forecast snapshots/overrides; no posted money or stock fact), then
  `git revert` each commit. **Next:** the standing owner/data-gated
  items (see "Resume here").

- **2026-09-25 — the Integrations registry delivered (INTG-001; HEAD
  `64415db` + the docs commit on top):** the last "No backend"
  Administration bullet closed as a read-only, per-source governed
  `integration_source` register. **Objective:** establish the registry
  (INTG-001) per **`ADR-0011` Accepted** (2026-09-25, owner + tech lead)
  and **`DEC-137` accepted** (not provisional), without building
  publishing. **Commits (chronological):** `9508f1e` (migration
  `0069_integration_source.sql` + persistence + application + seed),
  `02c3081` (ADR-0011 Accepted + `DEC-137` + roadmap row 16), `ef23028`
  (GET/POST/PATCH `/api/v1/administration/integrations` + the
  Administration register screen + labels), `23f803f` (dedupe
  `allowed_operations` + the down-file rehearsal note), `64415db`
  (runbook `0069` row + ADR-0011 status refs). **Verification:**
  typecheck/lint/format:check clean, `next build` exit 0,
  **4807/4807 tests (342 files)** with `DATABASE_URL`; `db:migrate`
  applied `0069`; the `0069` down path rehearsed on a scratch DB (never
  the dev DB). Migrations through `0069`; **95 public tables**;
  `publish_run` not built (INTG-002 gated on `ADR-0004`). Access owner +
  admin fail-closed; no secret stored; no external call; no posted fact
  touched. **Review reconciliation:** `reviewer-qwen` no blockers (one
  minor accepted, fixed in `23f803f`); `reviewer-minimax` no blockers
  (runbook row + rehearsal note accepted and fixed; the `auditColumns()`
  and `direction`-without-write-op notes recorded in the `DEC-137` row);
  nothing declined. **Rollback:** run
  `0069_integration_source_down.sql` (destructive only to registry
  configuration), then `git revert <sha>` each commit. **Next:** the
  DEC-138 forecast-vs-actual tracking slice (see "Resume here").

- **2026-09-25 — the concurrency audit (`2da9ba5` HEAD, docs-only):**
  audited the git history for damage from two sessions that ran
  concurrently in this one worktree earlier that day, and recorded the
  rollback truth the collision had left out. **Findings:** `main` is
  linear and intact — no history rewrite, no rebase, no force-push, no
  lost commits; working tree clean; HEAD verified green this session
  (`typecheck` clean, `next build` exit 0, `DATABASE_URL=… npm run test`
  → **4735/4735 (335 files)**). **Evidence:** `git reflog` shows two
  `reset: moving to HEAD` collisions on HEAD at 11:46:02 and 11:49:18;
  `2a4a189` (the `DEC-135` shared rate-limit store) was committed with a
  narrow pathspec and left HEAD broken in two ways — the committed
  per-route `limiters.ts` were async while call sites stayed synchronous
  (all reporting/analytics/simulation traffic denied) and migration
  `0067` landed without the drizzle table definition/barrel/
  `EXPECTED_TABLES`; `5013011` completed the layer fix-forward (no
  amend); the `next build` break from the client form importing the
  `@aquarela/domain` barrel was fixed by `3054512`. Nine dangling commits
  are all superseded Sep-19–24 stash WIP, not concurrency loss; no
  `.git/index.lock` and no in-progress git op. **Changed this session:**
  `2da9ba5` recorded the `DEC-135` pair (`2a4a189`+`5013011`) and
  `1a791eb` in `docs/handoffs/reversibility-log.md` with the rule that
  `2a4a189` alone is not trustworthy, and corrected the stale
  "rate-limiter shared store" open item in
  `docs/handoffs/081-…wave.md`. **Rollback:** `git revert 2da9ba5`
  (docs-only, no migration, no schema change). **Next:** the Integrations
  Administration backend (unchanged).

- **2026-09-25 — the `DEC-129`/`DEC-132` wave and the close-out (`9842d81`
  HEAD, newest first: `3054512`, `6bfd5cd`, `67ee852`, `bef5459`,
  `ac98d87`, `9c2c976`, `358bc58`, `4c423c5`, `2805deb`, then the 081 wave
  `4e2736c`…`c451c38`):** the wave documented in
  `docs/handoffs/081-2026-09-25-design-system-and-storage-port-wave.md`
  (design-system stages 2–4 + corrections; the `DEC-132` `file_object`
  storage port with the document-library consumer) plus the close-out
  commits on top: a11y/touch targets — WCAG 2.5.8 link targets
  (`2805deb`), skip-link focus + drawer focus return (`4c423c5`),
  insights/sales action links right-sized (`358bc58`); tax-rule authoring
  from Administration with **`DEC-136`** recorded provisional —
  create/supersede commands, routes, register + form (`9c2c976`), eight
  review-found defects fixed (`ac98d87`), the in-memory fake aligned
  (`bef5459`); the `goods_receipt_line.applied_tax_rate` provenance column
  as **migration `0068`** with a rehearsed (unjournalled) down path
  (`67ee852`, `6bfd5cd`); and the client-bundle build fix (`3054512`,
  see the durable fact in "Resume here"). Verification: `typecheck`,
  `lint`, `format:check`, `build` clean; **4735/4735 tests (335 files)**
  with `DATABASE_URL`; migrations through `0068`, **93 tables**
  (a nullable column, no new table); nothing pushed. Reverts commit by
  commit (`git revert <sha>` each; migration `0068` per the reversibility
  log).

- **2026-09-25 — the HMS unblock and the Administration backends
  (`6ba0f0a` HEAD, newest first: `6ba0f0a`, `968ca2e`, `8a4a5f0`,
  `03b2533`, `c451c38`, `70f2525`, `4443364`):** seven commits on `main`,
  all unpushed, no migration (through `0066`, 93 tables), closing the HMS
  blockade and five of the six "No backend" Administration bullets.
  `6ba0f0a` records **`DEC-131`** (users/scopes management, decision rows
  only). `968ca2e` `feat(admin): manage users, roles and location scopes`:
  `assignRole`/`replaceLocationScopes`/`disableUser` already existed
  (audited, with session revocation on privilege change per `ADR-0003`), so
  the real gap was the reads — `listUsers`/`listRoles` (org-scoped,
  bounded, never returning password hashes/TOTP secrets/recovery codes) —
  plus the symmetric `revokeRole`/`enableUser` commands and the
  `auth.user.enabled` audit action; routes under
  `/api/v1/administration/**` gated on `ADMIN_USERS_ROLES` (owner + admin,
  from the §7.1 Users/configuration matrix row); "Users & access" section;
  a review-found paste-the-id defect fixed (grant/scope dialogs now
  location pickers showing `code · name`; an unknown location id is a 400
  naming the id, not an FK 500, with a regression test). **User creation is
  deliberately NOT built** — the open question behind `DEC-131`.
  `8a4a5f0` `feat(admin): read surfaces for units, data quality and audit`:
  three of the six "No backend" bullets never had missing backends — the
  tables (`unit`, `data_quality_exception`, `audit_event`) and write paths
  existed and only a read plus a screen were absent; bounded org-scoped
  reads, routes and sections added; the audit route deliberately omits the
  before/after payloads; the Administration "Not available yet" list is now
  down to **Tax/rules and Integrations**. `03b2533`
  `feat(hms): register a monitoring point`: `monitoring_point` had zero
  rows and no screen could create one (`70f2525` alone left recording
  unusable); new `register-point-form.tsx` posts to the existing route and
  `registerMonitoringPoint` command; options from `listLocations`/
  `listStorageAreas`; `unit` free text with the `DEC-071` note; verified
  end to end in the browser as the owner. `c451c38`
  `docs: correct the DEC-129 shell claim`: a false statement previously
  recorded — the live shell is **already a light rail**
  (`apps/web/app/(app)/layout.tsx:101`, `background-color: transparent
!important` on the frozen `NavList`/`NavItem`), so
  `navigation.background`/`navigation.backgroundHover`/`brand.navyDeep`
  are dead for the rail and the remaining shell work is token alignment
  plus retiring those primitives, not a dark-to-light conversion; fixed
  in the `DEC-129` rows, the `tokens.ts` header and here. `70f2525`
  `fix(hms): let the owner and general manager record monitoring
readings`: the system owner was denied recording because
  `HMS_RECORD_ROLES` was the **only** `*_ROLES` array in the repository
  omitting `owner` (no implicit bypass exists in `isAuthorizedFor`, by
  design); the role was added, a regression guard
  (`packages/application/src/auth/roles.test.ts`) now fails the build if
  any `*_ROLES` array omits `owner`, and one test using `["owner"]` as its
  out-of-set role example was re-pointed to `purchasing`.
  `4443364` `docs: amend the HMS monitoring-log matrix row and record
DEC-130`: the §7.1 row moves to Record for owner and GM, matching the
  code. Verification: `typecheck`, `lint`, `format:check`, `build` clean;
  **4430/4430 tests (310 files)** with `DATABASE_URL`; `db:migrate`
  a no-op. Reverts commit by commit (`git revert <sha>` each).
- **2026-09-24 design-system integration, stage 1 (`1e6b548`, `8a85f60`,
  `9fdb9e6`, `cfdb68a`):** the user supplied the Aquarela backoffice design
  system v0.1.0 as `docs/aquarela-design-system/` and asked to apply it "using
  the installed shadcn skill". Reconnaissance established that **this repository
  is not a shadcn app and has no Tailwind** — no `components.json`, no
  `tailwind.config.*`, no `tailwindcss`/`class-variance-authority`/`@radix-ui`
  dependency, no CSS file — so the package's integration steps (which target an
  existing `tailwindCssFile`, an existing Button CVA and `shadcn info`) cannot
  be followed as written, and the package's own README forbids the
  re-platforming route ("do not run init, apply a preset, reinstall components,
  or change primitive libraries"). The **values** were therefore merged into the
  existing token architecture with the structure unchanged, which keeps ~86
  consumer files and the contrast gate working: `shadcn-theme.css`,
  `tokens.json` and `component-recipes.ts` are the sources. Recorded as
  **`DEC-129`** (provisional, owner confirmation required). Three deviations,
  each forced by a gate this repository already enforced and each re-derived in
  `tokens.test.ts`: the package's status foregrounds (1.005–1.12:1 apart) and
  washes (1.008–1.021 from its own canvas) fail the existing pairwise and
  wash-separation assertions, so both sets were retuned in lightness only; and
  the package's chart series fail the categorical pairwise assertion while
  `shell.tsx` indexes that array positionally, so the product ladder is kept and
  the iris is adopted as the selection/focus/accent colour. Manrope is retained
  (the package's prose says Inter but it ships Manrope, and the app already
  self-hosts it). **Stage 1 is the token layer only** — the primitives and every
  screen still need the recipe values applied (see "Resume here"). Verification:
  `typecheck`, `lint`, `format:check`, `build` clean; **4296/4296 tests** (294
  files), up 20 with the package's own published pairs now re-derived in the
  gate. Also: the design-system package is now **tracked** (it was untracked
  while `DEC-129` and the code cited it by path), `storage/` and
  `.playwright-cli/` are gitignored, 1.6 GB of stale `.next-verify-*` build
  directories were reclaimed, and the dev server was verified on port 3000 with
  a Playwright screenshot (read back) showing the merged palette live. Each
  commit reverts independently.
- **2026-09-24 W7 review follow-up (`f3adeb8`):** a four-track review of
  the range `e12116c..HEAD` (security, business logic, dead code,
  duplication) found **six findings** — all from the business-logic and
  duplication tracks — fixed in `f3adeb8` `fix(web): resolve the six
findings from the W7 review` (5 files, all under `apps/web/app/(app)/**`;
  presentation and validation only, no route/command/vocabulary change).
  Security and dead code returned **no findings**; deploy safety and
  performance clean; no migration (through `0066`); nothing pushed. The
  six findings, the clean tracks, the currency-stance open item (below)
  and the `security`-agent dead-pin fact are recorded in
  `docs/handoffs/080-2026-09-24-w7-ui-refinement-wave.md`. Reverts
  independently with `git revert f3adeb8`.
- **As of:** 2026-09-27 — branch `main`; HEAD **`398e698`**, working tree
  **clean**; the jobs stack is committed across `ecbe35b`, `8572510`,
  `0da0593`, `67e932d`, `a84ce82`, `ba27b79`, `054355f`, `911ced6`,
  `94bd965`, `d3602d0`, `0aa54f3`, `918b80a`, `d070983`, `4c89702` and
  `2796411`, `18c4cf3`, `5d8e285`, `50b231e`, `0424d73` and `398e698`; **pushed to
  `origin/main`**; nothing applied to
  DigitalOcean. **5106/5106 tests (373 files)**; migrations through
  **`0072`** plus the migrator-provisioned **`pgboss`** schema
  (pg-boss 42) — migration `0072` (`0072_job_org_created_at_idx`, the
  `DEC-139` retention index; committed `94bd965`; dev `db:migrate`
  applied it and re-ran as a no-op; down path rehearsed on a scratch
  DB).
  **Delivered:** the complete jobs layer (**`DEC-139`**,
  `ADR-0004` Accepted 2026-09-26 — the pg-boss wiring, the first real
  producer/consumer, the HTTP `202` producer, the 90-day retention
  prune and the item-8 alert surfaces), the `DEC-129`
  design-system completion, the `DEC-132`
  storage port, the 2026-09-25 close-out wave, the docs-only concurrency
  audit (`2da9ba5`), the Integrations registry (**INTG-001**,
  `DEC-137`, `9508f1e`…`64415db`) and the forecast-vs-actual tracking
  slice (**`DEC-138`**, `e52f4e5`…`4ba3ced`); W7 and the HMS +
  Administration entries above (the verbatim W7 list is in
  `docs/handoffs/080-2026-09-24-w7-ui-refinement-wave.md`). **Next:**
  the remaining `DEC-139` follow-ups or the next programme slice (see
  "Resume here"). Next free decision
  id **`DEC-149`**.
  Lineage and full
  per-slice detail: `docs/handoffs/README.md` and the files it lists
  (newest handoffs: `085` (the payroll producer slice) and
  `084-2026-09-26-jobs-runtime-pgboss-wiring.md`).
- **The operations-completion waves W1–W7 are delivered** (`DEC-120` redesign
  through `DEC-128` recorded and implemented; per-wave detail lives in the
  decisions rows and the handoff archive — not restated here). The prior
  entries below record the programme's earlier completed slices.
- **W7 verification (2026-09-24, at `f3adeb8`):** `typecheck`, `lint`,
  `format:check`, `build` clean (build under a unique `NEXT_DIST_DIR`);
  **4276/4276 tests with `DATABASE_URL`** (294 files); `db:migrate` a no-op.
  Review: `reviewer-qwen` (adversarial) + `reviewer-glm` (code-level) —
  **no blockers, no majors**; accepted minors listed in
  `docs/handoffs/080-…md`, with one declined item (an `opacity` token scale)
  and its reason recorded there.
- **The daily (location, day) close is exposed operator-driven (`DEC-119`):**
  research found the backend already complete — `beginPeriodClose`/
  `lockPeriodClose` accept both scopes
  (`packages/application/src/close/**`), `resolveClosePeriod` derives the
  window (`packages/domain/src/period-close.ts`) and the API routes exist
  under `apps/web/app/api/v1/close/**` — but no close UI existed, so an
  operator could not create or lock a location daily close and the
  `DEC-117` reversal gate's location arm was unreachable in practice. A new
  `/close` register UI (`apps/web/app/(app)/close/**`: the server page
  gating on `PERIOD_CLOSE_READ_ROLES`, a begin form whose location selector
  is filtered to the caller's allowed locations plus a `periodStart` day,
  a role-gated company month option, and lock/reopen row actions with a
  **mandatory** reopen reason; a pure labels module + test; a `Close` nav
  entry in `shell-nav.tsx` and a tasks-page pointer) plus a **joining
  test** (unit + Postgres over `packages/application/src/sales/**`) that
  locks a location close through the **real** commands and proves
  `correctSalesLine` is then blocked for that location and day while
  another location is allowed. `scopeLimited` (the `DEC-107`
  organization-wide prerequisite evaluation) is surfaced, not hidden.
  **No backend production code changed** (no command, route, schema or gate
  change; no new route); **no migration**; operator-driven — no scheduler.
  Review: `reviewer-qwen` + `reviewer-glm` — no blockers, no majors; two
  trivial minors declined with reasons. Handoff: `docs/handoffs/078-…md`.
- **The settlement reconciliation nets line-level reversals (`DEC-118`):**
  the new read-only aggregate `sumSalesLineGrossForChannelPeriod`
  (`packages/persistence/src/repositories/sales.ts` + Postgres tests) sums
  `sales_line.gross_amount` over the lines of the transactions matching the
  organization (org-scoped both sides), the settlement's channel and
  currency, and the transaction's `occurred_at` inclusive UTC-day window
  expressed as a half-open instant range, excluding
  `option_kind = 'included'`, with the **gross** basis kept;
  `sumSalesForChannelPeriod`
  (`packages/application/src/reconciliation/postgres-store.ts`) now
  delegates to it, so a `DEC-073` line-level reversal nets and the
  settlement reconciliation agrees with the sales reports. A
  `reconcileSettlement` re-run
  (`packages/application/src/reconciliation/reconcile-settlement.ts`)
  refreshes `expected_amount`/`actual_amount`/`tolerance`/`difference`
  alongside `status` while preserving `resolution_note` — superseding the
  "amounts are creation-time facts" convention for this command. The
  transaction-only channel attribution is deliberate (no reporting
  `coalesce` fallback); **no backfill and no automatic historical
  re-evaluation** (the only caller is an explicit `POST` route); the adapter
  patch now forwards `updatedBy` (pre-existing audit-trail gap, fixed end to
  end); a re-run can change the `DEC-117` reversal gate's verdict for the
  period (a flip to `exception`/`pending` unblocks reversals; a flip to
  `within_tolerance`/`resolved`/`approved` blocks them — recorded as a
  `DEC-118` clause). **No migration** (a read change plus one new read-only
  aggregate over existing columns); append-only holds — no posted fact is
  edited, only re-derived reconciliation values change, and only on an
  explicit re-run. Review: `reviewer-qwen` + `reviewer-glm` — no blockers;
  the `DEC-117`-verdict-flip clause and the `updatedBy` fix accepted; two
  minors declined with reasons. Handoff: `docs/handoffs/077-…md`.
- **Correction/reversal posting wiring is delivered (`DEC-116`):** the new
  orchestrating command `correctSalesLine`
  (`packages/application/src/sales/correct-sales-line.ts`) reverses the line
  and every **un-reversed, non-reversal** `stock_movement` with
  `source_type='sales_line'` and `source_id` = the original line id through
  `reverseStockMovement`, all inside **one database transaction** (the
  Postgres adapter binds both the sales and inventory adapters to the
  transaction client). Reversal movements copy the **original** movement's
  `source_type`/`source_id`, so `lineCostExpression` nets the original line's
  ingredient cost to zero and the reversal line carries zero cost.
  Idempotency is **rejection-not-replay** (the line's partial unique index;
  `reversal:<movementId>`). A mandatory `reason_code` (capped at 200 chars)
  is audited. `POST /api/v1/sales/lines/[id]/reverse` (same-origin + rate
  limit + session guards, UUID validation, `DomainError` → 400), a
  `reverseSalesLine` limiter and a `ReverseLine` action on the transaction
  detail page (hidden for a reversal line and an already-reversed line). The
  `onlyReversible` movement-set restriction (a movement that is itself a
  reversal, or already has one, is excluded) keeps a partially-reversed line
  correctable and never double-reversed. **No migration** (existing
  `reversal_of_id`/idempotency columns); append-only — the original line and
  its movements are never edited. Deferred (recorded): partial/delta
  corrections, a persisted reason or `adjustment_period` link, and the
  settlement-reconciliation header divergence
  (`sumSalesForChannelPeriod` sums the append-only transaction header, so a
  line-level reversal does not net there). Review: `reviewer-qwen` +
  `reviewer-glm` — both flagged the untested atomicity, fixed with a
  fails-pre-fix rollback test; qwen's double-reverse finding fixed via
  `onlyReversible`; three minors declined with reasons. Handoff:
  `docs/handoffs/075-…md`.
- **The `DEC-028` downstream-reconciliation reversal gate is delivered
  (`DEC-117`):** a read-only, no-migration gate (`evaluateReversalGate`,
  `packages/domain/src/reversal-gate.ts`, a pure domain predicate + test) is
  evaluated inside `correctSalesLine`'s transaction (`packages/application/
src/sales/correct-sales-line.ts`) **before any write**, with the
  reconciliation store reads (`packages/persistence/src/repositories/
reconciliation.ts` + Postgres tests) and period-close reads bound to the
  **same transaction client** as the writes (no race). A reversal is blocked
  when a **`locked` `period_close`** covers the parent transaction's
  `occurred_at` date for the `location` scope (the transaction's
  `location_id`, that day) or the `company` scope (the organization id, that
  day), or when a **`reconciliation`** row whose `[period_start, period_end]`
  covers that date has status ∈ {`within_tolerance`, `resolved`,
  `approved`} — `pending`/`exception` do **not** block (they are the close
  prerequisites, `DEC-107`); a null `location_id` means only the company
  scope is evaluated. A blocked reversal throws a message-only
  `DomainError` and posts **nothing** (no reversal line, no movement
  reversal, no audit); no override/approval path and no `adjustment_period`
  requirement; the reconciliation match is organization-wide by period
  (`reconciliation` has no location or channel). No web change — the route
  already maps `DomainError` → 400. **No migration** (two read-only reads
  over existing columns); append-only holds on both paths. Deferred
  (recorded in `DEC-117`): an approval/override path and channel-precise
  reconciliation matching. Review: `reviewer-qwen` + `reviewer-glm` — both
  independently found the corrupted `DEC-116` decision row (repaired;
  byte-identical to `HEAD`); three minors declined with reasons. Handoff:
  `docs/handoffs/076-…md`.
- **Allocation pool recurrence→period normalisation is delivered (`DEC-115`):**
  each linked `operating_cost.amount` is a **per-recurrence-unit** amount,
  scaled to the half-open `[periodFrom, periodTo)` UTC allocation period by the
  exact rational factor `periodDays / nominalDays` (`nominalDays`
  calendar-anchored at `periodFrom`: daily 1, weekly 7, monthly = days in
  `periodFrom`'s month, quarterly = 3 months, annual = 12 months incl. leap);
  `one_off` contributes face value once only when
  `periodFrom <= effective_from < periodTo`; contributions are summed exactly
  over a common denominator (BigInt rationals) and rounded once at
  `MONEY_SCALE` (4 dp HALF_UP); an unknown recurrence fails closed with a
  message-only `DomainError`. Implemented in the new
  `packages/domain/src/recurrence.ts` (+ test, barrel export); the pool sum in
  `packages/application/src/costing/resolve-allocated-unit-overhead.ts` calls
  it and `operatingCostIds` now lists **only non-zero contributors**.
  Supersedes `DEC-112`'s "recurrence unscaled" clause for the pool amount.
  **No migration** (a computation over an existing column). Deferred:
  partial-window proration, `behavior` filtering, a cross-currency guard, the
  `denominator_source` DB CHECK. Review: `reviewer-qwen` + `reviewer-glm` —
  no blockers, no majors; one minor accepted (a JSDoc clarification on the
  `operatingCostIds` semantics), three declined with reasons. Handoff:
  `docs/handoffs/074-…md`.
- **Volume-based allocation denominators are delivered (`DEC-114`):** the
  sales-derived denominators — `revenue`, `transactions`, `sales_units` — are
  implemented in `resolveAllocatedUnitOverhead` via a new half-open
  `sumSalesVolume` read (`packages/persistence/src/repositories/reporting.ts`:
  org-scoped, `locationId`-scoped, `option_kind <> 'included'`, unmapped lines
  included, reversals netted, empty window returns zeros; the
  `netSalesExpression()` helper was extracted from `summarizeSales` with
  byte-identical rendered SQL). The vocabulary
  `allocation_denominator_source` widened to
  `{explicit, eligible_products, equal_share, revenue, transactions,
sales_units}` in `schemas/domain-enums.yaml` and
  `packages/persistence/src/schema/vocabularies.ts` — **no migration** (the
  column is free text with a non-empty CHECK only). A missing/zero/negative
  volume **fails closed** with a message-only `DomainError`, and volume
  branches force `stop` semantics; the port member is on
  `CostCardComponentStore`, wired through
  `cost-card-composition-postgres-store.ts`. Deferred with reasons:
  `production_hours`/`production_minutes` (no driver authority yet),
  `recorded_time`, `operating_hours`, the `denominator_source` DB CHECK, and
  org-wide volume scope for `organization`/`company_wide` rules (the read is
  single-location — a recorded gap). Review: `reviewer-qwen` +
  `reviewer-glm` — no blockers, no majors; three minors declined with
  reasons. Handoff: `docs/handoffs/073-…md`.
- **Row-11 sales-import mapping writer is delivered (`DEC-113`):**
  `mapImportRows` resolves each sales-import row to a `product_variant` —
  SKU-first (`product_variant.sku` within the org), otherwise the effective
  `external_mapping` rows with `internal_entity_type = 'product_variant'` for
  the transaction's `source_system`, matched on sku/external id within the
  half-open window at `occurred_at` — and writes the resolved id into the
  staging row's `normalized.product_variant_id` (the key `postImportRun`
  already reads), so `sales_line.product_variant_id` is populated at import
  time. Unmapped rows stay null and keep resolving through the reporting
  `unmapped` bucket; the unmapped/conflict branches strip
  `product_variant_id`/`mapped_internal_entity_id`/`mapping_match` so a
  withdrawn mapping leaves no stale target; `DEC-025` partial posting and
  `DEC-033` conflict blocking unchanged. The map form exposes an optional
  Internal entity type field (default blank; the item path is unchanged; no
  automatic inference — `import_profile` carries no entity-type field). No
  migration, no schema change; **no historical `sales_line` backfill** (the
  recorded posture; the backfill posture, the demo variant seed and an
  `external_mapping` lookup index are deferred).
- **Cost-card component resolvers are delivered (`DEC-112`):** three of the
  four components now resolve from production data — direct labour
  (`recipe_version.preparation_minutes` = minutes per batch, valued at the
  effective `labor_rate` for the new `recipe_version.labor_cost_center_id`/
  `labor_role_code` pair, ÷ `approved_usable_output` via `unitDirectLaborCost`),
  channel variable cost (the `channel_fee_rule` reader, incl. a new
  `registerChannelFeeRule` + `POST /api/v1/costing/channel-fee-rules`) and
  allocated overhead (`operating_cost.cost_pool_id`, the closed
  `ALLOCATION_DENOMINATOR_SOURCE` vocabulary, `allocatedUnitOverhead`).
  Resolved wins over the caller's explicit input; provenance records the
  per-component source. `otherVariableCost` stays an explicit input.
  Migrations `0060`–`0062` (additive columns/vocabulary/guards/index).
- **Cost-card composition assembler is delivered (`DEC-111`):** the recipe
  version (effective `product_recipe_assignment`; an explicit id must agree or
  stands in), ingredient/packaging/sub-recipe via `computeRecipeCost` ÷
  `approvedUsableOutput`, `unitNetSales` from the effective
  `price_version.netPrice`, and the four non-resolvable components (direct
  labour, channel variable cost, other variable cost, allocated overhead) as
  **explicit validated inputs** with provenance. `POST /api/v1/costing/cost-cards`
  assembles then calls `calculateCostCard`. No migration.
- **Row 13e/13f `RPT-004` operations report is delivered (`DEC-110`):** stock
  value (point-in-time ledger Σ by location), stock variance (Σ
  `stock_count_line.variance_qty` + the **booked** adjustment value, never
  qty × cost), production yield (planned/actual output, both the stored
  `yield_variance_pct` semantics and the ratio, Σ|consumption Δ| input value),
  and waste by the `DEC-018` **`stage`** axis (`moving_average`-only value,
  item-only events included, unit-blind quantity). Uniform half-open `[from,to)`
  flow windows; `GET /api/v1/reports/operations` + `/records`; the Insights →
  Operations screen. No migration.
- **Row 13d menu engineering is delivered (`RPT-005`, `DEC-109`):** computed
  median thresholds (popularity; category-relative contribution before
  labour/fees) over all resolved products before the cap, high/low classification
  (no Star/Puzzle labels), waste annotations (`moving_average` only, `DEC-068`),
  the `unmapped` bucket, `GET /api/v1/insights/menu-engineering` and the Insights
  matrix screen with each row's actual threshold value + source period and a
  drill-down link. Reuses the row-13c read model; no migration.
- **Row 13c sales & margin reporting read model is delivered:**
  the domain (`SALES_REPORT_GRAINS`, `periodBucket`, `netSalesFromLine`,
  `contributionBeforeLabour`, `contributionMarginPctOrNull`), the org-scoped
  on-demand application + persistence read model (`buildSalesReport`,
  `listSalesReportRecords`, `summarizeSales` → `{ rows, transactions }` with a
  window-level distinct count, `countSalesTransactions`, `listSalesLineRecords`),
  the API (`/api/v1/reports/sales`, `/records` — the latter accepts the caller's
  `locationIds` scope; `SALES_REPORT_READ_ROLES` = owner, GM, location_manager,
  finance, admin, analyst) and the Management-home + Insights→Reports wiring
  (`RPT-001`–`RPT-003`, `FND-006`). Product/category grouping resolves the
  variant through `product_variant_id → sku → external_mapping → unmapped`
  (`DEC-108`/`DEC-109`). **No new table** — on-demand over the canonical facts
  (`ADR-0007`). Contribution is reported **before** direct labour, channel fees
  and allocated overhead, which are not computable today; no full cost or gross
  margin. Handoff:
  `docs/handoffs/066-2026-09-22-row-13c-sales-margin-reporting-read-model.md`.
- **Row 13 close half is complete (13a + 13b):** 13a `period_close` + the
  domain/application/web port (`REC-003`, `REC-006`, `DEC-027`, provisional
  `DEC-105`, migrations `0057`/`0058`), API under `/api/v1/period-closes/**`;
  13b close prerequisites + the `schemaVersion: 2` snapshot (`REC-003`/`REC-005`,
  `DEC-107`) and `adjustment_period` (`REC-006`, `DEC-106`, migration `0059`),
  API under `/api/v1/adjustment-periods/**`. The row-13a create-race recovery was
  fixed in `c903954` (fresh-transaction recovery). Three reviewers per
  workstream (qwen/minimax/glm) → no blockers after fixes. `daily_close`
  stays deferred; the `DEC-028` downstream-reconciliation reversal gate is
  now delivered (`DEC-117`), and the daily (location, day) close is exposed
  operator-driven (`DEC-119` — the `/close` register UI).
- **Row 14 (workforce/scheduling) is complete:** 14a `shift` +
  `shift_assignment` (`DEC-102`, migrations `0051`/`0052`); 14b-1
  `shift_adjustment` + the worked-hours derivation/report (`DEC-103`, migrations
  `0053`/`0054`); 14b-2 `payroll_report` + snapshot/application/web port
  (`DEC-104`, migrations `0055`/`0056`). API under `/api/v1/workforce/**`.
- **Programme (`DEC-086`–`DEC-094`, Phase 6 + Epics 20/21) fully delivered:**
  HMS monitoring, incidents, checklists, equipment/maintenance and the
  compliance/evidence export; the `employee` + personnel-documents slice
  (`DEC-087`/`DEC-099`); the staff document library (`DEC-088`/`DEC-100`, the
  first versioned entity); the workflow platform (`DEC-094`/`DEC-101`,
  schema-only). The `job`/worker/outbox layer's gate is satisfied —
  `ADR-0004` Accepted 2026-09-26 (`DEC-139`), the first slice delivered.
- **Schema:** migrations through **`0072`** plus the migrator-provisioned
  **`pgboss`** schema (pg-boss schemaVersion 42; owned by the pre-deploy
  migrator, not a numbered migration — see `docs/runbooks/
persistence-migrations.md`); **99 public tables** (the `0071`
  `job` projection, the `0072` retention index and the `0073`
  `worker_heartbeat` table are additive and their
  down paths are untouched; the facts
  stay in `public.outbox_event` under the slice rollback). Next free
  decision id **`DEC-149`** (`DEC-129`–`DEC-148` are recorded).
- **Verification (2026-09-25, at `9842d81`):** `typecheck`, `lint`,
  `format:check`, `build` clean; **4735/4735 tests with `DATABASE_URL`**
  (335 files); `db:migrate` a no-op through `0068`; 93 public base tables.
  (Known flake, re-observed in this wave:
  `packages/application/src/scheduling/scheduling.postgres.test.ts` can fail
  on an audit same-instant ordering assertion and passes on re-run.)
- **Not yet built (the honest-gap list — do not imply the programme is
  finished):** the jobs layer is **delivered** (`DEC-139` complete) and
  its **follow-ups remain recorded, not silently deferred**: only the
  system-wide prune is outstanding (the `(organization_id, created_at)`
  index landed in `0072`; the DB-backed worker heartbeat in `0073` and
  the DLQ review automation landed 2026-09-27) — see "Resume here";
  INTG-002
  publishing is gated **only** on the per-source write terms I15/I18
  under `DEC-015`. The `file_object` storage port is **delivered**
  (`DEC-132`,
  consumers wired per `DEC-133`/`DEC-134`; the remaining per-class
  retention/Spaces decisions are recorded in those rows), and the
  app-shell search/scope placeholders were resolved by removal (handoff
  `081`). Standing items: **reset-token delivery** is a no-op stub;
  `WF-003` self-assignment deferred (`DEC-102`); six golden fixtures
  **unsigned**; the `task`↔`approval` link is open. The deferred `DEC-112` items
  (the `other_variable_cost` source, the `production_*`/time denominators, a
  `denominator_source` DB CHECK, per-channel packaging, the cost-card version
  chain, the per-item cost-selection override, partial-window proration,
  `behavior` filtering), the org-wide volume scope (`DEC-114` gap) and the
  `DEC-116`/`DEC-117`/`DEC-118` recorded follow-ups remain recorded in their
  decision rows and handoffs — not restated here.
- **Dev server (session-scoped):** `DATABASE_URL=postgres://aquarela:aquarela@localhost:5432/aquarela`,
  `ORGANIZATION_ID=1448a476-32f2-426f-b153-11a851011e48`; sign in `owner` /
  `LocalDevPass123`; MFA disabled for `owner`; demo data seeded including the
  `zettle-legacy` `import_profile`. A fresh session must restart the server.
  Note the **permanent** monitoring point `VERIFY-1` and its reading (see the
  open items — not removable, append-only).
- **Nothing applied to DigitalOcean.**
- **Open verification debt:** the shared rate-limit store is
  **delivered** (`DEC-135`, migration `0067`); only a growth sweep for
  `rate_limit_counter` remains deferred (less urgent now that the worker
  layer exists (committed)); reset-token delivery is a no-op stub until the email slice; palette hex
  values / data-viz palette semantics await owner sign-off; the six golden
  fixtures remain unsigned (the "verified" gate).

## Next up (prioritised)

`docs/BUILD_ROADMAP.md` is the ordered execution tracker; §5 carries the
open-point lists. Per-slice detail is in `docs/handoffs/`.

1. **Next: the remaining `DEC-139` follow-ups or the next programme
   slice named by `docs/BUILD_ROADMAP.md` — buildable now, no owner
   input needed.** The jobs layer is **complete** (the seven-commit
   stack through `054355f`: pg-boss wiring, the first real
   producer/consumer, the HTTP `202` producer, the 90-day retention
   prune, the item-8 alert surfaces). The follow-ups: the system-wide
   prune + the `(organization_id, created_at)` index, a DB-backed
   worker heartbeat if cross-process detection is needed, and DLQ
   review automation. Exact scope,
   verified commands and the honest remainder in "Resume here" (next
   free decision id `DEC-149`). Beyond that, the
   standing owner/data-gated items are the remainder (the exact list in
   "Resume here": reset-token delivery, the unsigned golden fixtures,
   the `task`↔`approval` link, `WF-003` self-assignment, the
   deployment prerequisite inputs, the receipt→ledger
   `storage_area_id` policy). The forecast-tracking slice is
   **delivered** (`DEC-138`, row 15's data gate overridden by owner
   authorization); the Integrations registry is **delivered** (INTG-001,
   `DEC-137`; INTG-002 now gated only on I15/I18 under `DEC-015`), and
   blocked rows 17–18 and the standing items stay "blocked and stated"
   per the W6 acceptance rule. The HMS
   blockade, the Administration reads/users-scopes work, the `DEC-132`
   storage port (plus its `DEC-133`/`DEC-134` consumers), the Tax/rules
   authoring (`DEC-136`) and the Integrations registry are
   **delivered** (the rate-limiter shared store is
   delivered too, `DEC-135`), and user creation awaits the `DEC-131` owner
   decision.
2. **Then the honest-gap queue** (see the "Not yet built" bullet in Current
   status, each recorded not silently deferred): the `DEC-139`
   follow-ups (only the system-wide prune; the `created_at` index is in
   `0072`, the heartbeat in `0073`, the DLQ automation delivered), plus
   the standing items
   (reset-token delivery, unsigned golden fixtures, the `task`↔`approval`
   link, `WF-003` self-assignment). The previously listed
   unit-catalogue read, cost-centre list read, `calculatePriceScenario`
   HTTP route and incident owner assignment are **delivered** — see the
   stale-gap correction in "Resume here".
3. **Rows 13/12/11 and the close-outs delivered — COMPLETE.** Row 13 (close
   13a/13b + reporting 13c/13d/13e-f), the cost-card composition chain
   (`DEC-111`/`DEC-112`), the row-11 import mapping writer (`DEC-113`), the
   volume denominators + recurrence normalisation (`DEC-114`/`DEC-115`), the
   correction/reversal wiring (`DEC-116`), the reversal gate (`DEC-117`),
   the settlement netting (`DEC-118`) and the operator-driven daily close
   (`DEC-119`) — all delivered, per their decision rows and handoffs. The
   recorded follow-ups (posture gaps listed above) remain open, not silently
   deferred.
4. **Receipt→ledger wiring — the lead item, gated:** on the **OPS receipt
   destination `storage_area_id` policy** (a recorded owner input). If it has
   not landed it stays blocked; do not resolve the policy silently
   (`post-stock-movement.ts`; `docs/BUILD_ROADMAP.md` §5 slice-8 entry).
5. **Owner/OPS/data inputs** (gate the remaining roadmap items): the OPS
   `storage_area_id` policy; the FIN variance-tolerance thresholds; the
   privacy-review retention periods per file class; history/grain quality (I11);
   the deployment prerequisite inputs; the six golden-fixture signatures; the
   **WF-003 self-assignment login model**; the **`DEC-102`/`DEC-103`/`DEC-104`
   provisional items**.
6. **Test-deployment rehearsal** (`docs/runbooks/deployment.md`) — staging first
   with sanitized/synthetic data only; parked on the deployment prerequisite
   inputs.
7. **Golden-fixture sign-off** — the six fixtures are prepared as machine-readable
   JSON under `tests/fixtures/` (`DEC-065`); finance + product owner sign (the
   "verified" gate); `I8`/`I9` still gate the real rates behind them.
8. **Rows 15–18 and the competitor/planning waves** — competitor manual
   observations landed in the completion programme (see the decisions rows);
   row 15's forecast-tracking slice is **delivered** (`DEC-138`,
   owner-authorized), rows 17–18 remain blocked
   (`ADR-0009`–`0011`; row 16's registry slice INTG-001 is
   delivered, INTG-002 stays gated on the per-source write terms
   I15/I18 under `DEC-015`).

## Open decisions / inputs (do not block development)

Full detail for each item lives in its slice's handoff file and in
`docs/BUILD_ROADMAP.md` §5. Recorded, not decided — do not resolve silently.

- **`DEC-131` — how a new user is created (awaiting owner/TECH):** the
  users/roles/scopes backend is delivered (`968ca2e`), but **no screen or
  command creates a user** and none was built without this decision. An
  invite cannot be delivered today (the password-reset token delivery is a
  no-op stub), and an administrator setting an initial password means
  sharing credentials. Do not implement either arm without the owner.
- **Standing process rule from the owner:** every subagent runs in the
  background, and documentation is always delegated to the writer agent
  rather than written by the coordinator.
- **Permanent rows in the local dev database (side effect of verifying HMS
  recording):** monitoring point `VERIFY-1` and one reading were created
  while verifying `03b2533`; the `DELETE` was refused by the
  `monitoring_reading` append-only trigger, so they **cannot be removed**.
  They demonstrate the append-only guarantee, and the point can only be
  ended by a new effective window per `DEC-127`. **Future verification
  should use a scratch database.**
- **Row 13 (provisional, awaiting owner/OPS):** `DEC-105` (13a) — the status
  machine has `open` unreachable through the API; the close **list** route is not
  location-filtered (the recorded systemic location-scope gap) while
  `[id]`/begin/lock enforce the location scope; the access reading
  (`front_of_house`/`analyst` included on read, `kitchen`/`purchasing` excluded,
  company-scope writes and reopen narrowed) is provisional. `DEC-107` (13b) —
  the prerequisite rule is **provisional** (which reconciliation/import statuses
  block a close was not defined by any decision); `data_quality_exception` and
  the tolerance existence are informational only (no period/location column);
  a `location` close cannot enforce scope (`scopeLimited: true`); there is no
  override/force path; the snapshot is `schemaVersion: 2`. `DEC-106` (13b) —
  `adjustment_period` has one open window per organization, no reopen, and
  `daily_close` is **deferred**; the correction-posting wiring has since been
  delivered (`DEC-116`) together with the `DEC-028`
  downstream-reconciliation gate (`DEC-117`), and the daily (location, day)
  close is now exposed operator-driven (`DEC-119` — the `/close` register
  UI; the standalone `daily_close` table stays deferred as redundant with a
  `scope_type='location'` `period_close`). The `DEC-027` interaction with
  reversal/payroll regeneration stays open.
- **Correction/reversal posting (provisional, awaiting owner/FIN):** `DEC-116`
  — full negation only (no partial/delta correction); reversal is
  rejection-not-replay; no approval workflow and no `adjustment_period` link
  (persisting a reason or period link would need a migration); gating the
  exported `reverseSalesLine` primitive is a recorded follow-up. `DEC-117` —
  the gate blocks outright with no override/approval path, only when a
  `locked` period close or a `within_tolerance`/`resolved`/`approved`
  reconciliation covers the parent transaction's date (`pending`/`exception`
  do not block), organization-wide by period because `reconciliation` has
  no location or channel (channel-precise matching and the override path are
  recorded follow-ups). `DEC-118` — the settlement reconciliation is now
  line-derived and a re-run refreshes the amounts as well as the status
  (superseding the creation-time-facts convention for this command), so a
  re-run can change the `DEC-117` reversal gate's verdict for the period
  (recorded, not silent); the transaction-only channel attribution and the
  no-backfill/no-automatic-re-evaluation posture are deliberate; deferred:
  recomputing the header at posting time, a channel-precise predicate, a
  persisted reversal-effect record.
- **Row 13c/13d reporting (provisional, awaiting owner/OPS):** `DEC-108` (13c) —
  reporting is **on-demand, not materialized** (`ADR-0007`'s MV-vs-incremental
  and the 15-minute refresh stay open; the job layer is now unblocked —
  `ADR-0004` Accepted 2026-09-26 — so a materialized refresh is
  buildable on top of `DEC-139`); net
  sales prefers the imported `net_amount`; cost is **ingredient-only**
  (ledger-derived) so contribution is **before labour/fees** and **full cost is
  not reported** — the cost-card composition assembler is built (`DEC-111`) and
  three of its four component resolvers now exist (`DEC-112`); the `RPT-003` normalized measures are
  undefined (totals only);
  `product.category` is free text; read access is provisional.
  `DEC-109` (13d) — menu-engineering thresholds are **computed medians** only
  (no Star/Puzzle labels, no approved-target rule), `option_kind='included'`
  excluded from popularity units, no add-on roll-up, and labour/fees/overhead/
  forecast-reliability/strategic-role have no per-product attribution. The
  row-11 mapping writer is now delivered (`DEC-113`), so
  `sales_line.product_variant_id` is populated at import time; historical
  rows keep the **no-backfill** posture (they resolve by SKU/
  `external_mapping` at read time; the demo variant seed / `external_mapping`
  lookup index remain deferred). 13d also records: waste annotations are
  **`moving_average`-only** (`DEC-068`), and that filter also excludes
  non-`moving_average` events from the **quantity** sum (inert while those
  methods are unimplemented); `waste_event.currency` is not cross-checked
  against the hard-coded NOK; the waste read has no covering index (a future
  index review); and the top-level `threshold.contribution.value` is `null` by
  design (category-relative — each row carries its own threshold).
- **Row 13e/13f `RPT-004` operations (provisional, awaiting owner/OPS):**
  `DEC-110` — stock value is point-in-time ledger Σ (not the `stock_balance`
  projection); stock variance **value** is the **booked** adjustment value
  (Σ `value_delta` where `source_type='stock_count'`), **not** `variance_qty ×
cost` (the `DEC-067`/`DEC-008` valuation is asymmetric); the waste reasons axis
  is the closed `DEC-018` **`stage`** vocabulary (free-text `reason_code` is not
  the axis — a closed reason vocabulary is deferred); waste value is
  `moving_average`-only with item-only events included and unit-blind quantity;
  flow windows are half-open `[from,to)` while `sumWasteByProductVariant`
  (RPT-005) stays inclusive; production yield reports both figures over
  `actual_finish`; `stock_turn`, multi-currency, `DEC-028` reversal pairing and
  item→product attribution remain deferred; no covering index for the new reads
  (a future index review); read access per `DEC-108`.
- **Cost-card component resolvers (provisional, awaiting owner/OPS/FIN):**
  `DEC-112` — direct-labour minutes per batch, valued at the effective
  `labor_rate` for the `recipe_version.labor_cost_center_id`/
  `labor_role_code` pair and divided by `approved_usable_output`;
  `channel_fee_rule` percentage kinds on `gross_price`/`net_price` per
  `fee_basis`, fixed kinds via `perUnitFixedFee` (the order-size allocation a
  recorded `[PROPOSED]`); `ALLOCATION_DENOMINATOR_SOURCE` closes the
  free-text denominator (`explicit`, `eligible_products`, `equal_share`,
  `revenue`, `transactions`, `sales_units`); `explicit`/`eligible_products`/
  `equal_share` and the three sales-derived volume denominators are
  implemented (`DEC-114`) — the `production_*`/time denominators
  (`production_hours`/`production_minutes`/`recorded_time`/`operating_hours`)
  still **fail closed** (no driver authority yet), and the org-wide volume
  scope for `organization`/`company_wide` rules is a recorded `DEC-114` gap.
  Still deferred: the
  `other_variable_cost` source; a DB CHECK for `denominator_source`;
  per-channel packaging; the cost-card version chain; the per-item
  cost-selection override; the period-overlap operating-cost read; a
  cross-currency guard; partial-window proration and
  `behavior` filtering (recorded in `DEC-115`); the
  golden-fixture sign-off.
- **Cost-card composition assembler (provisional, awaiting owner/OPS):**
  `DEC-111` — the recipe version is the effective `product_recipe_assignment`
  (an explicit `recipeVersionId` must agree or stands in; both missing rejected);
  ingredient/packaging/sub-recipe assembled via `computeRecipeCost` (a
  sub-recipe's internal packaging lands in the ingredient bucket);
  `unitNetSales` from the exact-scope effective `price_version.netPrice` (a
  missing or negative value rejected); **direct labour, channel variable cost,
  other variable cost and allocated unit overhead are explicit validated inputs**
  (default `0.0000`, provenance recorded) — at `DEC-111` time because the
  resolvers did not exist; `DEC-112` now resolves three of the four (resolved
  wins over explicit; `otherVariableCost` stays an explicit input; see the
  `DEC-112` bullet above). `COST_CARD_WRITE_ROLES`
  (incl. `kitchen`) is provisional; no price-version scope fallback (a recorded
  `DEC-077` open point); the cost-card version chain, the per-item cost-selection
  override and the golden-fixture sign-off remain open.
- **W7 costing forms take opposite stances on currency (awaiting owner/TECH;
  raised by the `f3adeb8` review):** `register-operating-cost-form` sends an
  editable currency per record, while `register-labor-rate-form` displays a
  currency it never persists (the labour-rate record has no currency column).
  `f3adeb8` only made each screen honest about what it stores; reconciling
  the two stances needs a recorded decision, and it should be taken before
  any multi-currency work.
- **Design system: owner confirmation, the font contradiction and two derived
  values (awaiting owner/TECH; `DEC-129` is provisional):** the package states
  that its palette and wordmark are **proposed** and that no Aquarela brand
  assets were supplied, so `DEC-129` needs owner confirmation of the palette and
  the wordmark. The package contradicts itself on typography —
  `DESIGN-SYSTEM.md`, `README.md` and `shadcn-theme.css` say Inter while
  `fonts.css` and `fonts/` ship Manrope, and `README.md` claims no font files
  are bundled while they are — so **Manrope is retained** pending resolution.
  Two token values are **derived rather than taken from the package**
  (`brand.navyDeep`, `border.default`) because the package specifies a light
  sidebar and only two border tiers; the stage-4 light sidebar retires both. The
  package's own `VALIDATION.md` evidence does not satisfy this repository's
  contrast gate, so the merged status and chart values deviate from its
  published values deliberately (see `DEC-129`).
- **Login password field lacks `autocomplete="current-password"` (minor, found
  by the stage-1 browser check):** a WCAG 1.3.5 / autofill gap on the sign-in
  screen; being fixed with the shared field primitive by the **in-flight
  stage-2 agent** — confirm it landed before closing the wave.
- **Row 14 (provisional, awaiting owner/OPS):** `DEC-104` — the "remaining
  planned shifts run as scheduled" assumption is **not** implemented (only
  `{assigned, completed}` shifts count, so a pre-month-end payroll report
  under-counts — the biggest open item); base vs loaded hourly rate;
  `currency` hard-coded `NOK`; `draft` unreachable through the API; the
  `DEC-027` period-lock interaction; working-time retention; application-layer
  audit only; `location_manager` deliberately excluded from payroll read/write
  (matrix None) while the worked-hours report grants it. `DEC-103` — single-stage
  adjustment approval (actor is approver); `analyst` excluded from worked hours
  ("Aggregate" unimplemented); worked-hours report not persisted. `DEC-102` —
  provisional shift state machine; manager-assignment only, self-assignment
  deferred pending the **WF-003 self-assignment login model**; `created_by`
  convention; multi-assignment with no headcount invariant; list orderings not
  fully index-covered; `role_code` free text.
- **Workflow platform (`DEC-094`/`DEC-101`):** 12 clarifications — free-text
  `task.type`/`priority`; no `task_status` transition guard; nullable
  `approval.decision` while pending; decide-once; plain-uuid actors; polymorphic
  targets; no `task.location_id`; **access unset** (no `task`/`approval` matrix
  row); no task↔approval link (`HMS-001` conflict); `job`/outbox
  unblocked (`ADR-0004` Accepted 2026-09-26).
- **Staff document library (`DEC-088`/`DEC-100`):** `document` has no location
  column, so `DOC-001`'s "at authorized locations" is unenforceable;
  acknowledgement retention period (privacy review); no un-archive; `file_object`
  now has an application port and the document-library upload/stream consumer is
  wired (`DEC-132`); `reviewer-glm` coverage gaps.
- **`employee` + personnel documents (`DEC-087`/`DEC-099`):** `WF-007` upload/
  replace is implemented (the employee-document consumer is wired, `DEC-133`);
  **retention** stays deferred pending the privacy review;
  no version model (`supersedes_id` chain is the upgrade path); `role_code` no
  CHECK; `employee.cost_center_id` a plain uuid; no un-retire/delete; provisional
  NULL-`primary_location_id` fail-closed rule; location scope enforced in the web
  layer only; fake vs Postgres collation ordering.
- **HMS (export `DEC-093`/`DEC-098`, equipment `DEC-092`/`DEC-097`, checklists
  `DEC-091`/`DEC-096`, incidents `DEC-090`/`DEC-095`, monitoring `DEC-089`):**
  no DB-side location push-down in the export (per-source cap applied org-wide
  then filtered, flagged via `truncated`); no personal-data
  minimization/redaction; bundle not persisted (no retention class);
  `analyst` partial bundle unimplemented; regulator-final format later; period
  choices provisional; `maintenance_log`/`corrective_action` have no
  `location_id`; `equipment.kind` free text; `maintenance_log` immutability only
  in the repository; no checklist completeness rule / per-item evidence /
  failed-item→action link; jsonb 500-element ceiling provisional; `HMS-007` vs
  `DEC-093` export-scope conflict; `HMS-001` task/approval-link conflict.
- **Standing systemic:** the **systemic location-scope gap** (most routes do not
  pass `locationId` to `isAuthorizedFor`; HMS monitoring routes are the first to
  enforce it); the **`writeAudit` transaction binding** (closes over the parent
  `db`); the **driver-error→500 mapping** (a bad FK/check id → 500 instead of
  400/404; the root-cause fix belongs in `apps/web/lib/http.ts`'s `mapErrors`);
  the `notes`-amendment audit trail; duplicate readings at the same instant are
  intentional.
- **Row 11 import framework:** sales/consumption grain ambiguity (`DEC-009`
  daily-per-location vs a single `sales_line` source); the five deferred file FKs
  and the `file_object` immutability/soft-delete posture; the storage integration
  (Spaces client / signed URLs / retention enforcement).
- **Row 12 sales/reconciliation:** consumption grain A1; the legacy I19 import
  carries no resolvable `location_id` (demo theoretical consumption posts zero
  recipe-bearing lines); I1 channel/SKU confirmations.
- **Price-version scope resolution is exact-scope only:** no company-wide
  (`null` location/channel) → specific fallback in `findEffectivePriceVersion`;
  whether a fallback hierarchy is wanted is an owner/TECH decision (`DEC-077`).
- **Slice-9/10 owner questions:** output-cost allocation across multiple
  outputs/by-products; variance-tolerance thresholds; work-in-progress/source-draw
  storage area; `production_plan` line/quantity model + status vocabulary;
  lot-tracked cross-location transfer policy; per-source stock reversal semantics
  (`DEC-028`, stock variant not implemented); receipts not wired to the ledger;
  `DEC-009` daily theoretical consumption not implemented.
- **Slice-8 stock ledger:** per-source reversal semantics not enumerated; the
  sales-line side of the `DEC-028` "reversal blocked when reconciled
  downstream" gate is delivered (`DEC-117`); the stock-variant reversal
  remains unimplemented;
  `stock_balance` written directly while the runbook calls it a rebuildable
  projection (confirm the writer policy before multi-instance use); no
  application surface creates `location` rows; the `DEC-010` negative-override
  role set is fail-closed (which roles should grant it — `DEC-066`).
- **Slice-7:** the 16 cost-card/pricing open (owner) points, tracked in
  `docs/BUILD_ROADMAP.md` §5.
- **Slice-6 deferrals:** how `cost_pool` derives from `operating_cost` (an
  application convention, needs an owner rule); `allocation_rule.denominator_source`
  free text; `scope_type` shared vocabulary; the `asset` register deferred;
  imputed owner labour awaits I8 remainder / I9.
- **Slice-5 ambiguities:** per-line then recipe-level yield loss; same-instant
  cost-source tie rejected; `recipe_version` quantities carry no unit;
  `yield_rate` derived never input; `recipe_version_no_overlap` ungated;
  `planned_output_qty` unused by the §6 formula.
- **Deployment prerequisite inputs (owner; before any real `apply`):**
  a scoped `DIGITALOCEAN_TOKEN`; a provisioned private
  Spaces state bucket + credentials; the sanitized-data owner; the legacy
  instance-slug/manual-scaling check; domain names (optional). First real `apply`
  must be **staging** with sanitized/synthetic data only. Required pre-apply:
  `infra/bootstrap/database-grants.sql` once as `doadmin`.
- **External inputs still outstanding:** supplier costs/receipts (I4), recipes +
  yields (I5), productive-hours % (I8 remainder), opening counts (I7), Frontline
  data-shape confirmations. See `docs/phase0/SOURCE_DATA_REQUEST.md` and
  `docs/phase0/UNBLOCK_CHECKLIST.md`.
- **Golden fixtures:** the six must be **signed** before any Phase 1 cost is
  treated as "verified".

## How to verify / environment

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22
npm run lint && npm run typecheck && npm run test && npm run build && npm run format:check
```

Runtime stubs (each prints its start line and exits 0 after one tick; the worker
and scheduler ticks pass only when `DATABASE_URL` is set):

```bash
DATABASE_URL=postgres://aquarela:aquarela@localhost:5432/aquarela WORKER_TICKS=1 npm run start --workspace @aquarela/worker
DATABASE_URL=postgres://aquarela:aquarela@localhost:5432/aquarela SCHEDULER_TICKS=1 npm run start --workspace @aquarela/scheduler
```

Environment note: `docker` and `terraform` are **not on PATH** in this
environment — the container build and credentialed Terraform steps cannot be run
here (the Terraform offline validation was run from a downloaded 1.16.3 binary).

Local PostgreSQL 16 and migrations (the wrapper takes advisory lock `8675309`;
`DATABASE_MIGRATIONS_URL`, when set, wins over `DATABASE_URL`):

```bash
docker compose up -d postgres         # local PostgreSQL 16 on localhost:5432
DATABASE_MIGRATIONS_URL=postgres://aquarela:aquarela@localhost:5432/aquarela npm run db:migrate
```

Container (`docker` at /usr/local/bin/docker):

```bash
docker build -t aquarela-web .
docker run --rm -p 3000:3000 aquarela-web
curl -s localhost:3000/api/health    # {"status":"ok"}
```

Schema generate/apply and recovery are documented in
`docs/runbooks/persistence-migrations.md`.

Terraform (binary pinned by `.terraform-version`; validated locally with
Terraform 1.16.3 darwin_arm64). The S3/Spaces backend is deliberately partial,
so offline validation uses `-backend=false` (a real `init` supplies the bucket
and keys via `-backend-config` or the environment):

```bash
cd infra && terraform fmt -check -recursive
cd envs/staging && terraform init -backend=false && terraform validate
DIGITALOCEAN_TOKEN=dop_v1_dummy terraform plan -refresh=false -lock=false -input=false -var-file=staging.tfvars
# same three for envs/production with production.tfvars
```

`terraform plan` works offline with a dummy token (no API calls with
`-refresh=false`). If the backend block is present, `init -backend=false`
followed by `plan` reports "Backend initialization required"; run the offline
plan from a **scratch copy with `backend.tf` removed** (or a local backend
override) rather than mutating the repo — never run `apply` in this state. A real
`init` supplies `bucket` and Spaces credentials via `-backend-config` /
`AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`; the state bucket itself must be
created out of band first (see `docs/runbooks/deployment.md`).

## Handover archive

`docs/handoffs/` holds the extracted history that used to live in this file:

- `README.md` — the index of all per-slice handovers, newest first.
- `NNN-YYYY-MM-DD-*.md` — one verbatim work-log entry per slice (commits,
  verification, review reconciliation), numbered chronologically (`001` oldest).
  Newest: `084-2026-09-26-jobs-runtime-pgboss-wiring.md`.
- `reversibility-log.md` — the per-slice commit list, migration down paths and
  ledger-row rollback notes.
- `context-sections-archive-2026-09-22.md` — the pre-refactor `Resume here`,
  `Current status`, `Next up` and `Open decisions / inputs` sections, verbatim.

## Reversibility

Every change must be revertible or carry a documented recovery path (Rule 2).
The per-slice commit inventories, migration down paths and DB rollback steps are
in **`docs/handoffs/reversibility-log.md`**; each slice's handoff file repeats
its own rollback approach. Standing rules: prefer small atomic commits each
independently revertible; never rewrite history or force-push; migrations follow
expand → migrate → contract with a rehearsed down path; financial/stock facts are
append-only (reversals, not edits); external writes require a documented rollback
and per-source approval (`DEC-015`).

## Update protocol

1. Add a dated entry at the top of the work log — date, session focus, what
   changed, how it was verified, what comes next, and the rollback approach.
2. Write that entry to **`docs/handoffs/NNN-YYYY-MM-DD-<slug>.md`** (next
   sequence number, verbatim as the work log entry) and add it to the top of
   `docs/handoffs/README.md`. Add its commit list / down path to
   `docs/handoffs/reversibility-log.md`.
3. Rewrite the **`Resume here (next session)`** section of this file for the new
   next step — self-contained and executable without questions. Do this at the
   end of **every** session, even small or docs-only ones; if there is no next
   step or it is blocked, say so explicitly and name the blocker.
4. Update **Current status** (including git HEAD), **Next up** and **Open
   decisions / inputs** in the same pass, and note any new open inputs.
5. When the user says **"resume the work"** (or "resume"), read the `Resume here`
   section and continue from it without re-asking for context.

Keep this file lean: live orientation and the next step only. Per-slice history
belongs in `docs/handoffs/`. Handoffs and context live in this repo only — never
write them to a temp directory or any path outside the repository.
