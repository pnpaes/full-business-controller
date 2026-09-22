# 2026-09-20 — Rows 11–12 committed; session paused at a clean point; handoff updated

`main` HEAD `77d913e`; the working tree is **clean**; **17 commits** landed since
the previous session baseline `f7b1db7`; nothing pushed; nothing applied to
DigitalOcean. Recent order: `77d913e` docs (row 12), `2104068` feat(sales) row
12, `c324418` docs(adr) accept ADR-0007/0008, `0ac9667` docs (row 11),
`a02719f` fix(web) DomainError messages, `501df54` feat(imports) row 11,
`7f6aa78` feat(web) inventory sub-links, `081b5f4` docs(runbook) 0020/0021,
`9b240bc` docs, `6fc533c` feat(production) web, `8a8ef7e` feat(stock-ops)
slice 9 + slice 10 backend, `2a5799e` docs, `6c69f7f` feat(web) design
system/screens, `c91e512` feat(application), `40e736b` feat(domain),
`b525f30` feat(persistence), `583da3f` feat(infra).

- **Delivered and committed:** slices 8 (stock ledger), 9 (counts/transfers/
  waste), 10 (production planning + batches incl. web), row 11 (import
  framework + external mappings), row 12 (sales + settlements + reconciliation
  - theoretical consumption); the Aquarela design system, app shell and all
    product screens; migrations `0017`–`0023`; decisions `DEC-066`–`DEC-071`;
    `ADR-0007`/`ADR-0008` accepted 2026-09-20 (owner-delegated, revertible;
    `c324418`). Cross-cutting fixes: `jsonError`/`mapErrors` `DomainError`
    messages, the 404-for-non-UUID route-param guard, the inventory sub-links
    and the `sales_line` source-guard test fix.
- **Verification at `77d913e` (exact):** `typecheck`, `lint`, `build`,
  `format:check` clean; **1186/1186 tests with `DATABASE_URL`** (127 files);
  `npm audit --omit=dev` = 0; `db:migrate` through `0023` is a no-op on re-run;
  every migration down path (`0017`–`0023`) rehearsed; **62 tables**.
- **Paused at a clean point** per the global ruleset: everything committed and
  verified; above USD 20 the session is permitted to pause here only at a
  clean point — this is one.
- **Resume task:** resolve the recorded open owner questions as decisions from
  `DEC-072` and implement the low-risk ones (tolerance-config table `DEC-026`;
  sales-line reversal `DEC-028`; typed not-found error replacing the
  `/not found/i` matching; `MAPPING_STATE` `conflict`; the `tax_rule_id`/
  `applied_tax_rate` naming) — see "Resume here". A dev server was running at
  http://localhost:3000 (owner/LocalDevPass123, demo-seeded); a fresh session
  must restart it (session-scoped).

Rollback: everything is committed — `git revert <sha>` per commit; migrations
`0017`–`0023` are additive with rehearsed down paths.
