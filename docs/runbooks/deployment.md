# Runbook — Deployment

Operator-facing deployment guide. Architecture decision: `docs/adr/0012-deployment-topology-and-service-runtimes.md`.
Migration discipline: ADR-0002 and `docs/runbooks/persistence-migrations.md`.

## Deployment paths — single VM (primary) vs App Platform (alternative)

**For this project's scale (one organization, low traffic) the primary path is a
single DigitalOcean droplet** (`s-1vcpu-2gb`, ~$12/mo) running the whole stack in
Docker: **Postgres on the box**, `web` (`next start`), `worker`, `scheduler`, and
**Caddy** for automatic HTTPS. File storage is the existing **local adapter on a
mounted volume** (no Spaces); backups are a nightly `pg_dump` to the volume with an
optional, env-gated S3/Spaces offsite copy.

| Path | Monthly cost | Postgres | File storage | TLS | Backups |
| --- | --- | --- | --- | --- | --- |
| **Single VM (primary)** | ~$12 (+$1 for a 10 GB volume) | Docker on the VM | local adapter on the volume | Caddy, automatic | nightly `pg_dump` (RPO ≤ 24 h, RTO ~30–60 min) |
| App Platform (alternative) | ~$45–65 (web + worker + scheduler components, managed Postgres, Spaces) | managed, PITR | Spaces | App Platform | managed + PITR |

- **Primary runbook:** [`deploy/README.md`](../../../deploy/README.md) (operator
  quickstart), `deploy/bootstrap-vm.sh` (idempotent first run), `deploy/backup.sh`
  + the systemd timer, and [`deploy/restore.md`](../../../deploy/restore.md)
  (restore + RPO/RTO). `deploy/docker-compose.prod.yml`, `deploy/Caddyfile` and
  `deploy/.env.prod.example` are the stack and its configuration surface.
- **Inputs for the VM path:** SendGrid keys and LLM keys only — the database,
  file storage and TLS are self-hosted. (The App Platform path additionally needs
  a DO token, managed-DB credentials and a Spaces bucket.)
- **Everything below** (`Topology` onwards, including the App Platform spec, the
  managed-Postgres sections, the Spaces wiring and the `terraform` state
  bootstrap) documents the **alternative** path. The single-VM section near the
  end, `### Staging rehearsal — ordered runbook (M2)`, is likewise the
  App Platform checklist; the VM equivalent is `deploy/README.md`.

## Topology

```mermaid
flowchart TD
  U[Users] --> W[web - Next.js UI]
  W --> A[api - /api/v1 (may start co-located in web)]
  A --> DB[(DO Managed PostgreSQL 16, AMS3, PITR)]
  WK[worker] -- queue/outbox --> DB
  S[scheduler - worker + internal tick loop] --> DB
  A --> SP[DO Spaces bucket]
  WK -. trusted sources / VPC .-> DB
```

*Note: the `web`→`api` edge is in-process while `api` is co-located in `web`.*

## Component → DO primitive

| Component | DO primitive | Notes |
| --- | --- | --- |
| `web` (and co-located `api`) | App Platform service | Next.js build; health check `/api/health` |
| `api` (when split) | App Platform service | Own instance size, auth/rate-limit boundary |
| `worker` | App Platform **worker** | Postgres queue + outbox consumers (ADR-0004) |
| `scheduler` | App Platform **worker** initially (target: **scheduled job**) | cron-shaped jobs: month close, payroll-input report, forecasts. Provider v2.101.1 has no `SCHEDULED` job kind, so it runs a long-lived worker + internal tick loop — conversion note below |
| `connectors` / `ai` | Later: worker or DO Functions | Functions only for stateless/webhook work |
| PostgreSQL 16 | Managed Database, AMS3 | PITR, connection pool, trusted sources |
| Files/exports | Spaces bucket, AMS3 | Private, signed URLs (ADR-0006) |
| All of the above | Terraform (DO provider) | `doctl` only for account bootstrap |

## Prerequisites

- DO account with a project per environment; team/token via `doctl auth init`.
- Terraform **1.16.3** (pinned in `.terraform-version`; any ≥ 1.6 works — the scaffold was validated
  with 1.16.3 on darwin_arm64).
- **Spaces state bucket per environment, created out of band before the first `init`** (see
  "Terraform state bootstrap").
- DB credentials via the DO console/pooler: pooled `DATABASE_URL` for runtimes and a direct/session
  `DATABASE_MIGRATIONS_URL` for the migration job.
- Domain names for staging/production.
- Staging uses **sanitized/synthetic data only**, owned by the data owner — never a raw production
  copy.

Environment/secret inventory (per environment, never committed): `DATABASE_URL`,
`DATABASE_MIGRATIONS_URL`, `SPACES_ACCESS_KEY_ID` / `SPACES_SECRET_KEY` (or App-bound Spaces keys),
`LOG_LEVEL`. The deployed `web` service additionally **requires**:

- `ORGANIZATION_ID` — the single organization this install serves, printed by the first-owner
  bootstrap (`npm run bootstrap`, below). Wired into `app-platform` as `organization_id`; empty
  adds nothing, but the auth routes throw `ConfigError("ORGANIZATION_ID is not set")` until set.
- `TOTP_SECRET_ENCRYPTION_KEY` — base64-encoded 32-byte key sealing TOTP secrets at rest
  (AES-256), required for MFA. It is a **secret**: supply it as an App Platform `SECRET`/encrypted
  env var via `TF_VAR_totp_secret_encryption_key`, never commit it. Generate with
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` (see `.env.example`).
- `SENDGRID_API_KEY` — SendGrid API key for self-service password-reset delivery (`DEC-147`). A
  **secret**: App Platform `SECRET`/encrypted env var, never committed.
- `MAIL_FROM` — the verified SendGrid sender, e.g. `Aquarela <no-reply@aquarela.no>`.
- `APP_BASE_URL` — the public origin of the `web` install, e.g. `https://app.aquarela.no`, used to
  build the **token-free** reset-page link; the reset code travels in the email **body**, never a URL
  (`ADR-0003`).

  All three must be set on the `web` service to enable reset email; without them the adapter fails
  closed (nothing is sent) and the reset stays admin-issued. They are read only by `web`.

**The `scheduler` component now requires `ORGANIZATION_ID`** (its
maintenance replay and the scheduled payroll cron are
organization-scoped; it **exits 1** without it), and `worker` still does
not read it — the worker keeps neither variable. `TOTP_SECRET_ENCRYPTION_KEY`
stays optional and unused for both (wire it to `web` only), and
`ORGANIZATION_ID` is wired to `web` and `scheduler`.

**AI advisory cron (`ADR-0009` / `DEC-142`).** Ships **disabled**. The scheduler registers
`outbox.maintenance.ai_advisory` (cron `AI_ADVISORY_CRON`, default weekly Monday 06:00,
`missed: "once"`) but the handler skips without any LLM call while `AI_ADVISORY_ENABLED` is
unset/false. To enable: set `LLM_API_URL` (an OpenAI-compatible chat-completions endpoint),
`LLM_API_KEY` (App Platform `SECRET`; never logged), `LLM_MODEL`, then `AI_ADVISORY_ENABLED=true`.
Optionally set `AI_MONTHLY_COST_LIMIT` / `AI_PER_RUN_COST_LIMIT` (decimal, ≤4 dp); a run skips once
the organization's month-to-date recorded cost reaches the monthly cap. Without all three `LLM_*`
values the adapter fails closed and makes no request. The run records an append-only
`ai_analysis_run` (provider/model/prompt version/inputs/output/cost) and `proposed` `ai_suggestion`
rows only; nothing is auto-applied and nothing is published externally. **Kill switch:** set
`AI_ADVISORY_ENABLED=false`. **Rollback:** unset the component env vars / set the flag false; no
schema change (migration `0075`). The provider DPA/privacy review (I16) must complete before a
production key is issued.

**Competitor collection (row 18b, `ADR-0010` / `DEC-143` / `DEC-149`).** Prereq:
migration `0076` applied (delivered) and the `pgboss` schema present — no new migration.
Register sources in the app, then an owner/admin terms decision sets
`terms_status='approved'`; only **active + `collection_mode='automated'` + approved**
sources that are linked to a competitor are collected. Enable on the **scheduler**
component: `COMPETITOR_COLLECTION_ENABLED=true` (default off), set
`COMPETITOR_USER_AGENT` to a real contact, keep `COMPETITOR_MIN_DELAY_MS >= 1000`.
The cron (`COMPETITOR_COLLECTION_CRON`, default weekly Monday 07:00) is registered even
while disabled. Behaviour: honours `robots.txt` per user-agent and **fails closed** if it
cannot be fetched/parsed; ≤ 1 request/second/host; a bounded per-run page budget; 429/5xx
retried with backoff. Captured facts become `pending` observations for human review;
**nothing is auto-published or applied**. Verify: the scheduler logs
`competitor collection cron run finished` with `{sources,collected,observations,skipped,failed}`;
with the switch off it makes **no** request. Rollback: set the flag false and restart (immediate),
or `git revert` (no schema change). Hosts whose `robots.txt` 404/500 are skipped by design.
Known follow-up: no content-hash dedupe, so repeated runs re-record pending observations.

**AI advisory pricing (`LLM_PRICE_INPUT_PER_1M` / `LLM_PRICE_OUTPUT_PER_1M`).** The
advisory cost caps need a per-run cost; no vendor price is hardcoded, the operator supplies it.
Read the provider's current price per 1,000,000 tokens for the configured `LLM_MODEL`, separately
for input and output, in **one currency**, and keep `AI_MONTHLY_COST_LIMIT` / `AI_PER_RUN_COST_LIMIT`
in that same currency. Set both on the scheduler (decimal string, ≤ 6 dp, non-negative), then
restart: a malformed value fails boot. **Set both** — one side only prices that side and understates
the run; blank/absent counts as unset, and neither set leaves `cost_estimate` `null` (the caps stay
inert). Verify: with advisory enabled, a run's `cost_estimate` is no longer null and the
month-to-date sum (runs since the 1st, UTC) is non-zero. Rollback: unset both and redeploy (costs
return to null; recorded spend history is retained). Caveat: a provider that omits the usage block,
or uses token keys other than `prompt_tokens`/`completion_tokens`, records 0 tokens / `0.0000` —
contributes nothing and will not trip the cap.

### Scheduler cron environment variables

The `scheduler` component takes three cron expressions (the first two for
jobs it ran before the pg-boss runtime arrived; the payroll cron is a
**daily** job whose date guard fires generation only in the month's lead
window; the monitor cron is a pg-boss scheduler job):

- `MAINTENANCE_CRON` — default `*/15 * * * *`; the scheduled maintenance
  job replays unpublished outbox rows (P2 recovery) and prunes the `job`
  projection (90-day retention — see "Monitoring").
- `PAYROLL_CRON` — default `0 5 * * *` (`missed: 'once'`); the nightly
  producer for the monthly payroll-input report. The **date guard**
  decides the candidate period: current UTC month when the day is at
  least `lastDay - 3` (the lead window), previous UTC month when the day
  is ≤ 5 (outage catch-up), otherwise skip; skips too when a live report
  for the candidate period already exists.
- `MONITOR_CRON` — default `*/5 * * * *` (`missed: 'once'`); the queue
  monitor registered by `registerMonitor`, which evaluates the
  `jobs.*` alert keys below and logs an `info` heartbeat each tick.

### Job progress route

`GET /api/v1/jobs/[id]` exposes a job's progress from the durable `job`
projection — org-scoped, role-gated (`owner`/`general_manager`/`finance`
/`admin`, provisional per `DEC-101`), omitting `payload`/`error`.
The report generated
in the lead window is **provisional** (it under-counts the remaining days
of the in-progress period, `DEC-104`).

### Async job producer (`202`)

`POST /api/v1/workforce/payroll-reports?async=true` accepts the report
request asynchronously: it enqueues the generation job and returns
**HTTP `202`** with a `Location: /api/v1/jobs/<jobId>` header and a JSON
body `{ok: true, jobId, jobUrl}`. Without the `async` flag the endpoint
keeps its synchronous default (**HTTP `200`**); an invalid `?async`
value is rejected with **`400`**. Poll the `Location` URL (the job
progress route above) for completion. Note the web process now needs a
reachable database with the **migrated `pgboss` schema** — it creates
its outbox queue lazily, independent of worker/scheduler boot order —
so the pre-deploy migration (above) must run before the web component
serves async requests.

### Rehearsing against a production clone

Staging is the rehearsal environment and uses **sanitized/synthetic data only** — never a raw
production copy (Prerequisites). The only sanctioned path that touches real production data is a
**PITR restore to a new isolated cluster** (see "Backup, restore and disaster recovery"), used for
the drill rather than day-to-day rehearsal. Rehearsals that need **no cloud credentials** run
locally:

- Migrations: start the local `postgres:16-alpine` service and run `npm run db:migrate`, then
  re-run to confirm the no-op path; every up migration needs a matching down file
  (`docs/runbooks/persistence-migrations.md`).
- Gates: `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, plus the `infra/`
  offline checks in "Offline validation".
- App boot: run the built image against the local database and check `/api/health`.
- Bootstrap dry run: `npm run bootstrap -- --dry-run` against a scratch database to preview the
  organization/owner it would create without writing anything ("First-owner bootstrap").

### Owner decisions and inputs

Outstanding inputs before the first real `apply` (tracker: `docs/BUILD_ROADMAP.md` §5):

- **Component cost estimate** — `../phase0/DEPLOYMENT_COST_ESTIMATE.md`: monthly estimate for the
  literal `staging.tfvars` / `production.tfvars` values, with confidence and variance notes.
- **Multi-tenancy posture — decided (`DEC-061`, 2026-09-20):** shared schema with
  `organization_id` row scoping. The web layer pins the one organization via `ORGANIZATION_ID`
  (see "First-owner bootstrap"); `../phase0/MULTITENANCY_POSTURE.md` fed this decision and is no
  longer an open gate.
- **Jobs runtime — decided (`DEC-062`, 2026-09-20):** pg-boss selected for the
  `worker` / `scheduler` runtime. `ADR-0004` is **Accepted (2026-09-26,
  `DEC-139`)**, so no acceptance gate remains; INTG-002 publishing alone still
  requires the per-source write terms (I15/I18) under `DEC-015`.

## Terraform layout

```text
infra/
  modules/
    project/        # DO project
    database/       # Managed PostgreSQL 16: PITR, pool, trusted sources, users
    spaces/         # application-files bucket + scoped Spaces key (state bucket is out of band)
    networking/     # VPC, firewalls/trusted sources
    app-platform/   # apps/components, env vars, pre-deploy job
    monitoring/     # DO Monitoring alerts (errors, latency, queue depth, backup state)
    dns/            # domain(s) + managed certificate
  envs/
    staging/
    production/
```

- Region variable `ams3` everywhere. Sizes/node counts as variables per environment.
- Remote state via the **S3-compatible Spaces backend** (`backend.tf`, endpoint
  `https://ams3.digitaloceanspaces.com`, key `<env>/terraform.tfstate`); never in-repo, bucket
  private.
- Provider auth via a **scoped `DIGITALOCEAN_TOKEN`** (not a personal token), injected by CI.
- **No native Spaces state locking:** restrict `apply` to a **single accountable CI runner**
  (documented) so runs cannot interleave. Run a periodic `terraform plan` drift check.
- Command sequence per env directory (credentialed; **`apply` is single-runner only**):

```bash
terraform init -backend-config=...        # see "Terraform state bootstrap"
terraform fmt -check -recursive && terraform validate
terraform plan -var-file=staging.tfvars   # or production.tfvars
terraform apply                           # reviewed plan, one runner at a time
```

### Terraform state bootstrap

The S3-compatible backend stores state in Spaces, so the **state bucket must exist before the first
`terraform init`**: the config that stores state cannot create the bucket that stores state. Create
it once per environment, out of band (DO console → Spaces, or `doctl`/an S3 client), private, in
`ams3`.

`backend.tf` intentionally holds no `bucket` and no credentials; supply them at init time:

```bash
cd infra/envs/staging
terraform init \
  -backend-config="bucket=<state-bucket>" \
  -backend-config="access_key=$SPACES_ACCESS_KEY_ID" \
  -backend-config="secret_key=$SPACES_SECRET_KEY"
# or export AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY — the S3 backend reads those
```

The bucket, keys and `<env>/terraform.tfstate` key are per environment. Spaces credentials for
state are separate from the app-files bucket's scoped key.

### Offline validation (no credentials, no `apply`)

**Status (2026-09-19):** the `infra/` layout is **scaffolded and validated offline** — `fmt
-check -recursive` clean; `init -backend=false` + `validate` green in both envs; offline
`plan -refresh=false` = **16 to add, 0 to change, 0 to destroy** per env with a dummy
`DIGITALOCEAN_TOKEN`. **Nothing has been applied.** (Re-validated 2026-09-20 after wiring
`ORGANIZATION_ID` / `TOTP_SECRET_ENCRYPTION_KEY` onto the `web` service: same 16/0/0, and with
both inputs set the `web` component renders two extra env entries while `worker`/`scheduler`
stay unchanged.)

```bash
cd infra && terraform fmt -check -recursive
cd envs/staging && terraform init -backend=false && terraform validate
DIGITALOCEAN_TOKEN=dop_v1_dummy terraform plan -refresh=false -lock=false -input=false -var-file=staging.tfvars
# repeat in envs/production with production.tfvars
```

- `-refresh=false` with a dummy token makes the plan offline (no API calls); it proves the graph,
  not the remote state.
- **Caveat:** `init -backend=false` does **not** initialise the S3/Spaces backend, so `plan` reports
  "Backend initialization required" while `backend.tf` is present. Run the offline plan from a
  **scratch copy with `backend.tf` removed** (or override the backend to a local state file) rather
  than mutating the repo; restore it byte-identical afterwards.
- A **credentialed** `plan` against the real backend and token is the pre-apply gate, not the
  offline plan above.

## Managed PostgreSQL

- Engine **Postgres 16**, region **AMS3** (EU/EEA).
- Automated backups + **PITR** enabled (RPO ≤ 1 h per `07.6`).
- **DO connection pool** (transaction pooling) configured; pool size sized to component count —
  the reason DO Functions are excluded from the transactional API (ADR-0012).
- **Trusted sources** limited to App Platform components/VPC; not publicly reachable.
- **Least-privilege database users per environment**: a dedicated `migrator` user for the pre-deploy
  job (via `DATABASE_MIGRATIONS_URL`, direct/session) plus app/worker/readonly users (via pooled
  `DATABASE_URL`). The direct/session endpoint is required because the migration wrapper's advisory
  lock is **session-scoped** — a transaction pooler is never used for migrations. Credentials are
  injected into App Platform as encrypted env vars / secret bindings — never committed.
- Ad-hoc SQL: `doctl db connect <cluster>` or the psql connection string via the VPC.

### Database privilege bootstrap

Users created through the DigitalOcean API/console get the `normal` role and **no privileges**;
Terraform creates the `migrator` and `app` users but cannot grant them (ADR-0012 requires a
least-privilege `migrator` for the pre-deploy job). Run `infra/bootstrap/database-grants.sql`
**once as `doadmin`**, after the cluster/users exist and **before the first deploy** — it is a
**required precondition of the first deploy**. It grants `migrator` connect/create on the database
and usage+create on `public`, pre-creates the `pgcrypto`/`btree_gist` extensions (so migration
0000's `IF NOT EXISTS` is a no-op), grants `app` connect+usage and default DML/sequence privileges
on future `migrator`-owned objects — and **no DDL to `app`**. It is **idempotent** (re-running is a
no-op).

Take the admin connection URI from the DO console (Connection Details) or `doctl databases
connection <cluster-id> --format uri`, then:

```bash
psql "postgresql://doadmin:<password>@<host>:25060/<db>?sslmode=require" \
  -v db_name=<db> -v migrator_user=migrator -v app_user=app \
  -f infra/bootstrap/database-grants.sql
```

### pgboss schema provisioning and grants

The pre-deploy migration job (owned by `web`) now also provisions the
**`pgboss`** schema: `packages/persistence/scripts/migrate.mjs` runs
`drizzle-kit migrate` and then provisions/migrates `pgboss` (pg-boss
`12.33.2`, expected `schemaVersion` 42) under the same advisory lock `8675309` —
see `docs/runbooks/persistence-migrations.md` for the provisioning mechanics.

The pre-deploy migrator now applies the **pgboss runtime grants itself**:
immediately after provisioning and still under the same advisory lock, it
grants the runtime role (`PGBOSS_APP_ROLE`, default `app`) `USAGE ON SCHEMA
pgboss`, `SELECT/INSERT/UPDATE/DELETE ON ALL TABLES IN SCHEMA pgboss`,
`USAGE,SELECT ON ALL SEQUENCES` and `EXECUTE ON ALL FUNCTIONS`, plus matching
`ALTER DEFAULT PRIVILEGES FOR ROLE <current_user>` default grants — applied
**only when that role exists** (local dev, with no `app` role, no-ops and logs
`migrate: runtime role "app" absent; pgboss grants skipped (no-op)`). Set
`PGBOSS_APP_ROLE` in the migrate component's env alongside
`DATABASE_MIGRATIONS_URL` only when the runtime role is not the default `app`.
A grants failure **throws** — the pre-deploy job fails closed instead of
reporting green while the runtime cannot reach the queue.

`infra/bootstrap/pgboss-grants.sql` therefore becomes a **belt-and-braces /
recovery** step, not a required post-migrate manual re-run (its header says so).
Keep it for manual fix-ups, e.g. a runtime role created after the migrate ran.
It is **idempotent** and no-ops while the schema is absent:

```bash
psql "postgresql://doadmin:<password>@<host>:25060/<db>?sslmode=require" \
  -f infra/bootstrap/pgboss-grants.sql
```

**pg-boss schema downgrade is refused, and redeploy does not undo it:** if the
database's `pgboss.schema_version` is newer than the pinned pg-boss expects,
the migrator refuses and its error names the recovery command:
`DROP SCHEMA pgboss CASCADE;`. A pg-boss schema bump **cannot** be rolled back
by re-deploying the previous commit until that schema is dropped (the facts
survive in `public.outbox_event`; the queue metadata is disposable). The
`migrate.mjs` header documents the same restriction.

### Terraform plan-time `organization_id` warning

`infra/modules/app-platform/main.tf` carries a **non-blocking** `check
"organization_id_set"` that warns at **plan time** when `organization_id` is
empty: without it the `scheduler` component **exits 1 at boot** (its
org-scoped outbox replay and the payroll cron are organization-scoped) and the
`web` auth layer throws `ConfigError("ORGANIZATION_ID is not set")`. It is
deliberately a warning, not a `validation`/`precondition`, because both env
tfvars keep `organization_id = ""` and the documented offline `plan` with
empty inputs must keep working. The offline plan (above) now also prints this
warning, which is expected until the first-owner bootstrap supplies the id.

### First-owner bootstrap

Run **once per environment, after migrations have applied and before the app is
used**, because nothing else creates an organization or a user and the web app
reads `ORGANIZATION_ID`. The command is `npm run bootstrap` (the CLI at
`apps/web/scripts/bootstrap.ts`, using the pooled `DATABASE_URL`); it creates the
organization, the first `owner` user and the role grant, and writes an audit row.

> **The organization name is the idempotency key — use the exact,
> operator-approved name on every run.** The lookup matches case-insensitively and
> trimmed, but the schema has **no unique index on `legal_name`** (it is
> multi-organization-capable), so a different spelling creates a **second
> organization** and points `ORGANIZATION_ID` at the wrong one. Reusing the exact
> name is what makes the guard refuse once an `owner` grant exists.

Required configuration (flags win over env): `BOOTSTRAP_ORGANIZATION_NAME` (or
`--organization-name`) and at least one of `BOOTSTRAP_OWNER_EMAIL` /
`BOOTSTRAP_OWNER_USERNAME`. The owner password comes only from
`BOOTSTRAP_OWNER_PASSWORD` (never a flag, so it stays out of shell history and
`ps`) or is generated with the CSPRNG; a generated password is printed **once to
stdout** and must be stored now. The command never writes the password to a log
or the audit table. Copy the printed organization id into the app's
`ORGANIZATION_ID` env var.

```bash
DATABASE_URL=... \
BOOTSTRAP_ORGANIZATION_NAME="Aquarela Kafé" \
BOOTSTRAP_OWNER_EMAIL=owner@aquarela.no \
npm run bootstrap
```

Preview the run first with `--dry-run` (or `BOOTSTRAP_DRY_RUN=1`): it connects,
applies the same read-only guards and prints exactly what would be created —
organization, owner role, owner user and grant — then exits **0** without opening
a transaction, hashing a password or writing an audit row. A run that would be
refused (`owner_exists` without `--force`, `identifier_taken`) previews as that
same refusal (exit 2/3), not as a false success.

```bash
DATABASE_URL=... \
BOOTSTRAP_ORGANIZATION_NAME="Aquarela Kafé" \
BOOTSTRAP_OWNER_EMAIL=owner@aquarela.no \
npm run bootstrap -- --dry-run
```

The command is **idempotent per organization name**: a second run refuses (exit
code 2) once an `owner` grant exists, and makes no changes. Use `--force` /
`BOOTSTRAP_FORCE=1` only to deliberately add another owner or recover from a
half-finished bootstrap. The generated password **must be changed at first
login**; until the ADR-0003 "admin-assisted password reset" procedure exists,
running this command with `--force` is the operator fallback when the owner
account is unusable. Creating the first owner here is an accepted implementation
default pending that open item.

### Staging rehearsal — ordered runbook (M2)

Mechanical checklist for the first real staging apply once the owner supplies
the inputs below. Every target named here is verified against the current tree
(`infra/envs/staging/*`, `infra/modules/app-platform/main.tf`,
`infra/modules/database/*`, `infra/bootstrap/*.sql`, `.env.example`,
`apps/web/lib/mail.ts`, `apps/scheduler/src/main.ts`).

#### Input inventory → where each goes

| Owner input | Exact target |
| --- | --- |
| DO API token (scoped, not personal) | `DIGITALOCEAN_TOKEN` in the shell for every terraform command — `providers.tf` binds `token = var.digitalocean_token`, which defaults to `null` so the provider reads the env var; alternatively set `TF_VAR_digitalocean_token`. The same token goes into `doctl auth init` for account/console work. |
| Spaces **state** bucket (create out of band, private, `ams3`) and Spaces state keys | `terraform init -backend-config="bucket=<state-bucket>" -backend-config="access_key=$SPACES_ACCESS_KEY_ID" -backend-config="secret_key=$SPACES_SECRET_KEY"` (or `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`) — `backend.tf` intentionally omits bucket and credentials; key is `staging/terraform.tfstate`. These keys are for **state only**, separate from the app-files key. |
| Spaces app-files bucket + creds | **Nothing to supply**: `staging.tfvars` sets `bucket_name = "aquarela-staging-files"`; `infra/modules/spaces` creates the bucket and a scoped key (`key_name = "aquarela-staging-staging-app"`), and `app-platform` injects both as env vars `SPACES_ACCESS_KEY_ID` + `SPACES_SECRET_KEY` (RUN_TIME, `SECRET`) on `web`, `worker` and `scheduler`. Caveat: **no app code reads them yet** (`apps/web/lib/file-storage.ts` still selects the local adapter) — see "What could still bite". |
| Managed PostgreSQL credentials | **Nothing to carry by hand for the runtime**: `infra/modules/database` creates the cluster, database, `app` and `migrator` users and the transaction-mode pool; `main.tf` (`envs/staging`) feeds `module.database.database_url` → pooled `DATABASE_URL` (PRIVATE pool host, `app` user) injected on `web`/`worker`/`scheduler`, and `module.database.database_migrations_url` → direct/session `DATABASE_MIGRATIONS_URL` (cluster host, `migrator`) injected only on the `migrate` PRE_DEPLOY job. What the owner must fetch post-apply: the **`doadmin`** connection URI (DO console → Connection Details, or `doctl databases connection <cluster-id> --format uri`) for the two grant files, and the pooled `DATABASE_URL` for `npm run bootstrap`. |
| SendGrid | On the `web` service: `SENDGRID_API_KEY` (App Platform `SECRET`), `MAIL_FROM` (verified sender), `APP_BASE_URL` (public origin). All three or nothing sends (`apps/web/lib/mail.ts` fails closed; they also gate invite email). **Not yet an app-platform Terraform variable** — see "What could still bite". |
| LLM keys (OpenAI-compatible gateway, e.g. the opencode API) | On the `scheduler`: `LLM_API_URL` (chat-completions endpoint), `LLM_API_KEY` (SECRET), `LLM_MODEL` — all raw `process.env` reads in `apps/scheduler/src/main.ts`; optional `LLM_PRICE_INPUT_PER_1M` / `LLM_PRICE_OUTPUT_PER_1M` (≤6 dp, one currency) so `AI_MONTHLY_COST_LIMIT` / `AI_PER_RUN_COST_LIMIT` (≤4 dp, same currency) can see a cost. All inert until `AI_ADVISORY_ENABLED=true`; both switches default off. Same not-yet-in-Terraform caveat. |
| Already-known inputs | `ORGANIZATION_ID` → copied into `organization_id` in `staging.tfvars` **after** the first-owner bootstrap (empty adds no env var; a plan-time check warns until set). `TOTP_SECRET_ENCRYPTION_KEY` → `TF_VAR_totp_secret_encryption_key` (base64 32-byte key; generation one-liner in `.env.example`), never committed. Domains → `domain_name` (+ `manage_dns`, off by default). Alerts → `alert_email` list (+ optional `TF_VAR_slack_webhook_url`). Add operator IPs to `admin_ip_addresses` if psql/bootstrap must reach the cluster from outside the VPC. |

#### Ordered steps

1. **Pre-flight:** CI green on the commit being deployed (`verify` + `terraform` + `e2e` jobs, "CI"); Terraform 1.16.3 (`.terraform-version`); state bucket created out of band ("Terraform state bootstrap"); **staging holds sanitized/synthetic data only** (Prerequisites).
2. **Delay auto-deploy for the first apply:** temporarily set `deploy_on_push = false` in `staging.tfvars`. The first auto-deploy would run the pre-deploy migrate job before `database-grants.sql` exists to unblock it — the documented grants order ("Database privilege bootstrap") makes the grants a **precondition of the first deploy**. Revert to `true`/re-trigger in step 6.
3. **State bootstrap ("Terraform state bootstrap"):** `cd infra/envs/staging && terraform init` with the three `-backend-config` values from the table.
4. **Credentialed plan:** `DIGITALOCEAN_TOKEN=… terraform plan -var-file=staging.tfvars`. Expected: the `check "organization_id_set"` warning (fine — no `ORGANIZATION_ID` until bootstrap) and the sizes `basic-xxs` matching a current, manually-scalable plan in `ams3` (pre-apply check under "CI"). The offline `fmt`/`validate` gates already ran in CI.
5. **Apply:** `terraform apply` — one runner only (no native Spaces state locking). Creates project, VPC, cluster + db + `app`/`migrator` users + transaction pool, app-files bucket + scoped key, the App Platform app (`web`/`worker`/`scheduler` + `migrate` job) and monitoring alerts. Grant-file targets (`migrator`, `app`) now exist.
6. **First deploy + migrate:** set `deploy_on_push = true` (or trigger a deployment manually), which runs the pre-deploy `migrate` job — applies all pending migrations **and provisions `pgboss`** under advisory lock `8675309`, then applies the pgboss runtime grants itself ("pgboss schema provisioning and grants"). A grants failure fails the deploy closed.
7. **Grant files ("Database privilege bootstrap"), in documented order:** run `infra/bootstrap/database-grants.sql` **once as `doadmin` before the first deploy** — if step 6 ran before this, the migrate failed closed and re-triggering after this file is fine (it is idempotent, as is everything here). Then `infra/bootstrap/pgboss-grants.sql`: a first run before the migrate is a deliberate no-op (`pgboss` absent); **run it again after the first `db:migrate`** as the belt-and-braces recovery path the file header documents.
8. **First-owner bootstrap ("First-owner bootstrap"):** `npm run bootstrap -- --dry-run`, then the real run with the pooled `DATABASE_URL`; `BOOTSTRAP_OWNER_PASSWORD` only via env. Store the password printed once; copy the printed organization id.
9. **Close the org loop:** put the id into `organization_id` in `staging.tfvars`, set `TF_VAR_totp_secret_encryption_key`, re-plan (the plan-time warning must disappear) and re-apply. The scheduler now boots (it exits 1 without `ORGANIZATION_ID`, so it has been crash-looping since the first deploy) and login works.
10. **Optional switches — both default off, enable only if intended:** AI advisory (`LLM_API_URL`/`LLM_API_KEY`/`LLM_MODEL` + `AI_ADVISORY_ENABLED=true`; pricing keys per "AI advisory pricing") and competitor collection (`COMPETITOR_COLLECTION_ENABLED=true`, `COMPETITOR_USER_AGENT`, `COMPETITOR_MIN_DELAY_MS >= 1000` — "AI advisory cron" section covers both). Wiring caveat below.
11. **Verify** (next subsection), then re-point `deploy_on_push` and any temporary `admin_ip_addresses` to their steady-state values.

#### Verification

- **M1 gates already running in CI** (`.github/workflows/ci.yml`): `verify` (migrate, day-one bootstrap smoke, migration-chain rehearsal, lint/typecheck/test/build — `npm run test` includes the env-drift gate `packages/config/src/env-surface.test.ts`), `terraform` (`fmt -check -recursive` + `init -backend=false`/`validate` for both envs — plan deliberately excluded), and `e2e` (boots web, logs in as the bootstrapped owner, one read + one mutation in a real browser).
- **Live checks** against `app_live_url` (a `terraform output`):
  - `GET /api/health` → `{"status":"ok"}`.
  - Log in as the bootstrapped owner (only possible once `ORGANIZATION_ID` is set and re-applied — step 9).
  - One job: `POST /api/v1/workforce/payroll-reports?async=true` → `202` + `Location`, poll `GET /api/v1/jobs/<id>` ("Async job producer", "Job progress route") to a terminal state.
  - Queue liveness from logs (worker/scheduler have **no** health check): `info "worker heartbeat"` every 30 s; the monitor's heartbeat each `MONITOR_CRON` tick; alert on the heartbeat's absence ("Monitoring").
  - **One upload — honest status:** `apps/web/lib/file-storage.ts` selects the **local filesystem adapter** today (`FILE_STORAGE_ROOT` or `<cwd>/storage/files`); the Spaces adapter (`DEC-014`/`ADR-0006`) does **not exist** in the working tree. An upload therefore writes the container's ephemeral disk, not Spaces — treat it as a port-level smoke only.
  - **`jobs.*` alert wiring:** all five keys from "Queue alerts" (depth / oldest-age / stuck / heartbeat / dead-letter) checked against a configured log alert, plus `DEPLOYMENT_FAILED` → the `alert_email`/Slack destination set in tfvars, and the DB alerts from the `monitoring` module.
  - **DLQ review once at rehearsal start:** `GET /api/v1/jobs?status=dead_lettered` returns empty; the log alert on `jobs.dead_letter` is grouped/deduped as "Queue alerts" requires.

#### What could still bite (honest, current tree)

- **No Spaces file-storage adapter exists.** Verified in the working tree: `apps/web/lib/file-storage.ts` creates only `createLocalFileStorageAdapter`. The Terraform-injected `SPACES_ACCESS_KEY_ID`/`SPACES_SECRET_KEY` are **unread by any app code**; uploads survive only until the next container replace. Do not demo Spaces persistence tomorrow.
- **`SENDGRID_*`/`LLM_*`/`AI_*`/`COMPETITOR_*` are not Terraform-wired.** `infra/modules/app-platform/main.tf` injects exactly: `DATABASE_URL`, `LOG_LEVEL`, `SPACES_ACCESS_KEY_ID`, `SPACES_SECRET_KEY` (shared runtime), `ORGANIZATION_ID`, `TOTP_SECRET_ENCRYPTION_KEY` (web), and `DATABASE_MIGRATIONS_URL` + `LOG_LEVEL` (migrate job). There is **no module variable or env entry** for SendGrid or any AI/collection knob — either extend the module (new sensitive variables + `web_env`/`scheduler_env`) before the rehearsal, or set them in the DO console and accept that Terraform's spec no longer describes the app fully (drift).
- **Transactional pooler constraints, already handled but easy to break:** `DATABASE_URL` is the transaction-mode pool; the migrate advisory lock (`8675309`) is **session-scoped**, so `DATABASE_MIGRATIONS_URL` must remain the direct/session URL — it does (migrate job only). pg-boss runs with **LISTEN/NOTIFY off** (`packages/jobs-runtime/src/boss.ts` — a pooler cannot carry a session-pinned listener), so queue pickup is bound to the poll cadence, not instant.
- **Grants ordering.** `database-grants.sql` before the first deploy or the migrator cannot create schema objects; `pgboss-grants.sql` run 1 is a no-op until the first migrate creates `pgboss`; a runtime role created later needs the manual re-run. A pgboss schema downgrade is refused — never bump pg-boss and roll back the deploy.
- **`app` is DML-only by design** (no DDL, default privileges on `migrator`-owned objects only); `pgcrypto`/`btree_gist` must come from the grants file, not migration 0000.
- **Terraform is offline-validated only.** CI now machine-checks `fmt` + `init -backend=false`/`validate` on every push, but nothing has ever been applied and no credentialed plan has run — first `apply` may surface provider drift (pinned `~> 2.101`), the legacy `basic-xxs` slug check, Spaces name collisions, or the missing `SCHEDULED` job kind (scheduler stays a long-lived worker, and **exits 1 at boot until `ORGANIZATION_ID` is set** — expected between steps 5 and 9).
- **Cluster is not publicly reachable.** Trusted sources are the app + `admin_ip_addresses` (empty by default); without an entry, `psql`, the grant files and `npm run bootstrap` fail to connect from a laptop. Plan the access path before step 5.

## App Platform specification

- Components: `web` (with `api` co-located as Next.js route handlers), `worker`, and `scheduler`
  as a **long-lived worker with an internal tick loop** (the target is a real scheduled job — see
  below). Health checks on `web`/`api` (`/api/health`); worker logs its liveness via
  queue-heartbeat logs.
- **Scheduler conversion (provider gap):** the DigitalOcean Terraform provider v2.101.1 exposes no
  `SCHEDULED` job kind (only `PRE_DEPLOY`/`POST_DEPLOY`/`FAILED_DEPLOY`), so `scheduler` is
  scaffolded as a `worker` component. Convert it to `job { kind = "SCHEDULED", schedule { cron =
  "...", timezone = "Europe/Oslo" } }` when the provider (or the App Platform API/`doctl`) exposes
  it, or when ADR-0004 selects a job runner with its own scheduler; the target block is sketched in
  `infra/modules/app-platform/main.tf`. The `run_command` stays
  `npm run start --workspace @aquarela/scheduler`.
- **Packaging:** one parameterized `Dockerfile` (repo root) builds the monorepo once; the component
  is selected by the per-component `run_command`, **not** a build arg, and every component uses
  `source_dir: "."`. The runner stage deliberately keeps devDependencies so the migrator carries
  `drizzle-kit` and the worker/scheduler carry `tsx`; a later precompile/split can prune this.
- **`.dockerignore` pitfall:** never add a bare `drizzle` entry — Docker matches it at any depth and
  it would exclude `packages/persistence/drizzle/`, so the pre-deploy migration job would ship
  without its SQL. `apps/`, `packages/` and the `Dockerfile` must stay in the build context;
  `.dockerignore` already encodes this.
- Env/secret wiring: `DATABASE_URL`, `DATABASE_MIGRATIONS_URL`, Spaces keys, `LOG_LEVEL` — encrypted,
  per environment. The `web` service additionally gets `ORGANIZATION_ID` (from the first-owner
  bootstrap; `GENERAL`) and, for MFA, `TOTP_SECRET_ENCRYPTION_KEY` (base64 32-byte secret;
  App Platform `SECRET`). Both are optional `app-platform` inputs that add no env entry when empty;
  `ORGANIZATION_ID` is non-secret and may be committed in the env's `tfvars` once known, while the
  TOTP key stays in `TF_VAR_totp_secret_encryption_key` and is never committed. The
  `scheduler` also gets `ORGANIZATION_ID` (required — exit 1 without it);
  `worker` reads neither.
- **Proxy headers and the per-IP rate limiter (required):** the App Platform proxy — and any CDN/WAF
  or load balancer in front of it — **must overwrite/strip `x-forwarded-for`** before the request
  reaches the app. `apps/web/lib/client-ip.ts` reads the first `x-forwarded-for` entry (falling back
  to `x-real-ip`) as the throttle key for the per-IP auth rate limiter; it is **never** an
  authorization input. The header is unauthenticated, so if the proxy forwards a client-supplied
  value an attacker can rotate it to bypass the per-IP limiter — confirm the setting when the app
  spec or any fronting proxy changes.
- **Pre-deploy migration job:** runs `npm run db:migrate` before component rollout. **Exactly one
  component owns it — `web`**; the other components must never run it. `npm run db:migrate` is
  `packages/persistence/scripts/migrate.mjs`, which resolves
  `DATABASE_MIGRATIONS_URL ?? DATABASE_URL`, takes the Postgres **session advisory lock `8675309`**,
  then runs `drizzle-kit migrate` and provisions/migrates the **`pgboss`**
  schema (pg-boss `12.33.2`, expected `schemaVersion` 42, downgrades refused)
  under the same lock before releasing it. The lock serialises overlapping App
  Platform pre-deploy jobs (Spaces has no Terraform state locking), and because it is
  **session-scoped**, `DATABASE_MIGRATIONS_URL` MUST be a **direct/session** connection — never the
  transaction pool. Every up migration requires a matching down-migration file; **never**
  `drizzle-kit push`. The runtime `drizzle-orm` pin is governed by **DEC-049** (upgrade to
  `>=0.45.2` before production — a pre-production gate).
- **Worker/scheduler boot ordering:** the `worker` and `scheduler` components
  must boot **and create their queues before any producing process enqueues** —
  a producer that enqueues before the queues exist fails loudly, not silently.
  Their boot now requires a reachable database with the **migrated `pgboss`
  schema** (`DEC-139`). Neither component has a health check, so a boot failure
  exits **non-zero** and must be caught from logs, not from a health endpoint.
- Spec lives in `infra/envs/<env>/` managed by Terraform (preferred); a committed `.do/app.yaml`
  snapshot is acceptable for review/clarity but Terraform remains authoritative.

## CI

`.github/workflows/ci.yml` has two jobs:

- **`verify`** (unchanged): `npm ci`; `db:migrate` against a `postgres:16-alpine` service; `lint`,
  `typecheck`, `test`, `build`.
- **`terraform`** (new, offline gates): `terraform fmt -check -recursive` over `infra/`, then
  `init -backend=false` + `validate` for `infra/envs/staging` and `infra/envs/production`.
  `plan` is deliberately **not** in CI — it needs the Spaces remote-state backend and a real
  `DIGITALOCEAN_TOKEN`, so it stays a credentialed pre-apply step.

- **Pre-apply instance-size check:** the tfvars use the legacy App Platform slugs `basic-xxs`
  (`staging.tfvars`) and `basic-s` (`production.tfvars`). Before applying, confirm each slug still
  maps to a current plan in `ams3` **and that the plan supports manual scaling** — a plan without
  manual scaling would reject the second production `web` instance
  (`web_instance_count = 2` in `production.tfvars`). See the variance note in
  `../phase0/DEPLOYMENT_COST_ESTIMATE.md` ("Confidence and variance notes") rather than restating
  the numbers here.

## Deploy procedure

1. **Build/test:** CI runs lint, typecheck, tests, migration checks (`.github/workflows/ci.yml`)
   and builds the image.
2. **Merge/deploy:** Terraform or App Platform auto-deploy picks up the merged commit.
3. **Migrate:** the `web` pre-deploy job (advisory-locked, `DATABASE_MIGRATIONS_URL`) applies
   pending migrations and provisions `pgboss`; expand → migrate → contract staged across releases,
   each with a tested down path.
4. **Release/verify:** components roll to the new revision; verify health endpoints, queue
   consumption, import freshness and error/latency alerts.

## Rollback procedure

1. Redeploy the **previous App Platform deployment** (Managed platform retains revision history).
2. Database changes are **additive only** per design (expand → migrate → contract), so the
   previous code runs against the migrated schema. Contract migrations ship only after the old
   code is gone.
3. Feature flags gate any behaviour that cannot be made additive.
4. If the migration itself failed mid-deploy: the pre-deploy job is transactional — a failed
   migration leaves the DB at the prior version; verify with drizzle-kit status and the migration
   runbook's recovery path (destructive bootstrap recovery is valid **only while empty**).

## Backup, restore and disaster recovery

- **Application rollback vs data rollback:** application rollback is redeploying the previous App
  Platform revision (see above); data rollback is a PITR restore of the database. They are separate
  operations — a bad release usually needs only the former.
- **PITR restore (DO Managed PostgreSQL):** restore to a new cluster at the agreed target timestamp,
  then repoint the App Platform components by rotating the `DATABASE_URL` (pooled) and
  `DATABASE_MIGRATIONS_URL` (direct/session) secrets in the app spec. Budget **RTO ≤ 4 h** (`07.6`);
  reach for this only when a data rollback is genuinely required, since restore may be the **only**
  data-loss rollback available — agree the recovery point before starting.
- **Spaces:** DO Spaces does **not** provide backups. Run a scheduled cross-region/snapshot copy
  (e.g. `rclone` or `s3cmd`) to a second bucket/region, with the retention policy `ADR-0006`
  requires.
- **Quarterly restore drill** (owner: the technical/operational-data owner, currently Paulo Paes —
  per DEC-014): restore the database and files into an isolated cluster, then verify — row counts
  for `app_user`, `stock_movement`, `audit_event` and `outbox_event`; reconciliation residual within
  tolerance; a checksum of recent stock movements. Record the result and the RTO achieved here.

## Monitoring

- DO Monitoring alerts: app errors, latency, queue depth/job age, DB health, backup state
  (ADR-0012 observability; `02.8`).
- Logs: pino → DO log sink; correlation IDs, no secrets (redacted by `@aquarela/logger`).
- Migration rehearsal: every migration is rehearsed in staging with production-like data
  (`10.8`) before production deploy.

### Queue alerts (`jobs.*` alert keys)

The scheduler's `registerMonitor` job (cron `MONITOR_CRON`, default
`*/5 * * * *`, `missed: 'once'`) evaluates five structured alert keys and
emits each as a structured log line with a `jobs.*` key:

- **`jobs.dead_letter`** (any value) — a job landed in the dead-letter
  queue (`outbox-dead-letter`).
- **`jobs.queue_depth`** — the summed pg-boss `readyCount` across queues
  exceeds **100**.
- **`jobs.oldest_queued_age`** — the oldest `state: "created"` queued
  job is older than **600 s** (retry/backoff jobs excluded; the scan is
  skipped while depth is above 1000).
- **`jobs.stuck_pending`** — the `job` projection has a
  `pending`/`running` row older than `stuckAfterMinutes` (default
  **60**).
- **`jobs.worker_heartbeat_missing`** — no `worker`-role heartbeat in
  `worker_heartbeat` is newer than `WORKER_HEARTBEAT_ALERT_SECONDS`
  (**120 s**).

Wire each key to a log-based alert on its threshold. A dead-letter
**re-alerts every 5 min** while it sits in the queue (retained 30
days), so configure log monitoring to **group/dedup** repeated `jobs.*`
lines instead of paging on each occurrence.

**Monitor liveness:** the monitor logs an `info` heartbeat every tick —
alert on the heartbeat's **absence** (the cron stopped). An exhausted
monitor cron ends `failed` in its own queue **without a dead-letter**, so
the `jobs.dead_letter` alert cannot catch a dead monitor.

**Worker heartbeat:** the worker and scheduler upsert a `worker_heartbeat`
row (migration `0073`) every 30 s (`WORKER_HEARTBEAT_MS`; identity
`<role>:<hostname>:<pid>` or `WORKER_HEARTBEAT_ID`), and the monitor alerts
`jobs.worker_heartbeat_missing` when the newest `worker` beat is older than
120 s — the in-app, cross-process dead-worker signal (pg-boss 12 keeps
work-in-progress in memory, no `wip` table). The worker also logs
`info "worker heartbeat"` every 30 s; the platform **log alert** on its
absence remains a secondary signal. On shutdown the heartbeat timer is
cleared.

**`job` projection retention (90 days):** the maintenance cron prunes
the `job` projection to `retentionDays` (90) — **terminal statuses
only**, org-scoped, batched, range-scanning `job_org_created_at_idx`
(migration `0072`).

### DLQ weekly review runbook

Dead-letter jobs are **retained 30 days**. Weekly (owner/TECH):

1. Inspect the dead-letter queue (`outbox-dead-letter`) for entries
   since the last review.
2. For each, read the matching `job` projection row's `error` field
   (org-scoped, 90-day retention) to see why the consumer failed.
3. Decide **replay vs discard** via the API (no direct SQL):
   - List/inspect candidates with `GET /api/v1/jobs?status=dead_lettered`
     (read: owner / general_manager / finance / admin).
   - **Replay** (cause fixed, event safe to re-apply):
     `POST /api/v1/jobs/<id>/retry` — resets the job to `pending`, clears
     the outbox dead-letter and re-sends the event; the maintenance replay
     is the fallback if the send fails, and consumers dedup on
     `outbox_event.id`. Owner / general_manager / admin only.
   - **Discard** (not safe to re-apply): `POST /api/v1/jobs/<id>/discard`
     — terminal `failed`; the outbox row stays `dead_lettered` (review
     marker) and is marked published so it is not replayed. Owner /
     general_manager / admin only.
   - Both mutations return `{ ok: true, job }`; a non-`dead_lettered` job
     is `400` and an unknown or other-organization id `404`.
4. Record the outcome (replayed job ids, discarded job ids, reasons) in
   the ops log; each action writes a `jobs.job.retried` /
   `jobs.job.discarded` audit fact.
5. The `jobs.dead_letter` alert fires on every dead-letter; if it
   fired, this review explains it — treat an unexplained firing as a
   blocker until step 3 is done.

## Validation checklist

Verified 2026-09-19 (offline, no `apply`):

- [x] `terraform fmt -check -recursive` clean and `init -backend=false` + `validate` green for both
      envs (also enforced by the CI `terraform` job).
- [x] Offline `plan -refresh=false` with a dummy token = **16 to add / 0 change / 0 destroy** per
      env. **No `apply` was run — no cloud resource or state exists.** The DNS module creates 0 by
      default (opt-in).
- [x] Migrations verified locally against PostgreSQL 16: first `npm run db:migrate` applies
      0000–0002 (advisory lock logged), a second run is a no-op, and running with neither URL set
      exits 1 naming both variables without printing a URL.
- [x] Container built; image runs as non-root `nextjs`, contains
      `packages/persistence/drizzle/{0000,0001,0002}.sql` + `meta/`, `node_modules/.bin/drizzle-kit`
      and both runtime stubs; `/api/health` returns `{"status":"ok"}`.

Still pending (needs credentials/owner inputs, or a real deployment):

- [ ] First real `apply` happens on **one environment only** (staging first), and only after the
      owner decisions and inputs in "Owner decisions and inputs" are closed. The WHOLE strategy is
      reversible because no Terraform state or cloud resource exists yet.
- [ ] Credentialed `terraform plan` against the real Spaces backend + `DIGITALOCEAN_TOKEN`,
      reviewed per environment before apply.
- [ ] Pre-deploy migration job demonstrated in **staging** on App Platform.
- [ ] Staging migration rehearsal with production-like/synthetic data completed.
- [ ] PITR restore drill from backups into a fresh cluster verified.
- [ ] Rollback drill: redeploy previous revision, app healthy on additive schema.
- [ ] Trusted sources confirmed: no public DB endpoint reachable.
- [ ] Secrets audit: no `DATABASE_URL`/keys in repo or logs.
