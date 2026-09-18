# Handoff and work log

## How to use this file

Read this first when resuming work. Update it at the end of every session that
changes anything (code, docs, decisions, data) — per `AGENTS.md` Rule 1. Keep the
**Current status** and **Next up** sections accurate, and append to the work log.
Reference artifacts by path; don't duplicate their content.

## Current status

- **As of:** 2026-09-18 — branch `main`, tree clean.
- **Commits:** `536d63e` (Phase 0 package — specification, decisions, contracts,
  schema) then `bb464d6` (TypeScript foundation scaffold).
- **Phase 0:** decisions complete — all 48 accepted (`12_OPEN_DECISIONS.md`).
- **Scaffold verified:** lint, typecheck, 11 tests and build pass;
  `npm audit --omit=dev` reports 0; Docker build + `/api/health` verified.
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

## How to verify

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22
npm run lint && npm run typecheck && npm run test && npm run build
docker build -t aquarela-web .
docker compose up -d postgres   # local PostgreSQL 16 on localhost:5432
```

## Reversibility notes

- Revert either commit with `git revert 536d63e` / `git revert bb464d6`; no
  destructive ops.
- Migrations must be reversible or expand → migrate → contract (see `AGENTS.md`
  Rule 2).
- External writes require a documented rollback and per-source approval
  (`DEC-015`).

## Work log (append-only, newest first)

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
decisions or inputs.
