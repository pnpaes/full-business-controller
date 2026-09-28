# 102 — 2026-09-28 — Session compaction: UX programme + role/position + defects

Compaction of the 2026-09-28 session. Navigation record only — per-slice detail
lives in handoffs `097`–`101`, the commits, and `docs/ux/reviews/README.md`.

## Where things stand

- Branch `main`, tree clean, **pushed** to `origin/main`.
- **5489/5489 tests (404 files)**; migrations through **`0080`**; **105 public
  tables**; typecheck/lint/format:check clean; `next build` exit 0; `db:migrate`
  a no-op; nothing applied to DigitalOcean.
- Sessions delivered this day (newest first):
  | Slice | Commit |
  | --- | --- |
  | Route error/not-found/loading boundaries + de-internalised production copy + non-exclusive for-sale wording | `f6a73c1` |
  | Employee role as a fixed entity + position catalogue (`DEC-151`, migration `0080`) | `dcb284a` |
  | **Wave 0** design-system primitives/formatters/tokens + `/styleguide` | `d943326` |
  | `DEC-151` decision row | `91b22cd` |
  | `DEC-150` item-purpose implementation (`0079`) + docs | `7427b43`, `aec62ed` |
  | Item-purpose decision + clarification | `77c1819`, `404dfc2` |
  | Products redesign: Items modalised, Sellables → Products → Variants | `2d707c1`, `c749b2a` |
  | 71-screen UX audit + triage index + contract + inventory | `97fcdb0`, `660d3a2`, `f374d03`, `1af75df` |
  | Single-VM deployment path (`deploy/`) + docs pivot | `c2dfa6b`, `e6f169b` |
  | M1 regression gates (chain rehearsal, day-one, E2E, env-drift) | `d818583`, `fdc096f` |

## Immediate next work

**The area waves** — apply the items/products treatment (one primary action,
creation/editing in `Modal`s, split contexts, progressive disclosure, hero metric
instead of KPI walls, `InfoTip` for explainability) to every section, per
`docs/ux/reviews/*.md`, in this order (from the triage index):

1. Home, Jobs, Administration (highest signal per change)
2. Workforce (now also uses `DEC-151` roles/positions), then Inventory /
   Purchasing / Production
3. Sales / Products (a `sales/layout.tsx`), Costs (merge 9 screens toward ~6)
4. Insights / AI, then HMS / Recipes, then misc

Wave 0 is done, so every wave composes the new primitives (`InfoTip`,
`Collapsible`, `MetricBand`, plain `EmptyState`, `FormModal`, `SuccessToast`,
`FileField`, the formatters, the token roles) — they are rendered in `/styleguide`
as the living reference.

## Open items / known follow-ups

- `packages/ui` test files carry minimal `as never` casts (integrator workaround
  for `createElement` overloads); consider fixing the overloads instead.
- `ITEM_PURPOSE` lives in `packages/persistence/src/schema/catalog.ts`, not
  `vocabularies.ts`; to align with `ITEM_TYPE`/`INVENTORY_POLICY`, add
  `item_purpose: [for_sale, for_use]` to `schemas/domain-enums.yaml` and move it.
- `0080`: `shift.role_code` is retained (contract later); the role FK may remain
  `NOT VALID` on a DB with unmapped employee roles (classify, then
  `VALIDATE CONSTRAINT`); a shift cannot be published without a position.
- `0079`: the backfill assumes every `finished_good` is for-sale; re-classify on
  the Stock screen if wrong; raw-SQL inserts default to `for_use`.
- Manager override: the API records it, the roster **UI** does not offer it yet.
- `DEC-140` keeps the `job` prune org-scoped; AI cost caps are live but the price
  table is operator-supplied; INTG-002 stays deferred (`DEC-141`); the deployment
  rehearsal stays parked (`DEC-148`).

## Operating notes (unchanged but important)

- **Verify then commit**: `nvm use 22` → typecheck → lint → format:check → build →
  `DATABASE_URL=… npm run test` → `db:migrate` (no-op) → `git checkout --`
  `apps/web/next-env.d.ts`/`tsconfig.json` → re-read the tree.
- **Run long commands detached** (`nohup … > /tmp/log &`) — an aborted foreground
  call loses the run; and **never run `npm run build` while the dev server shares
  `.next`** (it 500s the dev server; restart it, or use `NEXT_DIST_DIR`).
- **Subagent supervision** (`AGENTS.md` Rule 4): several agents hit step caps
  after landing code but before verifying — check `git status`/`grep` a few
  minutes in, then finish their verification yourself or via an integrator.
- One agent hit a full disk and pruned the Docker build cache (~9 GB, cache only).
- Known flake: `packages/application/src/scheduling/scheduling.postgres.test.ts`
  same-instant ordering — re-run once.
