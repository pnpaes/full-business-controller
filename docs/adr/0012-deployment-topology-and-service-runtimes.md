# ADR-0012 — Deployment topology and service runtimes on DigitalOcean App Platform

- **Status:** Accepted (2026-09-18)
- **Date:** 2026-09-18
- **Deciders:** Technical owner (Paulo Paes)
- **Related:** ADR-0001 (framework/hosting), ADR-0002 (migrations), ADR-0004 (jobs and outbox),
  ADR-0006 (file storage), DEC-014, DEC-015; `02:2.1,2.3,2.6,2.7`, `07:7.5-7.7`
- **Requirements:** OPS-002, OPS-003, SEC-002, NFR §7.6–7.7

## Context

The system is a SaaS-oriented business control platform for two Oslo locations, built by a small
team. The domain is transaction-heavy: ledger postings, cost snapshots, period close and
reconciliation require atomic multi-table transactions, append-only financial facts and a
Postgres-backed job queue with a transactional outbox (ADR-0004). Data must reside in the EU/EEA
(DEC-014 hosting on DigitalOcean AMS3), and `07.6` requires managed backups with RPO ≤ 1 h and
RTO ≤ 4 h. Local Docker development and the Phase 1–2 persistence core already exist.

The open question was how application runtimes are deployed: one deployable with a bundled worker
process (the earlier ADR-0001 wording), or separate runtimes.

## Decision

### Service inventory and runtimes

The repository stays a **modular monolith**: one repo, bounded-context packages, shared code
imported in-process. Deployment moves to **DigitalOcean App Platform as separate components**:

| Component | Role | Runtime |
| --- | --- | --- |
| `web` | Next.js UI (App Router), server-rendered pages and session handling | App Platform service (parameterized Dockerfile) |
| `api` | HTTP/JSON `/api/v1`, auth, commands/queries | App Platform service; may start **co-located inside `web`** as Next.js route handlers and split out when independent scaling or an auth/rate-limit boundary requires it — a deliberate, reversible step |
| `worker` | Postgres-backed job queue + outbox consumers (ADR-0004) | App Platform **worker** component |
| `scheduler` | Cron-triggered jobs (daily/month close, payroll-input report, forecasts) | App Platform **scheduled job** (target); scaffolded initially as a long-lived **worker** + internal tick loop because provider v2.101.1 exposes no `SCHEDULED` job kind — see Open items |
| `connectors` | Later: external-system sync (POS, accounting) | Own worker component, or DO Functions for webhooks |
| `ai` | Later: classification/forecast assistance | Own worker component |

**Scheduler provider deviation (2026-09-19):** the initial scaffold implements `scheduler` as a
long-lived App Platform **worker** running an internal tick loop, because the DigitalOcean Terraform
provider v2.101.1 exposes no `SCHEDULED` job kind (only `PRE_DEPLOY`, `POST_DEPLOY`,
`FAILED_DEPLOY`). App Platform's **scheduled-job** primitive remains the target; the exact conversion
trigger is recorded in Open items below. This is a deployment detail only — the component boundary
and its cron-shaped responsibilities are unchanged.

Shared packages (`domain`, `application`, `persistence`, `config`, `logger`) stay in-repo and are
imported by every runtime. No runtime writes another runtime's tables directly (`02:50`) —
cross-module communication stays via application commands, queries and recorded domain events.
Extract a workload into its own service only when a real driver exists: scale, failure-domain
isolation, security isolation, or release cadence. When `api` splits out of `web`, session cookies
must be scoped to a shared parent domain (or the API reached only server-to-server with internal
auth), and CORS/CSRF must be configured explicitly.

### DO Functions policy

**DO Functions are permitted only for stateless, bursty, webhook-receiving or light scheduled
work — never the core transactional API.** Concrete permitted examples: Wolt/Frontline webhook
receivers (bursty, stateless), PDF/thumbnail generation. The disqualifiers are concrete: Functions
have no persistent Postgres connection pool (cold starts storm the connection limit for the
transaction-heavy workload), no long transactions, and a weaker fit for consistent authorization
and rate limiting. Running the transactional API on Functions is an explicit anti-example.

### Infrastructure as code

**Terraform (DigitalOcean provider)** provisions the DO project, VPC, firewalls/trusted sources,
Managed PostgreSQL, Spaces bucket and App Platform apps; `doctl` is used only for account/token
bootstrap and ad-hoc inspection. The `.tf` layout is scaffolded and validated **offline**
(`fmt -check -recursive`; `init -backend=false` + `validate`; and a dummy-token
`plan -refresh=false` = 16 to add per env) under `infra/`; **nothing has been applied**. Layout,
exact commands and the state-bucket bootstrap: `docs/runbooks/deployment.md`.

Spaces has **no native Terraform state locking**, so `terraform apply` is restricted to a **single
accountable CI runner** (documented in the runbook); this serialization replaces lock-based
protection. Auth uses a **scoped `DIGITALOCEAN_TOKEN`** (not a personal token); state is encrypted
at rest and the state bucket is private.

### Networking and secrets

- Managed PostgreSQL is **not publicly reachable**; App Platform connects via trusted sources /
  VPC private networking.
- TLS everywhere (Passthrough or edge-terminated HTTPS for app traffic; TLS required to the DB).
- Secrets are App Platform encrypted environment variables / the DO secret store, **per
  environment**, never committed (`07.5`).

### CI/CD and migrations

App Platform deploys run a **pre-deploy migration job** executing `npm run db:migrate` (drizzle-kit
`migrate`, ADR-0002), wrapped in a Postgres **advisory lock** so concurrent deploys cannot
interleave. **Exactly one component owns the pre-deploy migration — `web`** — and the other
components must not run it. `drizzle-kit migrate` applies pending migrations only (no automatic
rollback), but every migration must have a **tested, data-preserving down path** and follow
expand → migrate → contract (`AGENTS.md` Rule 2); **`drizzle-kit push` is never used**. Two
connection URLs are required: a **pooled** `DATABASE_URL` for runtimes and a **direct/session**
`DATABASE_MIGRATIONS_URL` for the migration job, because transaction pooling breaks
`drizzle-kit migrate`. The destructive bootstrap recovery in
`docs/runbooks/persistence-migrations.md` is valid only while the database is empty. Rollback =
redeploy the previous App Platform deployment + additive DB changes + feature flags (AGENTS.md
Rule 2).

### Observability

pino structured logs shipped to the DO log sink; DO Monitoring alerts on app errors, latency, queue
depth/job age, backup state and DB health; health endpoints per component; import-freshness and
reconciliation-status signals (`02:8`).

### Scaling path (ordered)

1. Vertical sizing of App Platform instances and the DB node.
2. Read replicas for reporting queries.
3. Partition/archive the append-only tables (`stock_movement`, `audit_event`).
4. Extract `worker`, `connectors` or `ai` into dedicated runtimes when drivers appear.
5. Tenant isolation.

**Tenant posture:** the current model is a shared schema with `organization_id` scoping.
Schema-per-tenant or DB-per-tenant is adopted only if an isolation or regulatory need emerges —
this is an **open item for the owner**, not a decision of this ADR.

### Environments

Local (docker compose), **staging** and **production** are separate DO projects, apps, database
clusters and secret sets. Staging is production-like with sanitized/synthetic data; migrations are
rehearsed in staging before production (`02.7`, `10.8`).

## Alternatives considered

- **One backend Droplet with systemd** — cheapest and fully controllable, but manual patching,
  no zero-downtime deploys and more operational surface for a small team; deferred.
- **Functions-first API** — cheap idle and zero-ops, but no persistent DB connection pool, no
  long transactions and inconsistent auth/rate-limit posture; rejected for the core API (policy
  above).
- **Full microservices per bounded context** — premature: deployment and data-consistency overhead
  outweigh team size; the modular monolith already gives module boundaries, and extraction is a
  scalability path above.
- **DO Managed Kubernetes (DOKS)** — disproportionate operational burden (node pools, RBAC,
  ingress) for the current scale; revisit if multi-runtime orchestration needs emerge.

## Consequences

- App Platform bills per component; exact instance sizing is a cost follow-up.
- The `web`/`api` split point is deliberate and reversible; co-location keeps early deploys simple.
- Terraform state, drift and secrets handling become an operational responsibility (runbook).
- Postgres-backed queue means the worker is never queueless; scaling the queue scales with the DB.

## Open items

- **Packaging resolved (2026-09-19):** one parameterized `Dockerfile` builds the monorepo once and
  selects the component via the per-component `run_command` (not a build arg) — preferred over Node
  buildpacks, which cannot reliably build an npm-workspaces monorepo — with `source_dir: "."` for
  every component. The runner stage deliberately keeps devDependencies so the migrator carries
  `drizzle-kit` (a devDependency) and the worker/scheduler carry `tsx`; the size trade-off and the
  later precompile/split path are noted in the Dockerfile.
- **Scheduler `SCHEDULED` provider gap (2026-09-19):** `scheduler` runs as a long-lived worker +
  internal tick loop because provider v2.101.1 exposes no `SCHEDULED` job kind. **Convert it to a
  real scheduled job** when the provider (or the App Platform API/`doctl`) exposes `SCHEDULED`, or
  when ADR-0004 selects a job runner with its own scheduler — the conversion is mechanical and the
  target `job { kind = "SCHEDULED" ... }` block is sketched in
  `infra/modules/app-platform/main.tf`.
- **Terraform state bucket bootstrap:** the Spaces state bucket is created **out of band** (DO
  console/`doctl`) before the first `init` — the configuration cannot create the bucket that stores
  its own state. Naming and per-environment state keys are still owner-supplied; locking is handled
  by the single-runner apply above.
- **Worker/scheduler design resolved (2026-09-26):** `ADR-0004` is **Accepted** (2026-09-26,
  `DEC-139`) with the pg-boss runner pinned `12.33.2` (`DEC-062`); the only remaining provider
  item is the `SCHEDULED`-job conversion above.
- Multi-tenancy posture (shared-schema vs schema/DB-per-tenant) — **owner decision**, records
  `organization_id` scoping as the current model.
- Cost estimate for the component inventory per environment.
