# 13. Build Brief for a Coding Agent

## Mission

Implement the Aquarela Business Control System from this documentation as a secure, testable modular monolith. Do not begin broad production implementation until Phase 0 decisions, golden calculation fixtures and representative imports are available.

## Source priority

1. Accepted entries in `12_OPEN_DECISIONS.md` and approved ADRs.
2. Requirement IDs in `11_REQUIREMENTS_CATALOG.md`.
3. Domain/calculation/workflow rules in files 03–06.
4. Architecture/security/testing rules in files 02, 07 and 09.
5. UI direction in file 08.

If documents conflict, stop and raise a decision request. Do not resolve accounting, tax, valuation, privacy or system-of-record ambiguity through code assumptions.

## Required first response from the agent

Before writing application code, produce:

1. a concise understanding of product boundaries;
2. a list of unresolved blocking decisions and missing source samples;
3. proposed ADRs and exact technology choices with rationale;
4. initial repository/module structure;
5. database migration and test approach;
6. requirement-to-epic implementation sequence;
7. risk/estimate ranges and assumptions;
8. Phase 0 deliverables and validation plan.

Wait for approval of material choices before scaffolding the production repository.

## Default technical direction

- TypeScript strict mode.
- Responsive Next.js application with framework-independent domain/application services.
- PostgreSQL with decimal numeric types, constraints and migrations.
- Durable background jobs plus transactional outbox.
- Private object storage for source files and evidence.
- Internal authentication (users, credentials, sessions in the app database) with TOTP 2FA and server-side authorization. No external identity provider (DEC-013).
- Containerized local/staging/production setup.
- REST JSON `/api/v1` contract; generated OpenAPI documentation once implementation begins.
- Automated lint, type, unit, integration, end-to-end, security and migration checks.

Alternative technology is allowed only through an ADR showing operational benefit and equivalent fulfillment of requirements.

## Repository shape

```text
apps/
  web/                 # UI and HTTP adapters
  worker/              # background job runtime if separately deployed
packages/
  domain/              # value objects, entities, policies and calculations
  application/         # commands, queries, authorization and transactions
  persistence/         # schema, migrations and repositories
  integrations/        # source-specific adapters and import profiles
  ui/                  # design tokens and reusable accessible components
  contracts/           # API/event schemas and error codes
docs/
  adr/
  runbooks/
tests/
  fixtures/
  contract/
  e2e/
```

A single application repository without separate packages is acceptable if dependency boundaries are enforced and testable.

## Implementation order

1. Establish CI, environments, migrations, structured logs, configuration and test harness.
2. Implement identity/organization/location scopes and audit first.
3. Implement units and decimal money/quantity value objects with exhaustive tests.
4. Implement catalog, suppliers, supplier packs and landed cost.
5. Implement recipe version graph, yield and golden fixture calculations.
6. Implement operating costs, allocation policy, cost snapshots and pricing.
7. Implement append-only inventory movement ledger and as-of balances.
8. Add receipt/count/transfer/waste/batch workflows as atomic postings.
9. Implement generic staged import framework, then POS/Wolt profiles.
10. Implement sales, theoretical-consumption policy, settlements and close.
11. Build reporting read models and drill-down after canonical facts reconcile.
12. Add baseline forecasts/planning, then approved automation.

## Non-negotiable engineering constraints

- Never use floating-point numbers for money or controlled quantities.
- Never update/delete posted stock or closed financial history.
- Never derive historical reports from only current recipe, price or allocation data.
- Never accept an import/posting without idempotency and provenance.
- Never rely on UI hiding for access control.
- Never call external services inside a transaction that locks business records.
- Never discard invalid import rows or hide reconciliation differences.
- Never introduce automated competitor collection from an unapproved source.
- Never log secrets, full sensitive records or employee personal data.
- Never use MD5/SHA for password hashing (Argon2id, fallback bcrypt).
- Never store or log secrets or signing keys outside the environment/secret manager.
- Always revoke sessions server-side on logout and on role change/off-boarding.
- Always return generic login errors ("Invalid email or password").

## Vertical-slice workflow

For each slice:

1. cite requirement IDs and decision/ADR dependencies;
2. define command/query, authorization, states and errors;
3. add migration/constraints and repository behavior;
4. implement domain logic and atomic transaction;
5. add audit/outbox/telemetry;
6. expose API and minimal accessible UI;
7. add unit/integration/E2E tests and fixture evidence;
8. update API/docs/runbook;
9. demonstrate the acceptance scenario with representative data.

## Questions the agent must raise

Raise a blocking question when:

- a calculation lacks tax, unit, rounding, cost selection or allocation policy;
- two source systems claim ownership of the same field;
- a workflow would change posted/locked history;
- external IDs or source totals cannot uniquely reconcile;
- personal information appears unnecessary for an outcome;
- an integration requires writes, new credentials or terms-sensitive automation;
- actual source data violates an invariant or controlled vocabulary;
- scope expansion changes phase commitments.

## Completion report per phase

Report completed requirement IDs, accepted decisions/ADRs, schema/API changes, migrations, test/reconciliation evidence, unresolved defects, security/operational findings, data-quality results, runbook readiness and go/no-go recommendation.

