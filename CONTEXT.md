# Project context

Canonical orientation for this repository: read this first when resuming work,
and update it at the end of any session that changes anything (code, docs,
decisions, data) — per `AGENTS.md` Rule 1. Reference artifacts by path; don't
duplicate their content.

## What this is

**Aquarela Business Control** — a secure, testable modular monolith for an Oslo
café with two locations, covering costing, pricing, inventory, production,
sales/imports, workforce and reporting. It is **documentation-first**: Phase 0 is
complete (specification, 48 accepted decisions, artifacts and ADRs) and only the
foundation scaffold is built. No business slices or database schema yet.

## Where things live

- `00_README.md` … `13_AGENT_BUILD_BRIEF.md` — the specification package
  (inputs, rarely edited). Start with `00_README.md`.
- `12_OPEN_DECISIONS.md` — the 48 accepted decisions (DEC-001…DEC-048); the
  authority. New decisions are appended here.
- `docs/phase0/` — close-out plan, calculation contract, data dictionary, golden
  fixtures, source-data request, notes. See `docs/phase0/PHASE0_CLOSEOUT_PLAN.md`
  and `docs/phase0/CALCULATION_CONTRACT.md`.
- `docs/adr/` — architecture decision records `0001`–`0011`.
- `schemas/` — draft DDL and domain enums (`schemas/phase1_2_draft.sql`,
  `schemas/domain-enums.yaml`).
- `samples/` — real POS exports, screenshots and templates (reference data).
- `packages/*` and `apps/web` — code (config, logger, domain, application,
  persistence; Next.js app).
- `AGENTS.md` — the rules (handoff/work log, reversibility, decisions).
- `CONTEXT.md` — this file.

## Current status

- **As of:** 2026-09-18 — branch `main`, tree clean.
- **Commits:** `536d63e` (Phase 0 package) → `bb464d6` (foundation scaffold) →
  `e55ea23` (handoff and reversibility rules).
- **Phase 0:** complete — all 48 decisions accepted (`12_OPEN_DECISIONS.md`).
- **Scaffold verified:** lint, typecheck, 11 tests and build pass;
  `npm audit --omit=dev` reports 0; Docker image built and run, `/api/health` →
  `{"status":"ok"}`.
- **Not yet built:** business slices and database schema.

## Next up (prioritised)

1. **Persistence slice** — Drizzle schema + first migrations from
   `docs/phase0/DATA_DICTIONARY.md` and `schemas/phase1_2_draft.sql`, per
   `docs/adr/0002-orm-and-migrations.md`.
2. **Auth slice** — `DEC-013` / `docs/adr/0003-identity-and-role-model.md`:
   Argon2id, TOTP 2FA, server-side sessions.
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
- The six golden fixtures must be **signed** before Phase 1 costing is treated as
  verified.

## How to verify / environment

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22
npm run lint && npm run typecheck && npm run test && npm run build
docker build -t aquarela-web .        # Docker at /usr/local/bin/docker
docker compose up -d postgres         # local PostgreSQL 16 on localhost:5432
```

## Reversibility

- Revert any commit with `git revert <sha>`; no destructive git operations.
- Migrations must be reversible or follow expand → migrate → contract, with a
  tested rollback/down path (see `AGENTS.md` Rule 2).
- External writes require a documented rollback and per-source approval
  (`DEC-015`).

## Work log (append-only, newest first)

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
changed, how it was verified, and what comes next. Update **Current status**
(including git HEAD) and **Next up** in the same pass, and note any new open
decisions or inputs. Handoffs and context live in this repo only — never write
them to a temp directory or any path outside the repository.
