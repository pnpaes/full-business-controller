# AGENTS.md — working instructions for this repository

This repo is a **documentation-first modular monolith** for Aquarela's business
control system (products/SKUs, costs, inventory, sales, reconciliation and
reporting). Phase 0 is complete: the specification package (`00_README.md` …
`13_AGENT_BUILD_BRIEF.md`), the 65 accepted decisions (`12_OPEN_DECISIONS.md`)
and the Phase 0 artifacts/ADRs (`docs/phase0/`, `docs/adr/`) are the authority.
The foundation scaffold and the Phase 1–2 persistence core are built (the latter
uncommitted); no business slices yet. The living project context lives in
`CONTEXT.md`, and the next task is always in its
`## Resume here (next session)` section.

## Rule 1 — Session handoff and work log (mandatory)

- **Start:** read `CONTEXT.md` before doing anything else, beginning with its
  `## Resume here (next session)` section.
- `CONTEXT.md` must open with a **`## Resume here (next session)`** section as the
  first section after the intro. It is the single entry point for continuing work.
- That section must be **self-contained and executable without questions**: the
  next task and objective; explicit **scope (do)** and **scope (do not)**; the
  files/paths to create or edit; the authoritative docs to read first; acceptance
  criteria and the exact verification commands; any open decisions/inputs that
  block or shape it; and a one-line pointer to the step after it.
- **End:** if the session changed anything (code, docs, decisions, data), update
  `CONTEXT.md` before finishing: current status + git HEAD, what changed since
  the last update, in-progress items, prioritised next steps, open
  decisions/inputs, and how to verify.
- At the end of **every** task — even small or docs-only ones — rewrite the
  `Resume here` section for the new next step. If there is no next step or it is
  blocked, say so explicitly and name the blocker.
- Recognise the resume trigger: when the user says **"resume the work"** (or
  simply "resume"), read the `Resume here` section and continue from it without
  re-asking for context.
- Keep the chronological **work log** appended (newest first) and keep
  **Current status** (including git HEAD), **Next up**, **Open decisions /
  inputs** and **Reversibility** accurate in the same pass.
- Session handoffs and context live **in the repo** (`CONTEXT.md`) only. Never
  write handoff files to a temp directory or any path outside the repository.

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
- Record the rollback approach in the commit body and in `CONTEXT.md`.

## Rule 3 — Decisions are the authority

- The accepted decisions in `12_OPEN_DECISIONS.md` govern. New decisions are
  **appended there** (next free id is stated in `CONTEXT.md`; `DEC-149` as of
  2026-09-27) — never invented silently.
- Calculations follow `docs/phase0/CALCULATION_CONTRACT.md`: decimal only (never
  floats), HALF_UP, boundaries B0–B4, and the cost-source precedence.

## Rule 4 — Supervise delegated agents (do not wait blindly)

Background subagents stall, silently no-op, or hit step caps. A completion
notification is not the only signal to act on; **monitor progress**:

- After launching a background task, check its **file-write progress** at a
  bounded interval (a cheap read-only `git status --short` / targeted `grep`).
  A task that has made **no file change after a few minutes** on a task expected
  to write is stalled — do not keep waiting.
- **Intervene on stall or error:** redirect the same task (`task_id` resume) if
  it is merely lost, or **supersede it** and take the change over directly (or
  relaunch a tighter task with the reconnaissance already inlined). Prefer
  finishing the work over re-launching a fresh reconnaissance cycle.
- **Coordinate, do not collide:** if you take over files a live task may still
  write, post a board `INFO` naming the task and the exact files, state the
  expected end state, and reconcile after it reports (verify no stale variant
  was left behind).
- Recognise the two recurring failure modes seen here: a task that burns its
  whole budget on reconnaissance and writes nothing, and a task that stalls with
  zero edits. Both are intervention triggers.
- After a wave, always re-read the actual tree state (not the agents' summaries)
  before verifying, committing and pushing.

## Conventions

- Node 22 via nvm (not on PATH); Docker available.
- Run `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build` before
  finishing.
- `docs/`, `schemas/`, `samples/` and the numbered markdown are inputs — update
  them deliberately, don't rewrite them.
- Never commit secrets. Commit only when asked.
