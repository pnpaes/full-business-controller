# ADR-0001 — Application framework and deployment platform

- **Status:** Accepted (2026-09-18)
- Accepted on 2026-09-18 by the technical owner (Paulo Paes).
- **Date:** 2026-09-13
- **Deciders:** Technical owner (Paulo Paes)
- **Related:** DEC-014 (hosting/RPO/RTO/owners), DEC-013
- **Requirements:** FND-001, OPS-003, SEC-002, UX-001; NFR §7.6–7.7

## Context

The package recommends a responsive TypeScript modular monolith (`02:1-16`, `13:32-43`) but pins no
framework or host. Auth and persistence scaffolding must wait until hosting and build/runtime shape
are known (assessment §7). Constraints: two Oslo locations, small team, EU/EEA data residency for
personal data, managed backups with RPO ≤ 1 h / RTO ≤ 4 h (`07:55-62`), and a phone/tablet workflow.

## Decision

Use **Next.js (App Router) with TypeScript strict** as the application framework, with
framework-independent domain/application packages (`13:48-68`). Application runtimes are deployed as
**separate DigitalOcean App Platform components** (web, api, worker, scheduled jobs) per
`docs/adr/0012-deployment-topology-and-service-runtimes.md` — this **supersedes the earlier
"single deployable web application" wording** in this ADR; the repository remains a **modular
monolith** (one repo, bounded-context packages), so this is independent runtimes, not microservices.
Deployment target is **DigitalOcean in the Amsterdam (AMS3) EU/EEA region** — the accepted hosting
platform under **DEC-014 (2026-09-14)**. The primary database is **DigitalOcean Managed PostgreSQL
with point-in-time recovery (PITR)**, giving EU/EEA data residency in Amsterdam, and private file
storage is **DigitalOcean Spaces (AMS3, S3-compatible)** (see ADR-0006). Fly.io Postgres is
**rejected** because it does not provide managed PITR.

## Alternatives considered

- Remix/React Router — smaller runtime, but less mature server-action/streaming ecosystem.
- Separate SPA + API service — more deployables for a small team; defer until scale/ownership demands.
- Neon (EU) — serverless managed Postgres with branching, but not the accepted platform; superseded by
  DigitalOcean Managed PostgreSQL per DEC-014.
- AWS RDS Postgres `eu-north-1` — managed Postgres with PITR, but a separate hosting platform from the
  file-storage/provider choice; superseded by DigitalOcean per DEC-014.
- Supabase — managed Postgres plus ancillary services, but more platform surface than the MVP needs;
  superseded by DigitalOcean per DEC-014.
- Fly.io Postgres — rejected: does not provide managed PITR.
- Serverless (Vercel + managed Postgres) — simplest DX, but region/PITR and long-running worker fit is
  weaker; revisit if ops capacity is the binding constraint.

## Consequences

- Web/API and worker runtimes run as **separate App Platform components** decided
  2026-09-18 (see `docs/adr/0012-deployment-topology-and-service-runtimes.md`); the split of `api`
  out of `web` is a deliberate, reversible step described there.
- Business logic must not leak into route handlers/UI (`02:16`, `13:91`).
- Hosting choice fixes data residency, backup and secret-store mechanisms — now **decided by
  DEC-014 (2026-09-14): DigitalOcean AMS3**, with the named owners still pending. Pin exact versions
  at scaffolding time.
- The managed-Postgres provider is **decided**: DigitalOcean Managed PostgreSQL with PITR (DEC-014);
  backup/restore must still be tested (`09:78`).

## Open items

- Confirm budget and the named product/technical/operational-data owners (I13, DEC-014); region is
  decided as DigitalOcean AMS3.
- ~~Confirm whether workers run as separate containers/size or shared process.~~ Resolved
  2026-09-18: `worker` (and scheduled jobs) run as their own App Platform components —
  `docs/adr/0012-deployment-topology-and-service-runtimes.md`.
