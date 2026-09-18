# ADR-0002 — ORM/query layer and migration strategy

- **Status:** Proposed (needs tech-lead acceptance)
- This ADR is a proposal; implementation must not rely on it until status is `Accepted`.
- **Date:** 2026-09-13
- **Deciders:** TECH
- **Related:** DEC-008, DEC-024; `02:10,68`, `03:90`
- **Requirements:** FND-003, FND-004, COST-008, INV-002, OPS-002

## Context

Persistence (implementation step 3, `13:73`) is blocked by the missing ORM/migration ADR
(assessment §2.2). The schema needs decimal/numeric precision, check constraints, **exclusion
constraints** for non-overlapping effective windows (`02:68`), partial indexes, and append-only
enforcement — not just CRUD mapping.

## Decision

Use **Drizzle ORM + drizzle-kit** for the typed query layer and migrations. Exclusion constraints,
partial indexes and custom triggers require raw SQL under any TypeScript ORM; the differentiator here
is Drizzle's typed query layer plus drizzle-kit's migration workflow. Migrations are **forward-only,
transactional, and rehearsed**, applied in **expand → migrate → contract** releases (`02:95`); every
migration is tested against production-like data and has a documented rollback/recovery path.

## Alternatives considered

- **Prisma** — best DX and tooling, but less control over advanced Postgres features; exclusion
  constraints, partial indexes and custom triggers require raw SQL under any TypeScript ORM.
- **Kysely** — excellent typed SQL builder, fewer migration/ergonomics; viable if Drizzle is rejected.
- **Raw `pg` + node-pg-migrate** — max control, more boilerplate and type-safety risk.

## Consequences

- The ledger, effective-dating and append-only rules are enforced in the database, not only in code
  (`02:68`, `03:90`, `09:31-33`).
- Teams must know SQL; migrations are reviewed like schema code.
- Pin the exact Drizzle/Postgres versions at scaffolding time.

## Open items

- Confirm Drizzle vs Prisma with the tech lead before scaffolding `packages/persistence`.
- Decide migration runner in CI/CD and the rollback rehearsal procedure (`09:79`).
