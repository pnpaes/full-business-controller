# Multi-tenancy posture — decision input

> **Status: input only — not a decision.** This brief does not accept a posture and does not modify
> `12_OPEN_DECISIONS.md`, `CONTEXT.md`, `docs/BUILD_ROADMAP.md` or any ADR. The tenancy question is an
> **open owner decision**, recorded in `docs/adr/0012-deployment-topology-and-service-runtimes.md:113-115,163-164`,
> `docs/BUILD_ROADMAP.md:133-134` and `CONTEXT.md:59,230`. There is no `DEC-` for it. It is named as a
> gate on the deployment apply (`CONTEXT.md:59`) and it shapes the auth/authorization slices
> (`docs/adr/0003-identity-and-role-model.md`).
>
> Read-only research. Dates and costs outside the repository are flagged in §7.

## Finding (short)

**The system is being built as a single-organization deployment, with a multi-organization-capable
schema.** The `organization` table is the tenant root and carries no parent
(`packages/persistence/src/schema/organization.ts:7-14`); every business table carries
`organization_id` (`packages/persistence/src/schema/columns.ts:20-21`), and most natural-key uniqueness
is per organization. But nothing in the running application or infrastructure resolves, binds or
enforces a tenant: there is one PostgreSQL database and one runtime database user per environment with
no RLS (`infra/modules/database/main.tf:18-49`, `infra/bootstrap/database-grants.sql:38-45`), sessions
are not tenant-bound (`packages/persistence/src/schema/identity.ts:144-164`,
`packages/application/src/auth/session.ts:39-48`), and the web app has no login route that could
resolve a tenant (`apps/web/app/`). Today `organization_id` is a convention that is effectively
constant.

## 1. What the specification says

- Product scope is one café group ("Aquarela Kafé") with two Oslo locations: Kongens gate and
  Tullinløkka, plus future locations — `01_PRODUCT_SCOPE.md:5`, `03_DOMAIN_MODEL.md:38-39`.
- The only "SaaS" framing in the repo is one line of ADR-0012 context ("a SaaS-oriented business
  control platform for two Oslo locations") — `docs/adr/0012-deployment-topology-and-service-runtimes.md:12`.
  It is not corroborated by the product scope and reads as intent, not a committed commercial model.
- The authoritative requirement is **role + location scope**, not organization isolation:
  "Enforce role and location scope on every query, mutation and export" — `11_REQUIREMENTS_CATALOG.md:23`
  (FND-002). `07_SECURITY_AND_NFR.md:5` lists organization among authorization inputs but no
  requirement asks to isolate one organization from another.
- ADR-0012 already names the current model: "**Tenant posture:** the current model is a shared schema
  with `organization_id` scoping. Schema-per-tenant or DB-per-tenant is adopted only if an isolation or
  regulatory need emerges — this is an **open item for the owner**" —
  `docs/adr/0012-deployment-topology-and-service-runtimes.md:113-115`.

## 2. What the code and infrastructure actually assume today

### 2.1 `organization_id` is a convention, not an enforced scope

- `orgId()` is `uuid not null` with the FK attached by each caller; the column is present on every
  mutable business table — `packages/persistence/src/schema/columns.ts:20-21`.
- `organization` itself is the root and has no `organization_id` — `packages/persistence/src/schema/organization.ts:7-14`.
- No code path derives the current organization from a request, host, certificate or environment
  variable. `authenticate()` takes `organizationId` as **caller-supplied input** and looks the user up
  within it — `packages/application/src/auth/authenticate.ts:16-21,52`.

### 2.2 Org-scoped uniqueness and org-scoped identifier lookup already exist

- `app_user` username/email are unique **per organization** via expression indexes:
  `ON "app_user" ("organization_id", lower(btrim("username")))` and the same for email —
  `packages/persistence/drizzle/0002_invariants.sql:8-11`.
- `findUserByIdentifier(db, organizationId, identifier)` is explicitly org-scoped —
  `packages/persistence/src/repositories/users.ts:19-42`; the JSDoc cites the per-org indexes.
- Per-org natural keys are used broadly: `role_organization_id_code_key`
  (`packages/persistence/src/schema/identity.ts:88`), `location_organization_id_code_key`
  (`organization.ts:31`), `storage_area_location_id_code_key` (`organization.ts:51`),
  `channel_organization_id_code_key` (`organization.ts:65`), `unit_…` (`catalog.ts:29`),
  `item_…` (`catalog.ts:67-68`), `product_…` (`products.ts:27,51-52`), `recipe_…` (`recipes.ts:29`),
  `tax_rule_…` (`tax.ts:50`), `exchange_rate_org_pair_date_key` (`tax.ts:110`).

So the **schema is multi-organization-capable**; the isolation is designed into uniqueness and the
login lookup, and nowhere else.

### 2.3 There is no tenant resolver, and no caller supplies a tenant yet

- `AuthenticateInput` requires `organizationId` (`authenticate.ts:16-21`), and every auth command
  (`session.ts:50-54,74-79`, `access.ts:69-77,111-117,144-149`, `password-reset.ts:12-14,93-95`,
  `mfa.ts:16-18`) requires an `organizationId`, but **nothing produces one**.
- `apps/web` contains only `app/page.tsx`, `app/layout.tsx` and `app/api/health/route.ts` — there is
  no login route, middleware or host/subdomain handling.
- Config has no organization/tenant setting — `packages/config/src/env.ts:10-34`; `.env.example` has
  no org variable.
- There is no committed organization seed/bootstrap script (organization rows are inserted only in
  tests, e.g. `packages/application/src/auth/auth.postgres.test.ts:61`). The spec's "seeded demo
  organization" is development data — `07_SECURITY_AND_NFR.md:140`.

### 2.4 Sessions and authorization are not tenant-bound

- `auth_session` has **no `organization_id`**; its only uniqueness is on `token_hash` —
  `packages/persistence/src/schema/identity.ts:144-164`.
- `verifySession()` resolves a token by hash alone and returns `{ id, userId, expiresAt }` with no
  organization — `packages/application/src/auth/session.ts:39-48`,
  `packages/application/src/auth/types.ts:31-35`.
- `findUserById(userId)` is not org-scoped (`packages/persistence/src/repositories/users.ts:44-47`);
  the store port exposes `listUserRoles(userId)`, `listUserLocationScopes(userId)`,
  `revokeAllSessionsForUser(userId)` etc. with no organization parameter —
  `packages/application/src/auth/types.ts:106,128,136-140`.
- `isAuthorizedFor()` checks role and location only; there is no organization check —
  `packages/application/src/auth/access.ts:40-56`.

### 2.5 No RLS and a single runtime database role

- Drizzle metadata reports `"isRLSEnabled": false` for the tables
  (`packages/persistence/drizzle/meta/0003_snapshot.json:73` and throughout); no `CREATE POLICY`,
  `current_setting` or `SET LOCAL` exists anywhere under `packages/`, `infra/` or `schemas/`.
- `app` is one runtime user granted DML on **all** tables via default privileges —
  `infra/bootstrap/database-grants.sql:38-45`; `migrator` owns the schema —
  `database-grants.sql:28-31`. There is no per-tenant role or connection.

### 2.6 One project, one database, one app, one bucket per environment

- `digitalocean_database_cluster` → a single `digitalocean_database_db` → single `app`/`migrator`
  users and one transaction pool — `infra/modules/database/main.tf:7-49`.
- The environment root wires exactly one database and one App Platform app —
  `infra/envs/production/main.tf:42-78`; sizes/names are per environment, not per tenant —
  `infra/envs/production/production.tfvars:1-18`.
- Backup/restore is per environment: Managed PostgreSQL PITR for the whole cluster plus a Spaces
  copy; restore = restore the cluster and repoint `DATABASE_URL`/`DATABASE_MIGRATIONS_URL` —
  `docs/runbooks/deployment.md:232-245`. There is no per-tenant restore path.

### 2.7 Uniqueness that is NOT org-scoped (multi-tenant hazards)

Most natural keys include `organization_id`. The exceptions:

- `stock_movement_idempotency_key_key` is unique on `idempotency_key` **alone**
  (`packages/persistence/src/schema/inventory.ts:83`) — a genuinely cross-tenant collision point if
  the same key were ever produced by two organizations.
- `stock_balance_key` on `(item_id, location_id, storage_area_id, lot_id)` and
  `stock_lot_item_id_location_id_lot_number_key` on `(item_id, location_id, lot_number)` omit
  `organization_id` (`inventory.ts:123-126`, `inventory.ts:38`), but key only on UUIDs that are
  themselves org-owned rows. These are **implicitly** org-scoped (safe in practice) but not explicit,
  so they are not self-evidently tenant-safe to a reviewer.
- `auth_session.token_hash` and `password_reset_token.token_hash` are globally unique by design
  (`identity.ts:151,171`); fine with random tokens, not a tenant selector.

## 3. Assessment: which posture is actually being built

**Single-organization deployment.** Every deployment has one company, one database, one app and one
bucket; the intended model in the product scope is one café group per install. The `organization_id`
columns and org-scoped unique indexes make the schema **ready** to hold several organizations, but the
application does not currently isolate them, so a genuine shared multi-tenant deployment would be a
deliberate build step, not a configuration switch.

## 4. What each posture requires or breaks

| Dimension | A. Single-org per install (current) | B. Shared multi-tenant DB (shared schema) | C. Schema/DB per tenant |
| --- | --- | --- | --- |
| Tenant resolution on login | Not needed if the single org is pinned at bootstrap; login still needs one org id supplied (`authenticate.ts:16-21`) | Required: derive org from host/subdomain, email domain or a login selector; never trust caller-supplied `organizationId` | Required (tenant → schema/DB routing), plus routing in the pool |
| Session binding | Optional; sessions already work (`session.ts:39-48`) | Add `auth_session.organization_id` and carry it on `AuthSessionRecord` (`identity.ts:144-164`, `types.ts:31-35`) | As B, plus schema/DB name on the session/connection |
| Authorization filters | Not needed | Central org filter on every query, or RLS; today `loadUserAccess`/store methods are userId-only (`access.ts:23-32`, `types.ts:136-140`) | As B; RLS optional since schemas are separate |
| Unique indexes | Global `stock_movement_idempotency_key_key` is harmless with one org (`inventory.ts:83`) | Must scope the idempotency key (and ideally make `stock_balance`/`stock_lot` org-explicit) — additive index migration | No cross-tenant key collisions by construction |
| Migrations | One migration job, one schema (ADR-0012:86-94) | Unchanged (still one schema); backfill `organization_id` if merging existing installs | Migration must run per tenant schema/DB; needs a loop + tracking, and the pre-deploy advisory lock becomes per-tenant |
| Backups / restore / erasure | One PITR restore covers everything; per-tenant restore/erasure not possible (`docs/runbooks/deployment.md:232-245`) | Still one PITR restore for all tenants; per-tenant restore/erasure needs logical export + delete — a real gap under GDPR/data-controller expectations | Per-tenant PITR possible; most expensive to operate |
| Terraform boundary | One project + DB + app + bucket per environment (`production.tfvars:1-18`) | Unchanged for shared schema; RLS adds policy migrations, not infra | Per-tenant resources or provisioning per tenant; Terraform and ops surface grow with tenant count |
| Cost | Lowest; one cluster and one app set | Marginal cost per added tenant ≈ 0 until scale forces vertical sizing/read replicas (ADR-0012:105-111) | Highest; DB/app/bucket cost multiplies per tenant |

## 5. Recommendation for the near term, with reversibility

**Recommended: posture A — one organization per install for the pilot — while keeping the
multi-organization-capable schema.** This matches the only concrete scope (one café group, two
locations), the requirements, and the built infrastructure, and it is the simplest correct
choice: no RLS, no resolver, no per-tenant Terraform until a real second tenant exists.

If the owner wants to keep posture B genuinely open at low cost, do only these two additive moves
before the auth slice hardens, and skip RLS:

1. **Bind sessions to an organization** — add a nullable-then-not-null `organization_id` to
   `auth_session` and carry it on `AuthSessionRecord` (`identity.ts:144-164`, `types.ts:31-35`).
   Additive, expand → migrate → contract, and it closes the one gap that is awkward to backfill
   later (existing sessions cannot be attributed to a tenant).
2. **Introduce a single application-layer organization seam** (one `resolveOrganization()` used by
   login/session) instead of accepting an arbitrary `organizationId` from callers
   (`authenticate.ts:16-21`). Today it can return the pinned single org; later it becomes the tenant
   resolver.

Do **not** add RLS, per-tenant connections or a tenant resolver now: there is no requirement for
them, and a wrong resolver/RLS design is harder to remove than to add (FND-002 is role+location only,
`11_REQUIREMENTS_CATALOG.md:23`).

**Reversibility path.** All recommended changes are additive and follow expand → migrate → contract
(`AGENTS.md` Rule 2, `02_ARCHITECTURE.md:100`). Moving to posture B later requires tenant resolution,
session org binding and a central org filter — **no schema rewrite**, because `organization_id` and
per-org unique indexes already exist. Moving to posture C later is the expensive path: it requires a
new Terraform boundary (project/database/app/bucket or schema-per-tenant) plus per-tenant migration and
backup jobs, so it should be chosen only against a stated isolation or regulatory need.

**Decision trigger to revisit:** the first real second café group, or a contract/regulator demanding
physical separation. Until then posture A is sufficient and cheapest.

## 6. Questions the owner must answer before shared multi-tenant (B) can be adopted

1. Will more than one café group / legal entity ever share one deployment, and if so who is the
   controller/processor for each tenant's data (GDPR roles; DEC-014 EU/EEA hosting)?
2. How is a tenant resolved at login — subdomain, custom domain, path prefix, email domain, or an
   explicit organization selector?
3. Is application-level organization filtering sufficient, or is database-enforced isolation
   (RLS) or physical separation (schema/DB per tenant) contractually required?
4. May one person's identifier (email/username) belong to more than one organization? If yes, login
   must select a tenant and the single `app_user` row per person assumption changes.
5. Must one tenant be restorable and erasable in isolation without affecting the others (per-tenant
   PITR, data-subject deletion, offboarding)? A shared cluster cannot do this today.
6. Is cost pooled across tenants or recharged per tenant, and does that require per-tenant resources?
7. Who runs migrations, monitoring and incident response across tenants, and what blast radius may
   one tenant's bad data cause?
8. Do external integrations (Frontline POS, Fiken, Wolt, Medusa/Sanity) need per-tenant credentials
   and tenant identifiers, and does that change integration ownership (ADR-0008)?
9. If multi-tenancy is adopted after go-live, can all existing rows be assigned to the first
   organization, and is any key currently global (notably `stock_movement.idempotency_key`,
   `inventory.ts:83`) unsafe to share?
10. What is the acceptable per-tenant migration and restore window, given the current single
    pre-deploy migration job and single-cluster PITR (`docs/runbooks/deployment.md:84-97,232-245`)?

## 7. Claims that could not be verified from the repository

- The owner's commercial intent to operate this as a SaaS for multiple café groups. The only signal
  is "SaaS-oriented" in `docs/adr/0012-deployment-topology-and-service-runtimes.md:12`; the product
  scope describes a single café group (`01_PRODUCT_SCOPE.md:5`).
- Any DigitalOcean cost figures for a per-tenant or shared deployment; component sizing is an open
  cost follow-up (`docs/adr/0012-deployment-topology-and-service-runtimes.md:138,165`).
- Whether a real organization seed/bootstrap will exist outside tests; none is committed
  (test-only inserts, e.g. `packages/application/src/auth/auth.postgres.test.ts:61`).
- Any customer/contract requirement for physical tenant separation or RLS; none appears in
  `11_REQUIREMENTS_CATALOG.md` or `07_SECURITY_AND_NFR.md`.
