# BUILD_ROADMAP — ordered execution tracker

## 1. Purpose and authority

This file is a **derived execution tracker**: the single ordered view of the slices that
continue the build, across sessions. It is **not** the authority. `12_OPEN_DECISIONS.md`
and the accepted ADRs in `docs/adr/` govern (per `AGENTS.md` Rule 3); the specification
files (`00_README.md` … `13_AGENT_BUILD_BRIEF.md`) and `docs/phase0/` artifacts are the
requirements and data inputs. Where this roadmap and a decision, ADR or Phase 0 artifact
disagree, the decision/ADR/artifact wins and this file is corrected.

This file is **updated at the end of every slice** — statuses and the "current position"
line move with the work; `CONTEXT.md` keeps the narrative handoff and the immediate
`Resume here` section.

**Current position:** slice 0 `done`; slices 1a, 1b-i (committed `9fc8ba0`) and 1b-ii
(uncommitted) `done`; slice 1b-iii (password reset + access control) is the immediate next
step per `CONTEXT.md`.

## 2. The execution loop (per slice)

1. **Select** the next ready slice from §4 and cite its primary requirement IDs,
   decision IDs and ADR dependencies. If a cited ADR is still `Proposed`, stop at §3.
2. **Pre-flight**: read the authoritative docs named by the slice (see §4 refs) and run
   `npm run typecheck` before changing code.
3. **Design note** (short, in the session or commit body): commands/queries, authorization,
   states and error paths, migration/rollback.
4. **Implement** within the existing package boundaries — `packages/domain`,
   `packages/application`, `packages/persistence`, `apps/web` — with a `.test.ts` for new
   non-trivial logic (happy path + edge case), per `AGENTS.md` and the global test policy.
5. **Verify**: `npm run lint && npm run typecheck && npm run test && npm run build &&
   npm run format:check`, plus the slice-specific evidence (migration apply, fixture,
   reconciliation, drill-down).
6. **Adversarial review**, risk-scaled. Roster (global orchestrator instructions; pick the
   cheapest sufficient option first, never more than three concurrently): `reviewer-qwen`
   (`opencode-go/qwen3.7-plus`, default outside opinion), `reviewer-glm`
   (`opencode-go/glm-5.3-flash`, cheap code-level correctness), `reviewer-minimax`
   (`opencode-go/minimax-m3`, structural risk: schema/migration/rollback), `reviewer-ling`
   (`kilo/inclusionai/ling-3.0-flash-vl:free`, breadth only, rate-limited), `reviewer-kimi`
   (`opencode-go/kimi-k3`, expensive — only for cross-document or irreversible decisions).
   Trivial/mechanical change: 0 reviewers. Normal slice: 1 outside reviewer. Security,
   migration, schema or otherwise structural slice: 2 (e.g. `reviewer-qwen` +
   `reviewer-minimax`). Each reviewer states its model first, stays read-only, cites
   `file:line` or query evidence, and ranks findings blocker/major/minor.
7. **Reconcile** findings: record accepted fixes and declined items with the reason, so a
   later session can see why.
8. **Commit atomically** with the verification evidence and the rollback approach in the
   body (per `AGENTS.md` Rule 2). Never rewrite history or force-push.
9. **Rewrite** `CONTEXT.md`'s `Resume here`, status (including git HEAD), work log and open
   items before finishing.

## 3. Stop conditions / gates

Pause the loop and raise to the owner, recording it in `CONTEXT.md`, when any of these is hit:

- **Proposed ADR required by the slice.** The slice cites an ADR whose status is `Proposed`
  (e.g. `0003`, `0004`, `0005`, `0007`–`0011`). *Needed from owner:* the named decider
  accepts or amends it in `docs/adr/` (`Accepted` with date) before the slice is treated as
  settled. Slice 1 is the owner-directed exception: proceed and accept `ADR-0003` in
  parallel, without treating it as settled (`CONTEXT.md`).
- **Golden fixtures needed before a calculation is "verified".** *Needed from owner:*
  finance + product owner sign the six fixtures in `docs/phase0/GOLDEN_FIXTURES.md`
  (real supplier/recipe/labour data; I4/I5/I8 and the I9 accountant ruling). Until then the
  calculation is `illustrative` and must not be used for real decisions.
- **External source data or integration shapes missing.** I4 (costs), I5 (recipes/yields),
  I7 (opening counts), I8 remainder (productive hours, insurance, role→location) and the
  Frontline data-shape confirmations (item-level sales lines, channel/applied tax, SKU,
  on-sale representation). *Needed from owner:* the labelled source files requested in
  `docs/phase0/SOURCE_DATA_REQUEST.md` / `docs/phase0/UNBLOCK_CHECKLIST.md`. This gates
  validation and go-live, not the start of development (owner clarification, 2026-09-18).
- **External write or otherwise irreversible action.** *Needed from owner:* the per-source
  approval in `DEC-015`, a named credentials owner, and a documented, tested rollback
  (`AGENTS.md` Rule 2). Never perform it without both.
- **A decision would have to be invented.** *Needed from owner:* append the decision to
  `12_OPEN_DECISIONS.md` (next id `DEC-050`) — never resolve accounting, tax, valuation,
  privacy or system-of-record ambiguity in code (`13_AGENT_BUILD_BRIEF.md`).
- **Slice budget reached.** The session has completed its agreed slice budget. *Needed from
  owner:* confirm the next slice (or that work pauses); hand off via `CONTEXT.md`.

## 4. Ordered slice backlog

Phase and epic references are `10_DELIVERY_PLAN.md` §10.2 (phases) and §10.4 (epic
sequence). Requirement IDs are from `11_REQUIREMENTS_CATALOG.md`; decision IDs from
`12_OPEN_DECISIONS.md`; ADR filenames from `docs/adr/`. Status values are defined in §6.

| # | Slice | Phase / epic | Primary refs | Depends on | Owner gate | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | Foundation, persistence core, deployment foundation | P0 / pre-epic | `ADR-0001`, `ADR-0002`, `ADR-0012`; `13` implementation steps 1–3 | — | none | done |
| 1a | Auth domain primitives (Argon2id, TOTP, recovery codes, tokens, lockout) | P1 / epic 1 | `FND-002`, `SEC-001`, `SEC-003`; `DEC-013`; `ADR-0003` (accepted) | 0 | none | done |
| 1b-i | Auth persistence layer (Drizzle client, repositories, TOTP counter migration) | P1 / epic 1 | `FND-002`, `FND-005`; `DEC-013`; `ADR-0003` (accepted) | 1a | none | done |
| 1b-ii | Auth application flow (authenticate, MFA, sessions, audit port/adapter) | P1 / epic 1 | `FND-002`, `FND-005`, `SEC-001`, `SEC-003`; `DEC-013`; `ADR-0003` (accepted) | 1b-i | none | done |
| 1b-iii | Password reset + access control (roles/location scope, admin operations) | P1 / epic 1 | `SEC-001`, `SEC-003`; `DEC-013`; `ADR-0003` (accepted) | 1b-ii | none | todo |
| 1c | Auth HTTP surface (`/api/v1/auth`, session cookies, minimal login/2FA UI) | P1 / epic 1 | `SEC-001`, `SEC-003`; `DEC-013`; `ADR-0003` (accepted) | 1b-iii | none | todo |
| 2 | Units & catalog value objects (decimal money/quantity) | P1 / epic 2 | `FND-003`, `PROC-001`; `DEC-030` | 1 | none | todo |
| 3 | Item + supplier pack + conversion + price | P1 / epic 2 | `PROC-001`–`005`, `PROC-008`, `COST-010`, `FND-008`, `FND-009`; `DEC-021`, `DEC-030`, `DEC-041`, `DEC-044`, `DEC-046` | 2 | none — I4/I6 data gates real values | todo |
| 4 | Receipt + price history + landed cost | P1 / epic 3 | `PROC-002`–`005`, `PROC-008`, `COST-010`, `COST-012`; `DEC-047`; `CALCULATION_CONTRACT.md` §5 | 3 | none — I4 data gates real values | todo |
| 5 | Recipes / sub-recipes / version / yield / allergens | P1 / epic 4 | `COST-001`, `COST-002`, `PROD-005`; `DEC-005`, `DEC-030`, `DEC-036`; `CALCULATION_CONTRACT.md` §6 | 3 | none — I5 data gates real recipes | todo |
| 6 | Operating costs + labour + allocation | P1 / epic 5 | `COST-004`, `COST-006`, `COST-007`, `COST-011`, `COST-013`; `DEC-006`, `DEC-007`, `DEC-048`; `CALCULATION_CONTRACT.md` §7, §9 | 3 | none — I8 remainder + I9 ruling confirm loaded rates | todo |
| 7 | Cost card + snapshots + price scenario + approval | P1 / epic 6 | `COST-005`, `COST-008`, `COST-009`, `PRICE-001`–`005`; `DEC-021`–`024`; `CALCULATION_CONTRACT.md`; `GOLDEN_FIXTURES.md` | 4, 5, 6 | six golden fixtures signed (A5) before "verified" | todo |
| 8 | Stock ledger + balances + lots / storage | P1–P2 / epic 7 | `INV-001`–`003`, `INV-008`, `PROD-002`, `WASTE-002`, `COST-008`; `DEC-008`, `DEC-009`, `DEC-010`, `DEC-028`, `DEC-034`; `ADR-0005` (**Proposed**) | 3, 4 | `ADR-0005` acceptance (finance) | blocked (owner) |
| 9 | Counts + transfers + waste | P2 / epic 8 | `INV-004`–`007`, `INV-009`, `WASTE-001`, `WASTE-002`; `DEC-017`, `DEC-018`, `DEC-029` | 8 | none — I7 opening counts gate the pilot | todo |
| 10 | Production planning + batches | P2 / epic 9 | `PROD-001`–`005`; `DEC-005`, `DEC-031`, `DEC-036` | 5, 8 | none | todo |
| 11 | Import framework + external mappings | P3 / epic 10 | `SALE-002`, `SALE-004`, `SALE-007`, `SALE-008`; `DEC-025`, `DEC-033`, `DEC-035`, `DEC-041`; `ADR-0008` (**Proposed**) | 3 | none — legacy I19 as reference; I1/I15 Frontline shapes gate real profiles | todo |
| 12 | Sales + settlements + reconciliation | P3 / epic 11 | `SALE-001`–`011`, `PRICE-006`, `REC-001`–`006`; `DEC-026`, `DEC-035`, `DEC-040`, `DEC-042`, `DEC-043`, `DEC-045`; `ADR-0008` (**Proposed**) | 8, 11 | `ADR-0008` acceptance (owner + tech); I1 channel/SKU confirmations | blocked (owner) |
| 13 | Close + dashboards + menu engineering | P3 / epic 12 | `REC-003`, `REC-006`, `RPT-001`–`005`; `DEC-027`, `DEC-032`; `ADR-0007` (**Proposed**) | 12 | `ADR-0007` acceptance (tech); history/grain quality | blocked (owner) |
| 14 | Workforce: employees, shifts, worked hours, payroll-input report | P3 / epics 13–15 | `WF-001`–`006`; `DEC-012`, `DEC-037`, `DEC-038` | 1 | privacy review / access matrix approved (`SEC-003`) | blocked (owner) |
| 15 | Forecasts / budgets / planning | P4 / epic 16 | `FCST-001`–`003`, `PLAN-001`–`003`; `DEC-011`, `DEC-019` | 12, 13 | clean history / grain measured (I11, `DEC-011`) | blocked (data) |
| 16 | Publishing integrations | P3 / epic 17 | `INTG-001`–`003`; `DEC-002`, `DEC-015`, `DEC-041`, `DEC-044`; `ADR-0011` (**Proposed**), `ADR-0008` | 3, 7, 12 | `ADR-0011` acceptance; per-source approval + named credentials owner (I18) | blocked (owner) |
| 17 | AI-assisted advisory | P4 / epic 18 | `FCST-004`; `DEC-039`; `ADR-0009` (**Proposed**), `ADR-0004` (**Proposed**), `ADR-0007` | 13, 15 | `ADR-0009` acceptance; provider privacy/DPA review (I16) | blocked (owner) |
| 18 | Automated connectors / optimization | P5 / epic 19 | `COMP-001`–`004`, `PLAN-003`; `DEC-020`; `ADR-0010` (**Proposed**) | 15, 16, 17 | `ADR-0010` acceptance; approved competitor sources (I17); measured history/accuracy | blocked (owner) |

Convention: `blocked (owner)` means an owner/tech acceptance or approval named in the gate
is required before the slice can be implemented or relied on; `blocked (data)` means a
measured input (history/grain quality) is required. Data gates noted as "none — …" do not
block the build (owner clarification 2026-09-18: they gate validation and go-live); the
slice proceeds against `CALCULATION_CONTRACT.md` with synthetic fixtures until real data
arrives.

## 5. Owner-input register

Outstanding owner decisions/inputs that gate slices (no new decisions invented here; no
dates assigned):

- **`ADR-0003` accepted (2026-09-19)** — `docs/adr/0003-identity-and-role-model.md`;
  slices 1a–1c are unblocked. Its open items (final access matrix / shared-device login,
  Argon2id parameters against the ~250 ms target, admin-assisted password reset) are still
  open and tracked here.
- **`ADR-0004` acceptance + Graphile Worker vs pg-boss** — `docs/adr/0004-jobs-and-outbox.md`
  (`Proposed`); gates the job/outbox runtime used by imports, summaries, forecasts,
  publishing and AI.
- **`ADR-0005`, `ADR-0007`–`0011` acceptance** — the remaining `Proposed` ADRs; they gate
  slices 8, 12, 13, 16, 17, 18.
- **Multi-tenancy posture** (shared-schema vs schema/DB-per-tenant) — owner decision
  recorded in `CONTEXT.md` "Open decisions / inputs".
- **Component cost estimate** — `docs/phase0/PHASE0_CLOSEOUT_PLAN.md` §9 (P0-008);
  needed for the Phase 1–3 estimate reassessment after `DEC-037`/`DEC-039`/`DEC-015`.
- **Staging data-sanitization owner** — `CONTEXT.md` "Open decisions / inputs";
  `docs/runbooks/deployment.md`.
- **Real DO credentials + provisioned Spaces state bucket + single-runner apply** —
  `docs/runbooks/deployment.md` ("Database privilege bootstrap", state-bucket bootstrap).
- **Golden-fixture signatures (six)** — `docs/phase0/GOLDEN_FIXTURES.md` §5; finance +
  product owner, based on I4/I5/I8 and the I9 ruling.
- **Source files I4, I5, I7, I8** — `docs/phase0/SOURCE_DATA_REQUEST.md` and
  `docs/phase0/UNBLOCK_CHECKLIST.md` (the three genuine Phase 1 blockers are I4, I5, I8).
- **Frontline data-shape confirmations (I1/I15)** — item-level sales lines, channel/applied
  tax per line, SKU, on-sale representation; `docs/phase0/POS_WOLT_NOTES.md`,
  `SOURCE_DATA_REQUEST.md`; `DEC-041`/`DEC-042`/`DEC-043`.
- **Accountant ruling (I9)** — VAT/recoverability defaults and the staff-meal /
  own-consumption caveat in `CALCULATION_CONTRACT.md` §15; `ACCOUNTANT_QUESTIONS.md`.
- **Fiken kontoplan/VAT codes/posting structure + API token (I10)** —
  `docs/phase0/ACCOUNTING_FIKEN_NOTES.md`.
- **LLM provider DPA/privacy review (I16)** — before slice 17 (`DEC-039`, `ADR-0009`).
- **Per-source write approvals + named credentials owners (I18)** — before slice 16
  (`DEC-015`, `ADR-0011`).
- **Approved competitor sources (I17)** — before slice 18 (`DEC-020`, `ADR-0010`).

## 6. Status legend

- `todo` — not started; ready unless a gate says otherwise.
- `in progress` — being worked in the current or most recent session.
- `done` — implemented and verified per `10_DELIVERY_PLAN.md` §10.7 and committed.
- `blocked (owner)` — an owner/tech acceptance or approval named in the gate is required.
- `blocked (data)` — a measured input (history/grain quality) is required.
