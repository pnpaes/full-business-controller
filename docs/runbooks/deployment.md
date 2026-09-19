# Runbook — Deployment (DigitalOcean App Platform)

Operator-facing deployment guide. Architecture decision: `docs/adr/0012-deployment-topology-and-service-runtimes.md`.
Migration discipline: ADR-0002 and `docs/runbooks/persistence-migrations.md`.

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
`LOG_LEVEL`, app-level session/encryption secrets when introduced.

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
`DIGITALOCEAN_TOKEN`. **Nothing has been applied.**

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
  per environment.
- **Pre-deploy migration job:** runs `npm run db:migrate` before component rollout. **Exactly one
  component owns it — `web`**; the other components must never run it. `npm run db:migrate` is
  `packages/persistence/scripts/migrate.mjs`, which resolves
  `DATABASE_MIGRATIONS_URL ?? DATABASE_URL`, takes the Postgres **session advisory lock `8675309`**,
  then runs `drizzle-kit migrate` and always releases the lock. The lock serialises overlapping App
  Platform pre-deploy jobs (Spaces has no Terraform state locking), and because it is
  **session-scoped**, `DATABASE_MIGRATIONS_URL` MUST be a **direct/session** connection — never the
  transaction pool. Every up migration requires a matching down-migration file; **never**
  `drizzle-kit push`. The runtime `drizzle-orm` pin is governed by **DEC-049** (upgrade to
  `>=0.45.2` before production — a pre-production gate).
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

## Deploy procedure

1. **Build/test:** CI runs lint, typecheck, tests, migration checks (`.github/workflows/ci.yml`)
   and builds the image.
2. **Merge/deploy:** Terraform or App Platform auto-deploy picks up the merged commit.
3. **Migrate:** the `web` pre-deploy job (advisory-locked, `DATABASE_MIGRATIONS_URL`) applies
   pending migrations; expand → migrate → contract staged across releases, each with a tested
   down path.
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

- [ ] Credentialed `terraform plan` against the real Spaces backend + `DIGITALOCEAN_TOKEN`,
      reviewed per environment before apply.
- [ ] Pre-deploy migration job demonstrated in **staging** on App Platform.
- [ ] Staging migration rehearsal with production-like/synthetic data completed.
- [ ] PITR restore drill from backups into a fresh cluster verified.
- [ ] Rollback drill: redeploy previous revision, app healthy on additive schema.
- [ ] Trusted sources confirmed: no public DB endpoint reachable.
- [ ] Secrets audit: no `DATABASE_URL`/keys in repo or logs.
