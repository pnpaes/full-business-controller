# Project context

Canonical orientation for this repository: read this first when resuming work,
and update it at the end of any session that changes anything (code, docs,
decisions, data) — per `AGENTS.md` Rule 1. Reference artifacts by path; don't
duplicate their content.

## Resume here (next session)

**Say "resume the work" and start here.** A fresh session must be able to continue
from this section alone.

**Next task:** **Auth slice 1b — persistence + application flow**. Slice 1a (the
domain primitives) is done and committed; see `docs/BUILD_ROADMAP.md` for the loop and
gates. Build the auth core on top of `packages/domain/src/auth/` against the existing
identity tables: persistence repositories plus the application commands/queries for
login, TOTP verification, session issue/revoke, lockout accounting, password reset and
audit. No API/UI yet (slice 1c).

**Objective:** a tested, server-side authentication flow — generic login errors, lockout,
TOTP + recovery codes, server-side session revocation, role/location-scope authorization —
backed by the existing `packages/persistence` schema, with no external writes.

**Scope (do):**

1. Read `docs/adr/0003-identity-and-role-model.md`, `DEC-013` in
   `12_OPEN_DECISIONS.md`, `docs/BUILD_ROADMAP.md` (§2 loop, §3 gates),
   `packages/domain/src/auth/` (the slice 1a API), `packages/persistence/src/schema/identity.ts`
   and `platform.ts` (`audit_event`, `outbox_event`), and `packages/application/src/`
   conventions.
2. Add a persistence access layer if none exists (a Drizzle client plus repositories for
   `app_user`, `user_role`, `user_location_scope`, `user_totp`, `auth_session`,
   `password_reset_token`, `audit_event`), reusing the existing config/advisory-lock
   conventions in `packages/persistence`.
3. Implement the application commands/queries: authenticate (always call
   `verifyPasswordOrDummy`, return `AUTH_ERROR_GENERIC`, apply `computeLockout`/`isLocked`,
   reset the counter on success, rehash when `needsRehash`), verify TOTP (persist the matched
   counter as `lastUsedCounter`, consume a recovery code), issue/verify/revoke sessions
   (store only `hashSessionToken`), revoke all sessions on role change/off-boarding, password
   reset (single-use `hashPasswordResetToken`), and write an audit row for every security
   change.
4. Enforce role + location scope server-side at the application boundary — never UI hiding.
5. Tests: unit tests for the flow with an injected repository fake, plus integration tests
   against local PostgreSQL 16 (skipped when `DATABASE_URL` is unset) covering the happy
   path, wrong password, unknown user, lockout, replayed TOTP, session revocation and
   role-change revocation.

**Scope (do not):** no API routes/cookies/UI (slice 1c); no migration unless genuinely
required — the schema already exists, and if one is needed follow
`docs/runbooks/persistence-migrations.md`; no external writes; no secrets in code or logs;
`ADR-0003` is **Accepted** (2026-09-19), with its access-matrix, Argon2id-parameter and
admin-reset items still open and tracked in the roadmap.

**Files/paths:** `packages/persistence/src/` (client + repositories),
`packages/application/src/` (auth commands/queries + authorization),
`packages/domain/src/auth/` only to fix a primitive defect.

**Read first:** `docs/adr/0003-identity-and-role-model.md`, `DEC-013` and `DEC-049` in
`12_OPEN_DECISIONS.md`, `docs/BUILD_ROADMAP.md`, `docs/runbooks/persistence-migrations.md`,
`packages/domain/src/auth/`, `packages/persistence/src/schema/identity.ts`, `AGENTS.md`
Rules 1–3.

**Acceptance / verification:** `npm run lint && npm run typecheck && npm run test &&
npm run build && npm run format:check` all pass; the auth tests (unit plus conditional
PostgreSQL integration) cover the cases in scope item 5; no secrets in code or logs; audit
rows are written for login success/failure and security changes.

**Open decisions / inputs that shape it:** `ADR-0003` is **Accepted** (2026-09-19); its open
items (final access matrix / shared-device login, Argon2id parameters against the ~250 ms
target, admin-assisted reset) still shape the implementation and are tracked in the
roadmap's owner-input register.
The lockout thresholds in `DEFAULT_LOCKOUT_POLICY` are provisional and tunable. `DEC-049`
requires new queries to keep identifiers/aliases **code-controlled**. Deployment/apply stays
blocked on `ADR-0004` acceptance and the Graphile Worker vs pg-boss choice; multi-tenancy
posture; component cost estimate; staging data-sanitization owner; real DO credentials plus a
provisioned Spaces state bucket; and a single-runner apply.

**After this task:** **Auth slice 1c** — `/api/v1/auth` routes, session cookies
(`HttpOnly`/`Secure`/`SameSite`, rotated on privilege change), and the minimal login/2FA UI.

## What this is

**Aquarela Business Control** — a secure, testable modular monolith for an Oslo
café with two locations, covering costing, pricing, inventory, production,
sales/imports, workforce and reporting. It is **documentation-first**: Phase 0 is
complete (specification, 49 accepted decisions, artifacts and ADRs); the
foundation scaffold and the Phase 1–2 persistence core are built (the latter
uncommitted). No business slices yet.

## Where things live

- `00_README.md` … `13_AGENT_BUILD_BRIEF.md` — the specification package
  (inputs, rarely edited). Start with `00_README.md`.
- `12_OPEN_DECISIONS.md` — the accepted decisions (DEC-001…DEC-049); the
  authority. New decisions are appended here.
- `docs/phase0/` — close-out plan, calculation contract, data dictionary, golden
  fixtures, source-data request, notes. See `docs/phase0/PHASE0_CLOSEOUT_PLAN.md`
  and `docs/phase0/CALCULATION_CONTRACT.md`.
- `docs/adr/` — architecture decision records `0001`–`0012`.
- `docs/runbooks/` — operator runbooks (`persistence-migrations.md`, `deployment.md`).
- `docs/BUILD_ROADMAP.md` — the ordered slice backlog and per-slice execution loop (a
  derived execution tracker; decisions and accepted ADRs stay the authority).
- `schemas/` — draft DDL and domain enums (`schemas/phase1_2_draft.sql`,
  `schemas/domain-enums.yaml`).
- `samples/` — real POS exports, screenshots and templates (reference data).
- `packages/*` and `apps/*` — code (config, logger, domain, application,
  persistence; `web`, `worker` and `scheduler` runtimes).
- `AGENTS.md` — the rules (handoff/work log, reversibility, decisions).
- `CONTEXT.md` — this file.

## Current status

- **As of:** 2026-09-19 — branch `main`; HEAD `b223212` with **uncommitted work in the
  working tree**: the persistence slice, the deployment documentation set (ADR-0001 accepted,
  ADR-0012 and the deployment + persistence-migrations runbooks), the worker/scheduler runtime
  stubs, and the validated `infra/` Terraform layout + App Platform app spec. **Nothing has
  been applied to DigitalOcean.**
- **Commits:** `536d63e` (Phase 0 package) → `bb464d6` (foundation scaffold) →
  `e55ea23` (handoff and reversibility rules) → `b223212` (context into repo).
- **Phase 0:** complete — the accepted decisions are DEC-001…DEC-049
  (`12_OPEN_DECISIONS.md`; DEC-049 added 2026-09-19).
- **Persistence core built (uncommitted):** Drizzle schema for the Phase 1–2
  scope — 35 tables covering organization/identity, catalog, tax/fees/FX,
  supplier pricing, recipes, products, costing snapshots, inventory ledger and
  outbox/audit — with migrations `0000_enable_extensions` → `0001_phase1_core`
  → `0002_invariants` under `packages/persistence/drizzle/`.
  `@aquarela/persistence` added `pg` and `db:migrate`; ADR-0002 is accepted;
  controlled-vocabulary authority is `schemas/domain-enums.yaml`.
- **Deployment runtime scaffolding (uncommitted):** `apps/worker` / `apps/scheduler`
  boot stubs and the advisory-locked `packages/persistence/scripts/migrate.mjs`
  (`DATABASE_MIGRATIONS_URL ?? DATABASE_URL`, session advisory lock `8675309`);
  `drizzle-orm` moved to runtime deps;
  verified end to end against local Postgres 16.
- **Deployment infrastructure scaffolded and validated (uncommitted, `infra/`):**
  Terraform 1.16.3 (`.terraform-version`) per `docs/runbooks/deployment.md` — modules
  `project`/`networking`/`spaces`/`database`/`app-platform`/`monitoring`/`dns` and env
  roots `staging`/`production`, DO provider pinned `~> 2.101` (2.101.1,
  `.terraform.lock.hcl` covering linux_amd64 + darwin_arm64). `terraform fmt -check
-recursive` clean; `init -backend=false` + `validate` green in both envs; offline
  `plan -refresh=false` = **16 to add, 0 to change, 0 to destroy** each (dummy
  `DIGITALOCEAN_TOKEN`, no network calls). App spec: `web` + `worker` + `scheduler`
  (long-lived, since provider v2.101.1 has no `SCHEDULED` job kind) + one `PRE_DEPLOY`
  `migrate` job; DB firewall and project attachment live at the env root. No `apply`.
- **Verified (2026-09-19):** migrations apply cleanly to an empty PostgreSQL 16 (Docker) — the
  first run applies 0000–0002 under the advisory lock, a second run is a no-op, and a run with
  neither URL set exits 1 without printing a URL; 24 tests (6 files); `lint`, `typecheck`,
  `build`, `format:check` pass; worker and scheduler stubs exit 0 under `*_TICKS=1`;
  `docker build` succeeds, the image runs as non-root `nextjs` and `/api/health` returns
  `{"status":"ok"}`.
- **Auth slice 1a done (2026-09-19):** pure domain auth primitives in
  `packages/domain/src/auth/` — Argon2id hashing with a timing-equalising dummy path and
  `needsRehash`, RFC 6238 TOTP with replay rejection, single-use recovery codes,
  domain-separated session/password-reset tokens, a progressive lockout policy and
  `AUTH_ERROR_GENERIC`; new runtime dependency `@node-rs/argon2` (verified loading on
  Alpine/musl). **71 tests** (11 files); `lint`/`typecheck`/`build`/`format:check` pass.
  ADR-0003 was accepted 2026-09-19; slice 1b (persistence + application flow) is next.
- **Security regression (DEC-049):** `npm audit --omit=dev` reports **1 high** —
  GHSA-gpj5-g38j-94v9 / CWE-89 in `drizzle-orm <0.45.2` (pinned 0.38.4), because `drizzle-orm`
  is now a runtime dependency. Not reachable today (identifiers are code-controlled); upgrade
  to `>=0.45.2` before user input can reach identifier/alias builders and before production.
- **Deployment architecture decided (uncommitted, docs only):** separate DO App Platform components
  (`web`/`api`/`worker`/`scheduler`), DO Managed PostgreSQL kept (DEC-014 unchanged), DO Spaces,
  Terraform; see `docs/adr/0012-deployment-topology-and-service-runtimes.md` and
  `docs/runbooks/deployment.md`. The `infra/` layout is scaffolded and validated offline
  (not yet applied).
- **Not yet built:** business slices; the deferred tables (workforce,
  integrations, competitor, AI, sales, procurement, production,
  counts/transfers, period close, platform job/file/approval).

## Next up (prioritised)

`docs/BUILD_ROADMAP.md` is the ordered execution tracker for these slices (slice 0 `done`;
slice 1 is next). The list below is the short narrative form.

1. **Auth slice** — `DEC-013` / `docs/adr/0003-identity-and-role-model.md`:
   Argon2id, TOTP 2FA, server-side sessions. The identity tables (including
   `auth_session` and `user_totp`) already exist in the persistence core. See
   "Resume here".
2. **Deployment foundation — scaffolded and validated offline (uncommitted); not applied.**
   `infra/` Terraform (project, database, spaces, networking, app-platform,
   monitoring, dns) + the App Platform app spec are done, and the
   `apps/worker` / `apps/scheduler` stubs exist. Before any `apply`: the owner
   decisions under "Open decisions", real DO credentials and a provisioned Spaces
   state bucket, and a single-runner apply. See
   `docs/adr/0012-deployment-topology-and-service-runtimes.md` and
   `docs/runbooks/deployment.md`.
3. **Costing slice** — against `docs/phase0/CALCULATION_CONTRACT.md`, using
   synthetic fixtures.
4. **Load real data** and sign the six golden fixtures
   (`docs/phase0/GOLDEN_FIXTURES.md`).

## Open decisions / inputs (do not block development)

- External inputs still outstanding: supplier costs/receipts (I4), recipes +
  yields (I5), productive-hours % (I8 remainder), opening counts (I7), and the
  Frontline data-shape confirmations (item-level sales lines, per-line
  channel/applied tax, SKU, add-on representation).
- See `docs/phase0/SOURCE_DATA_REQUEST.md` and
  `docs/phase0/UNBLOCK_CHECKLIST.md`.
- Deployment follow-ups (2026-09-19): **ADR-0004 acceptance** and the **Graphile Worker vs
  pg-boss** choice (the worker/scheduler design depends on both); the **scheduler `SCHEDULED`
  provider gap** (DO provider v2.101.1 has no `SCHEDULED` job kind, so `scheduler` is a
  long-lived worker + tick loop until the provider/API exposes it or ADR-0004 picks a
  scheduler); Terraform state locking (**Spaces has none** — a single-runner apply is the
  serialization) plus the **out-of-band state-bucket bootstrap**; DO Functions scope;
  multi-tenancy posture (shared-schema vs schema/DB-per-tenant) as an **owner decision**;
  component cost estimate; staging data-sanitization owner; **real DO credentials** and a
  **provisioned state bucket**. Dockerfile/migrator packaging is **resolved** (one parameterized
  Dockerfile whose runner keeps devDependencies so the migrator carries `drizzle-kit`).
  **Required pre-apply step:** run `infra/bootstrap/database-grants.sql` once as `doadmin` after
  the cluster/users exist and **before the first deploy** (without it `migrator` has no DDL
  privileges and `app` cannot read) — see `docs/runbooks/deployment.md`
  ("Database privilege bootstrap").
- **DEC-049 (drizzle-orm security):** upgrade to `>=0.45.2` — breaking, with a matching
  `drizzle-kit` bump and migration re-verification — before user input can reach
  identifier/alias builders and before production.
- Persistence-slice reconciliation: vocabulary authority is
  `schemas/domain-enums.yaml`; accepted/deferred review items are the
  `stock_balance` projection convention, the `component_kind` vocabulary
  (deferred to the costing slice), the per-`source_type` validation trigger for
  `stock_movement.source_id`, and deferred-FK additions using `NOT VALID` →
  `VALIDATE CONSTRAINT`.
- The six golden fixtures must be **signed** before Phase 1 costing is treated as
  verified.

## How to verify / environment

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22
npm run lint && npm run typecheck && npm run test && npm run build && npm run format:check
```

Runtime stubs (each prints its start line and exits 0 after one tick):

```bash
WORKER_TICKS=1 npm run start --workspace @aquarela/worker
SCHEDULER_TICKS=1 npm run start --workspace @aquarela/scheduler
```

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

Terraform (binary pinned by `.terraform-version`; validated locally with Terraform
1.16.3 darwin_arm64). The S3/Spaces backend is deliberately partial, so offline
validation uses `-backend=false` (a real `init` supplies the bucket and keys via
`-backend-config` or the environment):

```bash
cd infra && terraform fmt -check -recursive
cd envs/staging && terraform init -backend=false && terraform validate
DIGITALOCEAN_TOKEN=dop_v1_dummy terraform plan -refresh=false -lock=false -input=false -var-file=staging.tfvars
# same three for envs/production with production.tfvars
```

`terraform plan` works offline with a dummy token (no API calls with
`-refresh=false`). If the backend block is present, `init -backend=false` followed by
`plan` reports "Backend initialization required"; run the offline plan from a
**scratch copy with `backend.tf` removed** (or a local backend override) rather than
mutating the repo — never run `apply` in this state. A real `init` supplies `bucket`
and Spaces credentials via `-backend-config` / `AWS_ACCESS_KEY_ID` +
`AWS_SECRET_ACCESS_KEY`; the state bucket itself must be created out of band first
(see `docs/runbooks/deployment.md`).

## Reversibility

- Revert any commit with `git revert <sha>`; no destructive git operations.
- The `infra/` scaffold, runtime stubs and persistence slice are **uncommitted and
  additive**: discard the working-tree changes (or `git revert` once committed). The
  advisory-lock wrapper and the worker/scheduler stubs are new files, so reverting
  them changes no existing behaviour. **No cloud resource was created — only offline
  `fmt`/`validate`/`plan` ran, never `apply`; no Terraform state exists.**
- Bootstrap migrations are forward-only. While the database is empty the tested
  recovery is `DROP SCHEMA public CASCADE; DROP SCHEMA drizzle CASCADE;
CREATE SCHEMA public; npm run db:migrate` (see the runbook). Once data exists,
  migrations must be additive (expand → migrate → contract) with a tested
  data-preserving down path (see `AGENTS.md` Rule 2). Revising the schema now
  requires regenerating `0001_phase1_core` and re-running the migration
  verification.
- External writes require a documented rollback and per-source approval
  (`DEC-015`).

## Work log (append-only, newest first)

### 2026-09-19 — Auth slice 1a: domain auth primitives

Built `packages/domain/src/auth/` (exported from `packages/domain`): Argon2id-only password
hashing/verification with a timing-equalising dummy path and `needsRehash` (algorithm,
version and all cost params), RFC 6238 TOTP on `node:crypto` (canonical base32 decode,
±window verification, replay rejection by persisted counter, fails closed on an undecodable
secret), single-use recovery codes (full-scan verify, no early exit), domain-separated
opaque session/password-reset tokens (SHA-256 at rest, constant-time compare), a progressive
lockout policy, and `AUTH_ERROR_GENERIC`. New runtime dependency: `@node-rs/argon2`
(prebuilt musl + darwin), verified loading inside the built Alpine image.

Verified: **71 tests** (11 files; +41 auth), `lint`, `typecheck`, `build`, `format:check`
pass; `docker build` succeeds and `argon2-ok` under Alpine. Two adversarial reviews
(reviewer-qwen, reviewer-glm) ran: accepted fixes were the TOTP fresh-over-stale window
ordering, failing closed on a corrupt secret, canonical base32 validation, and token-family
domain separation (plus the missing tests). Declined with reasons: logging/surfacing
corrupt-hash verification errors (the domain layer must not log; the application layer owns
that) and changing the documented 9th-failure lockout escalation (provisional, tunable). A
unit test for a TOTP collision across window counters is not constructible in reasonable
time (~3×10⁻⁶ per counter pair) and is covered by inspection of the fresh-wins loop.

Rollback: revert this commit; the module is additive and referenced by no runtime yet.

### 2026-09-19 — Deployment foundation verified end to end; DEC-049 security pin

**Review fixes (2026-09-19):** applied the accepted code-review findings. (1) **CRITICAL** — added
`infra/bootstrap/database-grants.sql`, the idempotent privilege bootstrap for the least-privilege
`migrator`/`app` users (DO API/console users get the `normal` role and no privileges; ADR-0012 keeps
the pre-deploy job on `migrator`, not `doadmin`), referenced from `infra/modules/database/main.tf`
and documented as a required first-deploy precondition in `docs/runbooks/deployment.md`. (3)
Removed the `RUN chown -R nextjs:nextjs /app` Dockerfile layer, using `COPY --chown=nextjs:nextjs`
in the runner stage instead. (4) `migrate.mjs` now passes a minimal env (`PATH`, `HOME`, `NODE_ENV`,
Windows `SystemRoot`/`SYSTEMROOT`, `DATABASE_URL`) to the `drizzle-kit` child instead of the whole
parent environment. (5) Documented that `npm run db:migrate` is the only sanctioned migration
command (`drizzle.config.ts` + `docs/runbooks/persistence-migrations.md`); a manual
`drizzle-kit migrate` must take the same `8675309` session advisory lock. (2) The `drizzle-orm`
runtime CVE gate (**DEC-049**) is now also noted in the deployment runbook's migration section.
Re-verified: lint/typecheck/test/build/format:check pass; migrations still apply and a second run is
a no-op; image builds, runs as `nextjs`, `/api/health` returns `{"status":"ok"}`; Terraform `fmt
-check -recursive` + `validate` green in both envs.

Documented and verified the deployment foundation without changing code: `infra/` is
scaffolded and validated **offline**, the `apps/worker` / `apps/scheduler` stubs and the
advisory-locked `packages/persistence/scripts/migrate.mjs` behave as designed, and the image
packages the migration SQL and tooling. **Nothing was applied** — no DO resource or Terraform
state exists.

Evidence reproduced this session: Terraform 1.16.3 (`.terraform-version`), DO provider 2.101.1
with `.terraform.lock.hcl` (linux_amd64 + darwin_arm64) committed in both env dirs;
`terraform fmt -check -recursive` clean; `init -backend=false` + `validate` Success in both
envs; offline `plan -refresh=false` with a dummy `DIGITALOCEAN_TOKEN` = **16 to add / 0 change /
0 destroy** per env (VPC, project, DB cluster/db/2 users/pool, Spaces bucket + scoped key, app,
firewall, 4 DB monitor alerts; DNS module opt-in, 0 resources). Runtimes: `WORKER_TICKS=1` and
`SCHEDULER_TICKS=1` stubs exit 0. Migrations: no URL → exit 1 naming both variables with no URL
printed; `DATABASE_MIGRATIONS_URL=... npm run db:migrate` applies 0000–0002 under the advisory
lock and a second run is a no-op. Packaging: `docker build` succeeds, the image runs as non-root
`nextjs`, contains `packages/persistence/drizzle/{0000,0001,0002}.sql` + `meta/` and
`node_modules/.bin/drizzle-kit`, and `/api/health` returns `{"status":"ok"}`. `lint`, `typecheck`,
`test` (6 files / 24 tests), `build`, `format:check` pass.

Security finding → **DEC-049**: because `drizzle-orm` is now a runtime dependency, the ADR-0002
pin `0.38.4` shows **1 high** in `npm audit --omit=dev` (GHSA-gpj5-g38j-94v9 / CWE-89). Accepted
only while identifiers/aliases are code-controlled; upgrade to `>=0.45.2` (breaking, matching
`drizzle-kit`, migration re-verification) before user input reaches identifier/alias builders and
before production. Recorded in `12_OPEN_DECISIONS.md`; ADR-0002 open items extended.

Docs updated: ADR-0012 (scheduler-as-worker deviation + refreshed open items), ADR-0002,
`docs/runbooks/deployment.md` (offline validation, state-bucket bootstrap, packaging /
`.dockerignore`, advisory-lock migration, CI jobs, verified/pending checklist),
`docs/runbooks/persistence-migrations.md` (advisory lock `8675309`, session-scoped, direct/session
only), README layout, and this file.

Post-review hardening: guarded the worker/scheduler numeric env parsing (a bad interval or
`*_TICKS` value now exits non-zero with a clear message instead of busy-looping), removed the
duplicate database→project assignment so the env-root `digitalocean_project_resources` is the
single attachment, and fixed the `aquarela-staging-staging` tag to `aquarela-staging` (both env
roots consistent). Also corrected the stale decision count in `AGENTS.md` (49 accepted, next
`DEC-050`), the README container-image claim (one parameterized image ships devDependencies on
purpose), and pinned `drizzle-orm@0.38.4` / `drizzle-kit@0.30.6` to match ADR-0002.

Next: the **Auth slice** (`DEC-013` / ADR-0003). Rollback: discard the uncommitted docs (or
`git revert` once committed); nothing was applied.

### 2026-09-18 — Terraform infrastructure scaffolded and validated (uncommitted)

Built the `infra/` Terraform layout for DigitalOcean App Platform per
`docs/runbooks/deployment.md`: modules `project`, `networking`, `spaces`,
`database`, `app-platform`, `monitoring`, `dns` (each with `main.tf`,
`variables.tf`, `outputs.tf`, `versions.tf` pinned `~> 2.101`) and env roots
`staging`/`production` (`backend.tf` partial S3/Spaces, `providers.tf`, `main.tf`,
`variables.tf`, `outputs.tf`, `*.tfvars`). Region `ams3` throughout (DEC-014).

Key shapes, verified against provider **v2.101.1** schemas (dumped with
`terraform providers schema -json`): Managed PostgreSQL 16 on the VPC with `app` +
`migrator` users, a transaction pool, and both a pooled `DATABASE_URL` and a
direct/session `DATABASE_MIGRATIONS_URL` built with `format` + `urlencode`; App
Platform spec with `web` + `worker` + `scheduler` (the scheduler is a long-lived
worker because v2.101.1 exposes **no `SCHEDULED` job kind**) + exactly one
`PRE_DEPLOY` `migrate` job; four DBaaS monitor alerts; opt-in `dns` module
(`manage_dns` default false). The database firewall and `digitalocean_project_resources`
live at the env root to avoid the database → app-platform → database cycle.
Root variables are non-secret: `digitalocean_token` defaults to null so the provider
reads `DIGITALOCEAN_TOKEN`; `slack_webhook_url` is marked sensitive and left empty.

Verified (exact commands in "How to verify"): `terraform fmt -check -recursive`
clean; `init -backend=false` + `validate` green for both envs; offline
`plan -refresh=false -lock=false -input=false -var-file=<env>.tfvars` with
`DIGITALOCEAN_TOKEN=dop_v1_dummy` = **16 to add, 0 to change, 0 to destroy** per env
(no API calls). `.terraform.lock.hcl` written for linux_amd64 + darwin_arm64 via
`providers lock`. Added `.terraform-version` (1.16.3) and Terraform ignores to
`.gitignore`; no binary or `.terraform/` committed.

Residual/deliberate: the cluster is assigned to the project twice (its own
`project_id` and the root `project_resources`) — idempotent but a drift watchpoint;
the DB URLs are assembled by hand rather than using the provider's `private_uri`
(which does not urlencode); the scheduler-as-worker is a provider-limitation
workaround with a documented upgrade path. `plan` needed `backend.tf` set aside
because `init -backend=false` cannot plan with a configured backend block; restored
byte-identical afterwards.

Rollback: discard the uncommitted `infra/` files (or `git revert` once committed).
No `apply`, so no cloud resource or state exists.

### 2026-09-18 — Runtime stubs, dependency fixes and advisory-locked migrate wrapper

Added the migrator and runtime boot stubs the App Platform spec needs.
`packages/persistence/scripts/migrate.mjs` is a plain-Node ESM wrapper that resolves
`DATABASE_MIGRATIONS_URL ?? DATABASE_URL`, takes a Postgres session advisory lock
(8675309; serialises overlapping pre-deploy jobs — Spaces has no Terraform state
locking), runs `npx --no-install drizzle-kit migrate` as a child in
`packages/persistence`, always releases the lock and propagates the child exit code;
`drizzle.config.ts` now prefers `DATABASE_MIGRATIONS_URL` too. `drizzle-orm` moved to
`dependencies` (schema modules import it at runtime) and `db:migrate` now runs the
wrapper. New `apps/worker` / `apps/scheduler` workspaces boot a long-lived process
importing `@aquarela/config` + `@aquarela/logger`, with `*_TICKS` smoke hooks and
graceful SIGTERM/SIGINT shutdown; root `tsconfig` now typechecks them and `.env.example`
documents the direct/session `DATABASE_MIGRATIONS_URL`.

Verified: lint/typecheck/test (24 tests)/format:check all pass; both stubs print their
start line and exit 0 under the `*_TICKS=1` smoke env; the wrapper exits 1 with a clear
message (no URL printed) when neither URL is set; against local Postgres 16 the first
`db:migrate` applied all 3 migrations (35 tables) and the second was a no-op; the
`DATABASE_MIGRATIONS_URL` precedence was confirmed. `tsx@4.23.13` installed. Residual:
`npm audit --omit=dev` now flags `drizzle-orm@0.38.4` (GHSA-gpj5-g38j-94v9, high)
because it is a runtime dep; the fix is the breaking 0.45.2 upgrade, deferred
(ADR-0002 pins 0.38.4).

Rollback: revert the commit (new files are additive; the wrapper only changes how
`db:migrate` is invoked). No database change beyond the already-bootstrap migrations.

### 2026-09-18 — Deployment architecture on DigitalOcean (uncommitted)

Owner decisions: application runtimes (`web`, `api`, `worker`, `scheduler`) deploy as separate
**DigitalOcean App Platform components**; **DO Managed PostgreSQL is kept**, so **DEC-014 stands
unchanged** and no new decision-register entry was required; **Terraform** provisions the
infrastructure; **DO Functions** are permitted only for stateless/webhook/light scheduled work,
never the transactional API. The repo stays a **modular monolith**, not microservices.

Docs added/revised: `docs/adr/0001-application-framework-and-deployment.md` promoted to
**Accepted**; new `docs/adr/0012-deployment-topology-and-service-runtimes.md` and
`docs/runbooks/deployment.md`; `02_ARCHITECTURE.md` and `00_README.md` reconciled to the new
topology (migration order, one-repo/multiple-runtimes wording). Two external reviews found no
architectural blockers but flagged operational gaps and two cross-document contradictions; the
accepted fixes are applied: migration ownership and safety (one `web`-owned, advisory-locked
pre-deploy job with a direct/session `DATABASE_MIGRATIONS_URL` and a tested down path; never
`drizzle-kit push`), the resolved packaging choice (one parameterized Dockerfile with
`source_dir: "."`, migrator image must carry `drizzle-kit`), Terraform state handling (no Spaces
state locking → single-runner apply), and the backup/restore/RTO runbook section.

Rollback: docs only and uncommitted — discard the working-tree changes (or `git revert` if
committed).

### 2026-09-18 — Persistence slice: Drizzle schema and first migrations (uncommitted)

Built the Drizzle persistence core for the Phase 1–2 scope in
`packages/persistence/`: 35 tables (organization/identity, catalog,
tax/fees/FX, supplier pricing, recipes, products, costing snapshots, inventory
ledger, outbox/audit), with migrations `0000_enable_extensions` →
`0001_phase1_core` → `0002_invariants` under `packages/persistence/drizzle/`.
`@aquarela/persistence` gained the `pg` driver and a `db:migrate` script; the
runbook `docs/runbooks/persistence-migrations.md` documents generate/apply and
recovery.

Two owner decisions this session: (1) the schema scope is the Phase 1–2 core
(35 tables), with the remaining domains deferred; (2) `schemas/domain-enums.yaml`
wins vocabulary conflicts, and `docs/phase0/DATA_DICTIONARY.md` and
`schemas/phase1_2_draft.sql` were reconciled to it. ADR-0002
(`docs/adr/0002-orm-and-migrations.md`) was promoted to **Accepted**.

Verified by an independent apply of every migration to an empty PostgreSQL 16
(Docker), the invariant checks recorded in the runbook (append-only rejection,
exclusion constraints, `NULLS NOT DISTINCT`, deferrable FKs), the documented
empty-DB recovery replay, and all checks (`format:check`, `lint`, `typecheck`,
`test` — 24 tests, `build`, `npm audit --omit=dev` = 0).

Post-review hardening: added five indexes (`recipe_line_version_idx`,
`cost_card_variant_idx`, `price_scenario_variant_idx`, `audit_event_entity_idx`,
partial `stock_movement_reversal_idx`), a CI `postgres:16-alpine` service with a
`db:migrate` step, shared `rangeCheck`/`approvalCheck`/`rate` column helpers
replacing hand-retyped SQL, `btrim` identifier normalization for `app_user`
username/email uniqueness (whitespace-variant duplicates now rejected), and
removed the dead `isNull` helper. The bootstrap migrations were regenerated
cleanly (`0000` → `0001` → `0002`) and re-verified end to end.

Rollback: the slice is uncommitted, so discard the working-tree changes (or, if
committed, `git revert`); the database recovery path is the forward-only
bootstrap sequence in the runbook, valid only while the database is empty.

### 2026-09-18 — Session handoff and reversibility rules (commit `e55ea23`)

Added the living handoff/work log and the mandatory reversibility rules
(`AGENTS.md` Rules 1–2); recorded the rollback approach for every change. The
handoff has since moved into this repo-local `CONTEXT.md` so orientation never
depends on files outside the repository.

### 2026-09-18 — Foundation scaffold (commit `bb464d6`)

TypeScript foundation: npm workspaces, tooling (ESLint flat config, Prettier,
tsc, Vitest), package boundaries (`config`, `logger`, `domain`, `application`,
`persistence`), a proof-of-boundary value type, CI and a multi-stage container.
Docker build and the `/api/health` check verified.

### 2026-09-18 — Baseline Phase 0 package (commit `536d63e`)

Committed the specification (`00_README.md` … `13_AGENT_BUILD_BRIEF.md`), the
decision register, the Phase 0 artifacts under `docs/phase0/`, the schema drafts,
and ADRs `0001`–`0011` under `docs/adr/`.

### 2026-09-18 — Labour assumptions and cost-source decisions (DEC-047/DEC-048)

Owner-provided labour rates and employer charges captured in
`docs/phase0/LABOUR_ASSUMPTIONS.md`; ad-hoc grocery cost-source precedence
(`DEC-047`) and owner production labour imputation (`DEC-048`).

### 2026-09-18 — Sample analysis and import artifacts

Profiled the Frontline item list + template, monthly report layout, legacy
Zettle/POSX sales export and product-setup screenshots, and generated an açaí
import in Frontline template format. See `docs/phase0/SAMPLE_ANALYSIS.md`,
`docs/phase0/FRONTLINE_PRODUCT_SETUP_NOTES.md` and `samples/generated/`.

### 2026-09-14 → 2026-09-18 — Phase 0 assessment and decision closure

All 48 decisions accepted with owners and phases (see `12_OPEN_DECISIONS.md`),
plus the Phase 0 artifact set (`docs/phase0/`) and ADRs `0001`–`0011`.

## Update protocol

Add a dated entry at the top of the work log with: date, session focus, what
changed, how it was verified, and what comes next. Rewrite the **`Resume here
(next session)`** section for the new next step at the end of every session — even
small or docs-only ones — since it is the single entry point for continuing work;
if there is no next step or it is blocked, say so explicitly and name the blocker.
When the user says **"resume the work"** (or "resume"), read that section and
continue from it without re-asking for context. Update **Current status**
(including git HEAD) and **Next up** in the same pass, and note any new open
decisions or inputs. Handoffs and context live in this repo only — never write
them to a temp directory or any path outside the repository.
