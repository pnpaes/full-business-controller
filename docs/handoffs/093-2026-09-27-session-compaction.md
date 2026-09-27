# 093 — 2026-09-27 — Session compaction (jobs layer → row 17)

Compaction of the 2026-09-27 working session. This is a **navigation** record
only: it does not restate the per-slice handoffs (`084`–`092`), the decisions
(`12_OPEN_DECISIONS.md`) or `CONTEXT.md` — read those for detail.

## Where things stand

- Branch `main`, clean, pushed to `origin/main` (`git@github.com:pnpaes/full-business-controller.git`).
- HEAD at compaction: `7baacf3` (docs for row 17).
- Tests **5188/5188 (381 files)**; `db:migrate` no-op; migrations through `0075`;
  **101 public tables**; `typecheck`/`lint`/`format:check` clean; `next build` exit 0.
- Nothing applied to DigitalOcean; the deployment rehearsal stays parked (`DEC-148`).

## What this session delivered (newest first)

| Slice | Commit(s) | Handoff |
|---|---|---|
| AI advisory row 17 (`ADR-0009`, migration `0075`) | `398e698` + docs `7baacf3` | `092` |
| Password reset via SendGrid (`DEC-147`, provider corrected from Resend) | `0424d73` + docs `0761e38` | `091` |
| Receipt → stock ledger (`DEC-145`, migration `0074`) | `50b231e` + docs `f405ed4` | `090` |
| Owner decision round `DEC-141`–`DEC-148` (ADRs 0009/0010 Accepted, fixtures signed) | `5d8e285` | `12_OPEN_DECISIONS.md` |
| Jobs operator screen `/jobs` | `2796411` + docs `18c4cf3` | `089` |
| DLQ automation + DB worker heartbeat (migration `0073`) | `918b80a`, `d070983` + docs `bd8a886` | `088` |
| Retention index `0072`, `scheduledAt` fix | `94bd965`, `d3602d0` + docs `0aa54f3` | `087` |
| Jobs layer complete: `202` producer + retention + alerts | `ba27b79`, `054355f` (+ `ecbe35b`, `8572510`, `0da0593`, `67e932d`, `a84ce82`, `911ced6`) | `084`–`086` |

Also amended this session: `AGENTS.md` gains **Rule 4 — Supervise delegated
agents** (bounded progress checks; intervene on stall; coordinate, do not
collide), and its stale next-decision-id line is fixed.

## Immediate next work

1. **Row 18 — automated connectors (`ADR-0010` Accepted `DEC-143`).** Approved
   sources: public competitor websites under the `DEC-020` rules (per-source
   terms review, `robots.txt`/rate-limit respect) **plus the Wolt menu subject to
   its terms**; Instagram stays manual capture. Human review before any
   influence; provenance recorded; no personal data. Not yet reconnoitred.
2. **`WF-003` employee login — PAUSED pending the owner.** `DEC-146` decided
   employees log in (own shifts only), but three things were asked and not
   answered: account provisioning/invite path, the approval model
   (instant vs `pending_approval`), and the self-assign limit. Do not guess.
3. Remaining recorded gaps: system-wide `job` prune (org-scoped is enough for
   this single tenant — `DEC-140`); AI cost caps inert until a price table
   exists; prompt-change control; provider DPA/privacy review (`I16`) before a
   production LLM key; `DEC-104` items 5/9/10; Terraform HCL unvalidated (no
   binary); jobs access roles provisional (`DEC-101`).

## Operating notes for the next session

- **Verify before committing**: `nvm use 22` → `npm run typecheck` → `lint` →
  `format:check` → `build` → `DATABASE_URL=… npm run test` → `npm run db:migrate`
  (expect a no-op) → normalise `apps/web/next-env.d.ts`/`apps/web/tsconfig.json`
  with `git checkout --` → **then re-read the tree** (agents' summaries are not
  the state).
- **Long commands can be aborted from the client**: run build/test **detached**
  (`nohup … &`, log to `/tmp/kilo-*.log`) and poll the log, so an aborted
  foreground call does not lose the run.
- **Subagent supervision (new `AGENTS.md` Rule 4)**: several writer/designer
  agents stalled after recon-only or made zero edits. Check `git status --short`
  / targeted `grep` a few minutes after launch; if nothing was written,
  supersede and take the file over directly (post a board `INFO` if the task may
  still write). Prefer inlining reconnaissance into a fresh, tighter brief.
- **Known flake**: `packages/application/src/scheduling/scheduling.postgres.test.ts`
  same-instant ordering — re-run once.

## Suggested skills

- `playwright-cli` for any UI slice's mandatory browser verification.
- `verification-loop` before claiming a slice complete.
- `craftcms-operations` is **not** relevant here (this is a Node/Postgres repo).
