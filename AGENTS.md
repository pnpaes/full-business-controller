# AGENTS.md — working instructions for this repository

This repo is a **documentation-first modular monolith** for Aquarela's business
control system (products/SKUs, costs, inventory, sales, reconciliation and
reporting). Phase 0 is complete: the specification package (`00_README.md` …
`13_AGENT_BUILD_BRIEF.md`), the 48 accepted decisions (`12_OPEN_DECISIONS.md`)
and the Phase 0 artifacts/ADRs (`docs/phase0/`, `docs/adr/`) are the authority.
Only the foundation scaffold is built — no business slices or schema yet. Start
with `README.md`; the living handoff lives in `docs/HANDOFF.md`.

## Rule 1 — Session handoff and work log (mandatory)

- **Start:** read `docs/HANDOFF.md` before doing anything else.
- **End:** if the session changed anything (code, docs, decisions, data), update
  `docs/HANDOFF.md` before finishing: current status + git HEAD, what changed
  since the last update, in-progress items, prioritised next steps, open
  decisions/inputs, and how to verify.
- Append to the chronological work log and keep the **Next up** section accurate.
  This is how work continues across sessions.

## Rule 2 — Make every task reversible (mandatory)

Changes must be revertible or carry a documented recovery path:

- Prefer small, atomic commits; each commit independently revertible.
- Never rewrite history, force-push, or run destructive git commands unless the
  user explicitly asks.
- Migrations must be reversible or follow **expand → migrate → contract**; never
  drop data in the same release that stops using it; include a tested
  rollback/down path and document it.
- External writes (POS/accounting/etc.) require a documented rollback and
  per-source approval (`DEC-015`); never perform an irreversible external action
  without one.
- Prefer soft-delete/versioning over destructive deletes; financial/stock facts
  are append-only (reversals, not edits).
- For risky changes use a feature flag or keep the old path until the new one is
  verified.
- Record the rollback approach in the commit body and in `docs/HANDOFF.md`.

## Rule 3 — Decisions are the authority

- The 48 accepted decisions in `12_OPEN_DECISIONS.md` govern. New decisions are
  **appended there** (next id `DEC-049`) — never invented silently.
- Calculations follow `docs/phase0/CALCULATION_CONTRACT.md`: decimal only (never
  floats), HALF_UP, boundaries B0–B4, and the cost-source precedence.

## Conventions

- Node 22 via nvm (not on PATH); Docker available.
- Run `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build` before
  finishing.
- `docs/`, `schemas/`, `samples/` and the numbered markdown are inputs — update
  them deliberately, don't rewrite them.
- Never commit secrets. Commit only when asked.
