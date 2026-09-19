# ADR-0002 — ORM/query layer and migration strategy

- **Status:** Accepted (2026-09-18)
- Accepted on 2026-09-18 by the technical owner (Paulo Paes) following the Phase 0
  close-out clarification in `docs/phase0/PHASE0_CLOSEOUT_PLAN.md` ("Development blockers vs
  data gates"): no development blocker remains, so foundation and costing work proceed.
- **Date:** 2026-09-13
- **Deciders:** Technical owner (Paulo Paes)
- **Pinned versions:** `drizzle-orm@0.38.4`, `drizzle-kit@0.30.6`, PostgreSQL 16.
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

- ~~Confirm Drizzle vs Prisma with the tech lead before scaffolding `packages/persistence`.~~
  Resolved 2026-09-18: Drizzle confirmed and implemented in `packages/persistence` (see pins above).
- ~~Decide migration runner in CI/CD and the rollback rehearsal procedure (`09:79`).~~
  Resolved 2026-09-18: the runner is drizzle-kit `migrate`, invoked via `npm run db:migrate`;
  the rollback rehearsal procedure is documented in `docs/runbooks/persistence-migrations.md`.
- **Security — upgrade off the `0.38.4` pin (2026-09-19, DEC-049):** `drizzle-orm` is now a
  **runtime dependency** (the schema modules import it), so the pinned `0.38.4` surfaces
  **GHSA-gpj5-g38j-94v9 / CWE-89 (high) — SQL injection via improperly escaped SQL identifiers** in
  `npm audit --omit=dev`. Exploitability requires attacker-controlled input reaching
  identifier/alias builders (`sql.identifier()`, `.as()`); the current code builds queries from
  typed, code-controlled columns, so it is not reachable today. The pin must move to
  **`>=0.45.2`** — a breaking upgrade with a matching `drizzle-kit` bump — before the first feature
  that lets user input reach identifier/alias builders **and** before production. Regenerating and
  re-verifying the migrations is part of that upgrade. See DEC-049 in `12_OPEN_DECISIONS.md`.
