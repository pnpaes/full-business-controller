# Project context

Canonical orientation for this repository: read this first when resuming work,
and update it at the end of any session that changes anything (code, docs,
decisions, data) — per `AGENTS.md` Rule 1. Reference artifacts by path; don't
duplicate their content.

## Resume here (next session)

**Say "resume the work" and start here.** A fresh session must be able to continue
from this section alone.

**Next task:** **slice 5 — recipes / sub-recipes / version / yield / allergens**
(`CALCULATION_CONTRACT.md` §6; `COST-001`, `COST-002`, `PROD-005`; `DEC-005`, `DEC-030`,
`DEC-036`; depends on slice 3). Slice 4 is committed as `0b4904f`; its two adversarial
reviews were in flight when this section was written, so **reconcile any unapplied slice 4
findings first** (the structural review's accepted items: cross-org/item/supplier/unit
guards only exist in the application while the FKs are deferred, and a check that allows a
state the derived `base_qty_accepted` column then rejects). `docs/BUILD_ROADMAP.md` tracks
the loop and gates.

**Scope (do):**

1. Read first: `docs/phase0/CALCULATION_CONTRACT.md` §6 (recipe cost and yield),
   `03_DOMAIN_MODEL.md` (recipes, sub-recipes, versions, yield),
   `docs/phase0/DATA_DICTIONARY.md` for the recipe tables, `DEC-005`, `DEC-030`,
   `DEC-036`, the effective-dating invariants already applied in `0002`/`0005`, and the
   slice 3/4 APIs you compose (`packages/domain/src/{unit,unit-conversion,supplier-pack,landed-cost}.ts`).
2. Add the deferred recipe schema (`recipe`, `recipe_version`, `recipe_line`, allergens)
   as a new migration (next free number) with a documented `_down.sql`, mirroring the
   slice 3/4 conventions: additive, effective-dated with the same gated exclusion
   constraints, org-scoped, decimal scales per the data dictionary, and `db:generate`
   left clean. Hand-written invariants go in a separate hand-written migration, never
   inside a generated file; migrations `0000–0006` are not edited.
3. Implement the domain and application layer for the unambiguous parts: recipe version
   state and effective dating, nested lines with unit conversion, yield/portion maths and
   the per-portion cost from §6, reusing `convertQuantity`, `computeLandedCost` and the
   DEC-047 cost-source precedence. Anything the contract does not pin down (allergen
   propagation through sub-recipes, yield-loss application order, which cost source a line
   uses) must be raised for a decision, not invented.
4. Tests: unit tests with the in-memory fakes plus conditional PostgreSQL integration
   tests (gated on `DATABASE_URL`, rolled back), covering the §6 formula, a version/yield
   boundary case, nested sub-recipe composition, and the invariants the migration adds.
5. Verify, send the calculation to two adversarial reviewers (roster in
   `docs/BUILD_ROADMAP.md` §2), reconcile accepted/declined findings, and commit
   atomically with the verification evidence and rollback in the body (Rule 2); then
   rewrite this section for slice 6.

**Scope (do not):** do not rework the committed auth/UI/master-data/receiving
workstreams; invent no decision (append to `12_OPEN_DECISIONS.md` as `DEC-052` or later
only if genuinely needed); no external writes; do not edit migrations `0000–0006`.

**Files/paths:** `packages/persistence/src/schema/` + `repositories/`, the new
`packages/persistence/drizzle/0007_*` (or next free), `packages/domain/src/`,
`packages/application/src/`, `docs/runbooks/persistence-migrations.md` (migration order),
`CONTEXT.md` and `docs/BUILD_ROADMAP.md`.

**Acceptance / verification:** `npm run lint && npm run typecheck && npm run test &&
npm run build && npm run format:check` pass with and without `DATABASE_URL`; the migration
applies on an empty database, re-runs as a no-op and its down path is rehearsed;
`npm audit --omit=dev` stays 0; recipe costs match `CALCULATION_CONTRACT.md` §6 with
decimal-only arithmetic and HALF_UP at the documented boundaries.

**Open decisions / inputs that shape it:** I5 (real recipes) gates real values — build
against synthetic fixtures per the roadmap convention. The open items under "Open
decisions / inputs" still stand (the `m`/missing `length` dimension mismatch, the missing
`numeric(19,6)` cap in `packages/domain/src/decimal.ts`). Slice 4's deferred
acceptance-to-stock posting is slice 8, gated on `ADR-0005` (Proposed).

**After this task:** **slice 6 — operating costs + labour + allocation**
(`DEC-047`/`DEC-048`), per `docs/BUILD_ROADMAP.md`.

## What this is

**Aquarela Business Control** — a secure, testable modular monolith for an Oslo
café with two locations, covering costing, pricing, inventory, production,
sales/imports, workforce and reporting. It is **documentation-first**: Phase 0 is
complete (specification, 51 accepted decisions, artifacts and ADRs); the
foundation scaffold, the Phase 1–2 persistence core, the auth slices (1a–1e), the
UI token foundation and master-data slices 2–3 are built; slice 4 (receipt + price
history + landed cost) is committed; slice 5 (recipes) is next.

## Where things live

- `00_README.md` … `13_AGENT_BUILD_BRIEF.md` — the specification package
  (inputs, rarely edited). Start with `00_README.md`.
- `12_OPEN_DECISIONS.md` — the accepted decisions (DEC-001…DEC-051); the
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

- **As of:** 2026-09-19 — branch `main`; HEAD `e3706c0` (slice 4 including its
  review fixes and migrations `0007`/`0008`). Everything is committed; the working
  tree is clean. **Nothing has been applied to DigitalOcean.**
- **Auth complete and security-reviewed (slices 1a–1e):** domain primitives (1a);
  persistence layer (1b-i); application flow (1b-ii); password reset + access
  control (1b-iii, `2ce8847`; reset neutrality `5776914`); hardening (`60ac52e`:
  fail-closed MFA config, 32-byte key validation, `isAuthorizedFor` throws on an
  empty requirement, audit before/after the secret guard); the HTTP surface (1c,
  `5c42c1d`: routes, cookies, CSRF/same-origin, per-IP limiter, login/2FA/reset
  pages); TOTP enrolment + recovery codes (1d, `07af21d`); first-owner bootstrap +
  MFA enrolment surface (1e, `e51a957`); atomic MFA disable + bootstrap `--dry-run`
  (`0cce93b`).
- **Master data done:** slice 2 — unit + supplier-pack value objects (`87f9ced`,
  strict package-to-base fix `4ccfb23`); slice 3 — master-data schema + conversion
  graph (`a869227`, migration `0004`), `unit_conversion` overlap invariants
  (migration `0005`) + conversion-graph hardening and `DEC-050`/`DEC-051`
  (`b8897bf`).
- **UI foundation:** design tokens package (`aa2eff5`), token-driven UI primitives
  (`a83a312`), layout reference note (`dad2ff0`), accessibility/form-wiring fixes
  (`74ac467`).
- **Decision briefs + cost estimate:** DEC-049 assessment (`c8e86e0`), deployment
  cost estimate (`21e9c72`), multi-tenancy posture (`018930d`), jobs-runtime
  comparison recommending pg-boss (`3505aa8`), runbook pre-apply inputs
  (`bfc5f74`).
- **DEC-049 closed:** drizzle-orm 0.45.2 / drizzle-kit 0.31.10 upgrade (`cc86f13`);
  `npm audit --omit=dev` = 0.
- **Tests:** 318 with `DATABASE_URL` before the drizzle upgrade, 321 after; 265
  passed / 53 skipped without it (as recorded by the slice sessions; re-verify on
  resume). Open verification debt: the per-process rate limiter needs a shared
  store before multi-instance deployment; the reset-token delivery is a no-op stub
  until the email slice; the palette hex values and data-viz palette semantics
  await owner sign-off (see "Open decisions / inputs").
- **Persistence core + deployment foundation (committed):** Drizzle schema (35
  tables), migrations `0000_enable_extensions` → `0005_unit_conversion_invariants`
  (additive, tested down paths), the advisory-locked migrator, worker/scheduler
  stubs and the `infra/` Terraform scaffold validated offline. Not applied.
- **Not yet built:** business slices 5+; the deferred tables
  (workforce, integrations, competitor, AI, sales, procurement, production,
  counts/transfers, period close, platform job/file/approval).

## Next up (prioritised)

`docs/BUILD_ROADMAP.md` is the ordered execution tracker for these slices (slice 0 and
1a–1e, 2, 3 and 4 done; **slice 5 next**). The list below is the short narrative form.

1. **Slice 4 — receipt + price history + landed cost** — finish, verify, review and
   commit the in-flight work. See "Resume here".
2. **Slice 5 — recipes / sub-recipes / version / yield / allergens** — per
   `docs/BUILD_ROADMAP.md` (`CALCULATION_CONTRACT.md` §6).
3. **Deployment foundation — scaffolded and validated offline (committed); not
   applied.** `infra/` Terraform (project, database, spaces, networking,
   app-platform, monitoring, dns) + the App Platform app spec are done, and the
   `apps/worker` / `apps/scheduler` stubs exist. Before any `apply`: the owner
   decisions under "Open decisions / inputs", real DO credentials and a
   provisioned Spaces state bucket, and a single-runner apply. See
   `docs/adr/0012-deployment-topology-and-service-runtimes.md` and
   `docs/runbooks/deployment.md`.
4. **Costing verification** — against `docs/phase0/CALCULATION_CONTRACT.md` with
   synthetic fixtures, then real data.
5. **Load real data** and sign the six golden fixtures
   (`docs/phase0/GOLDEN_FIXTURES.md`).

## Open decisions / inputs (do not block development)

- External inputs still outstanding: supplier costs/receipts (I4), recipes +
  yields (I5), productive-hours % (I8 remainder), opening counts (I7), and the
  Frontline data-shape confirmations (item-level sales lines, per-line
  channel/applied tax, SKU, add-on representation). See
  `docs/phase0/SOURCE_DATA_REQUEST.md` and `docs/phase0/UNBLOCK_CHECKLIST.md`.
- Surfaced by the 2026-09-19 slices (also tracked in `docs/BUILD_ROADMAP.md` §5):
  - unit `m` vs the missing `length` dimension — a dimension-vocabulary mismatch
    (`schemas/domain-enums.yaml`) to resolve with the owner;
  - the missing `numeric(19,6)` digit cap in `packages/domain/src/decimal.ts`;
  - the palette hex values need owner sign-off, and the data-viz palette
    semantics are undefined;
  - the per-IP rate limiter is per-process — a shared store (a migration) is
    needed before multi-instance deployment;
  - reset-token delivery is a no-op stub (`deliverResetToken` port) until the
    email slice;
  - the deferred-FK hardening on `goods_receipt_line` (a `supplier_item_id` or
    `item_id` from another organization, a mismatched supplier, or a unit that
    does not match the item is guarded only in the application until those FKs
    are added — make them composite and validate per the runbook's
    `NOT VALID` → `VALIDATE` pattern; the `effective_to = effective_from` empty
    window is allowed by `DEC-052`).
- `DEC-049` is **closed** (2026-09-19): the drizzle-orm 0.45.2 /
  drizzle-kit 0.31.10 upgrade is committed (`cc86f13`) and `npm audit --omit=dev`
  reports 0; it is no longer an open security regression.
- Deployment/apply gates (2026-09-19): **ADR-0004 acceptance** and the
  **Graphile Worker vs pg-boss** choice (the jobs-runtime comparison `3505aa8`
  recommends **pg-boss**; the worker/scheduler design depends on the outcome); the
  **scheduler `SCHEDULED` provider gap** (DO provider v2.101.1 has no `SCHEDULED`
  job kind, so `scheduler` is a long-lived worker + tick loop until the
  provider/API exposes it or ADR-0004 picks a scheduler); Terraform state locking
  (**Spaces has none** — a single-runner apply is the serialization) plus the
  **out-of-band state-bucket bootstrap**; **multi-tenancy posture** (`018930d`,
  shared-schema vs schema/DB-per-tenant, an **owner decision**); **component cost
  estimate** (`21e9c72`); staging data-sanitization owner; the **legacy
  instance-slug check** before apply; **real DO credentials** and a provisioned
  state bucket. Dockerfile/migrator packaging is **resolved** (one parameterized
  Dockerfile whose runner keeps devDependencies so the migrator carries
  `drizzle-kit`). **Required pre-apply step:** run
  `infra/bootstrap/database-grants.sql` once as `doadmin` after the cluster/users
  exist and **before the first deploy** (without it `migrator` has no DDL
  privileges and `app` cannot read) — see `docs/runbooks/deployment.md`
  ("Database privilege bootstrap") and the runbook's proxy/dry-run notes
  (`bfc5f74`).
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
- **Everything through `e3706c0` is committed** (slice 4 included, with migrations
  `0006`–`0008` and additive down paths); `git revert` any commit, or discard the
  working tree if a future slice is in flight.
- The `infra/` scaffold, runtime stubs and persistence core are committed; revert
  them with `git revert` if needed. **No cloud resource was created — only offline
  `fmt`/`validate`/`plan` ran, never `apply`; no Terraform state exists, and
  nothing has been applied to DigitalOcean.**
- Migrations 0000–0005 are additive with tested down paths. While the database is
  empty the tested recovery is `DROP SCHEMA public CASCADE; DROP SCHEMA drizzle
CASCADE; CREATE SCHEMA public; npm run db:migrate` (see the runbook). Once data
  exists, migrations must be additive (expand → migrate → contract) with a tested
  data-preserving down path (see `AGENTS.md` Rule 2).
- External writes require a documented rollback and per-source approval
  (`DEC-015`).

## Work log (append-only, newest first)

### 2026-09-19 — Auth slices 1b-iii→1e, master data (2–3), UI tokens, decision briefs, drizzle upgrade

Committed a run of slices on `main`, in order: `2ce8847` password reset + access
control (slice 1b-iii); `5776914` reset neutrality (no token in the result, a
`deliverResetToken` port, org-scoped redemption); `87f9ced` unit + supplier-pack
value objects (slice 2); `4ccfb23` slice 2 review fix (strict package-to-base);
`aa2eff5` design tokens package; `60ac52e` auth hardening (fail-closed MFA
config, 32-byte key validation, `isAuthorizedFor` throws on an empty
requirement, audit before/after the secret guard); `a83a312` token-driven UI
primitives; `dad2ff0` UI layout reference note; `c8e86e0` DEC-049 assessment;
`21e9c72` deployment cost estimate; `018930d` multi-tenancy posture; `3505aa8`
jobs-runtime comparison (recommends pg-boss); `bfc5f74` runbook pre-apply
inputs; `74ac467` UI primitive accessibility/form-wiring fixes; `5c42c1d` auth
HTTP surface (slice 1c: routes, cookies, CSRF/same-origin, per-IP limiter,
login/2FA/reset pages); `a869227` master-data schema + conversion graph (slice
3: `unit_conversion`, `supplier`, `supplier_item`, `cost_center` + migration
0004); `07af21d` TOTP enrolment + recovery codes (slice 1d); `b8897bf`
`unit_conversion` overlap invariants (migration 0005) + conversion-graph
hardening (reject self-edges, rescale per hop, 32-hop cap, round-to-zero
rejection) + `DEC-050`/`DEC-051`; `e51a957` first-owner bootstrap + MFA
enrolment surface (slice 1e); `cc86f13` drizzle-orm 0.45.2 / drizzle-kit 0.31.10
upgrade, closing DEC-049 (`npm audit --omit=dev` = 0); `0cce93b` MFA disable now
atomic (revocation inside disable's transaction) + bootstrap `--dry-run` +
runbook proxy/dry-run notes.

Verified per slice: with `DATABASE_URL` the suite grew from 318 tests before the
drizzle upgrade to 321 after; without it 265 passed / 53 skipped;
lint/typecheck/build/format:check green at each commit. Review findings
accepted: the conversion-graph invariants and hardening, the atomic MFA
disable, the neutral password reset, and token-family separation. Declined with
reasons: none new this session — the earlier declines stand as recorded (the
drizzle advisory was governed by DEC-049, now closed by the upgrade; the
domain-layer logging policy; the provisional lockout escalation). Slice 4 was
started by a parallel session and is left uncommitted in the working tree; its
resume entry is at the top of this file.

Rollback: each item above is its own commit — `git revert <sha>` per slice. The
drizzle upgrade changed lockfile and migration metadata only; migrations
0000–0005 are additive with tested down paths.

### 2026-09-19 — Auth slice 1b-iii: password reset + access control (committed `2ce8847`)

Completed the server-side auth application surface on the committed 1b-ii flow. Persistence:
new `packages/persistence/src/repositories/access.ts` (`listUserRoles`, `listUserLocationScopes`,
`listAssignableRoles`, `assignRole` — idempotent upsert against the `NULLS NOT DISTINCT`
`user_role_key`, `removeRole`, `replaceLocationScopes`) exported from the package index, with
rolled-back PostgreSQL integration tests (round-trip, duplicate grant, remove no-op, exact
scope replacement). Application: `AuthStore` gained reset-token create/find/consume,
role/scope list/assign/remove/replace and `setUserStatus`, and `createPostgresAuthStore`
implements them; `AuthDeps` gained `passwordResetTtlMinutes` and an optional
`passwordHashOptions` cost seam. New `password-reset.ts` (`beginPasswordReset` is always
neutral and stores only the token hash; the plaintext token is returned only for out-of-band
delivery and never logged/audited; `completePasswordReset` claims the token atomically,
hashes the new password, revokes every session and audits in one transaction) and `access.ts`
(`loadUserAccess`, the pure `isAuthorizedFor` with no implicit admin bypass, `assignRole`
which revokes sessions, `replaceLocationScopes`, `disableUser` which disables and revokes in
one transaction). `AUTH_AUDIT_ACTIONS` gained `auth.password_reset.{requested,completed,failed}`,
`auth.access.{role_changed,scopes_changed}` and `auth.user.disabled`; `audit()` now passes
`before`/`after` jsonb. The in-memory `FakeAuthStore` moved to `test-support.ts` and gained
the new methods; new unit tests cover the neutral reset, single-use/expiry, session
revocation after reset, role/scope allow/deny, role-change revocation and disable+reject.
No migration and no new dependency.

Verified: `lint`, `typecheck`, `build` pass and all changed/new files pass `format:check`;
slice-scoped tests **41 passed / 32 skipped** without `DATABASE_URL` and **73 passed** with
it; integration tables left with zero rows. Full-repo `test` currently also fails 3
`packages/ui/src/{contrast,tokens}.test.ts` assertions from the concurrent workstream, and
`format:check` flags those concurrent `packages/ui` files — neither is part of this slice.
Roadmap statuses are left for the commit step.

Rollback: discard this uncommitted change (or `git revert` once committed); the modules are
additive and imported by no runtime yet; the schema already existed.

### 2026-09-19 — Auth slice 1b-ii: review fixes (atomicity, MFA lockout)

Applied both review findings before 1b-iii. Concurrency: `verifyMfa` now advances the TOTP
replay counter and consumes recovery codes with atomic compare-and-sets in
`packages/persistence/src/repositories/totp.ts` (`advanceLastUsedCounter`,
`consumeRecoveryCodeHash`), replacing the read-then-write `setLastUsedCounter`; a lost
compare-and-set is treated as a replay, so two racing requests cannot both get a session.
Atomicity: `AuthStore` gains `withTransaction`, the Postgres adapter binds a store to
`db.transaction`, and `authenticate`/`verifyMfa`/`logout`/`logoutAll` run inside it so the
audit row and the state change commit together. Security gap: MFA attempts now share the
progressive lockout (`computeLockout`/`isLocked`/`recordLoginFailure`) and a successful
password step no longer resets the counter when MFA is still required, so second-factor
brute force is bounded; `openSecret` failure fails closed with a `secret_unseal_failed`
audit; `AuthUser.status` and `app_user.status` are typed as the `UserStatus` union
(type-only, `db:generate` reports no schema change). Declined: the drizzle-orm advisory is
already governed by DEC-049.

Verified: **120 tests** (18 files) with `DATABASE_URL` and **94 passed / 26 skipped**
without it; `lint`, `typecheck`, `build` and `format:check` pass; the new tests cover MFA
lockout after repeated failures, a valid code rejected once locked, a tampered sealed
secret, and single-use recovery-code consumption.

Rollback: discard this uncommitted change (or `git revert`); the compare-and-set primitives
are additive and the previous `setLastUsedCounter` behaviour is simply replaced.

### 2026-09-19 — Auth slice 1b-ii: application sign-in / MFA / session flow

Built `packages/application/src/auth/` on the 1b-i repositories: an `AuthStore` port with a
`createPostgresAuthStore` adapter (transaction-friendly, `db.transaction((tx) => ...)`),
`authenticate` (always runs one verification including the dummy path for an unknown account,
returns the single `AUTH_ERROR_GENERIC`, applies `computeLockout`/`isLocked`, resets the
counter and rehashes on success, requires MFA without issuing a session when `totpEnabled`),
`verifyMfa` (opens the sealed secret, rejects a replayed counter, consumes a recovery code
once), `verifySession`/`logout`/`logoutAll`, and an `AUTH_AUDIT_ACTIONS` vocabulary; every
outcome writes an audit row. `packages/config` gained `SESSION_TTL_MINUTES` (480),
`PASSWORD_RESET_TTL_MINUTES` (30) and an optional `TOTP_SECRET_ENCRYPTION_KEY`, and the
persistence layer gained `findUserById`.

Verified: **117 tests** (18 files) with `DATABASE_URL` against local PostgreSQL 16 and
**92 passed / 25 skipped** without it; `lint`, `typecheck`, `build` and `format:check` pass.
Password reset, role/location authorization and the admin operations are deferred to slice
1b-iii, so this slice is scoped to the sign-in path only.

Rollback: discard this uncommitted change (or `git revert` once committed); the module is
additive and imported by no runtime yet.

### 2026-09-19 — Auth slice 1b-i: accepted review findings applied

Applied the accepted external-review findings to the uncommitted 1b-i persistence layer.

- `findUserByIdentifier(db, organizationId, identifier)` — adds
  `eq(appUser.organizationId, organizationId)`, keeps the `lower(btrim(...))`
  match, selects `limit(2)` and throws on a cross-column collision (one user's
  username = another's email) instead of silently picking one.
- Fail loud: `recordLoginFailure` throws on a non-future `lockedUntil`;
  `consumeResetToken` gained `gt(expiresAt, at)`; `setLastUsedCounter` throws on a
  negative counter and on zero matched rows (no enrolment).
- `findActiveSessionByTokenHash` inner-joins `app_user` and requires
  `status = "active"`, so off-boarding/role change is a real revocation barrier
  (a session racing `revokeAllSessionsForUser` still fails validation); JSDoc
  documents the requirement.
- Caller-audit JSDoc (append the `audit_event` row in the same transaction,
  ADR-0003) added to `recordLoginSuccess`, `updatePasswordHash`, `setUserStatus`
  and `revokeAllSessionsForUser`.
- Migration down path: new `0003_user_totp_last_used_counter_down.sql` (not in
  `_journal.json`), referenced from the runbook; 0000–0002 are bootstrap-generated
  with no down companion. `_journal.json` gained its trailing newline.

Verified: `lint`/`typecheck`/`build`/`format:check` pass; **80 passed / 24 skipped**
without `DATABASE_URL` and **104 passed (17 files)** with it; integration tables
left with zero rows (`organization`, `app_user`, `auth_session`, `user_totp`,
`password_reset_token`, `audit_event`). Down rehearsal: applied the down file
(column gone), and — because drizzle-kit tracks applied migrations in the ledger —
re-applied by deleting the 0003 ledger row and re-running `db:migrate` (column and
check restored, ledger back to 4; database left migrated). No blocker findings
remained unapplied.

Rollback: discard this uncommitted change (same as the rest of 1b-i); the down
file is additive and the DB is left migrated.

### 2026-09-19 — Auth slice 1b-i: persistence access layer

Built the server-side persistence/auth access layer on the existing schema (uncommitted).

- **Domain crypto:** `packages/domain/src/auth/secret-box.ts` — `parseSecretKey` (32-byte
  base64), `sealSecret`/`openSecret` (AES-256-GCM via `node:crypto`, self-describing
  `v1.<iv>.<ciphertext>.<tag>` base64url, random 12-byte IV), exported from the auth barrel;
  `DomainError` on wrong length/key, tamper, malformed input or unknown version, and never
  partial plaintext.
- **Schema + migration:** added nullable `user_totp.last_used_counter` with
  `user_totp_last_used_counter_check` (`null or >= 0`); generated
  `0003_user_totp_last_used_counter.sql` (+ meta snapshot + journal), header records the down
  path `ALTER TABLE "user_totp" DROP COLUMN "last_used_counter";`. The migration table and
  invariant checks in `docs/runbooks/persistence-migrations.md` were updated.
- **Persistence client + repositories:** `client.ts` (`createDb(connectionString)` →
  `{ db, pool, close }`, `Database`/`NodeDatabase`/`DatabaseTransaction` types; the caller
  supplies the URL, no env reads); `repositories/{users,sessions,totp,password-reset,audit}.ts`
  all taking `db` first, using parameterised `eq`/`and`/`sql` (no identifier interpolation,
  DEC-049). `sessions` stores only the token hash; `consumeResetToken` is conditional on
  `used_at is null` (single-use); `setLastUsedCounter` is `greatest(current, next)`
  (monotonic); `audit` inserts only (the DB trigger enforces append-only). All exported from
  `packages/persistence/src/index.ts`; added `@types/pg` devDependency.

Verified: `npm run lint && npm run typecheck && npm run test && npm run build &&
npm run format:check` pass; **80 passed / 17 skipped** without `DATABASE_URL` and **97 passed
(17 files)** with it (integration files `users` 4, `sessions` 3, `totp` 3, `password-reset` 3,
`audit` 4 — each `describe.skipIf(!process.env.DATABASE_URL)` and run in rolled-back
transactions so the append-only audit rows are not left behind). Against local PostgreSQL 16:
reset the empty DB, the first `DATABASE_URL=... npm run db:migrate` applied 0000–0003 (ledger
count 4), a second run was a no-op, `\d user_totp` shows `last_used_counter integer` plus the
check, a negative value is rejected, and a re-run of `npm run db:generate` reports "No schema
changes" (schema/snapshot in sync).

Rollback: discard this uncommitted change. The code is additive (no runtime imports it yet);
migration 0003 is additive with the documented down path above, and while the DB is empty the
runbook's `DROP SCHEMA public/drizzle CASCADE` + `db:migrate` replay remains valid.

Next: **Auth slice 1b-ii** (application commands/queries on this layer).

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
