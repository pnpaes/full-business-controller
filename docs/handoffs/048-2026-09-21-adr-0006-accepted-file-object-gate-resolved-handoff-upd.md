# 2026-09-21 — ADR-0006 accepted; `file_object` gate resolved; handoff updated

`main` HEAD `2d4b98b` (the parent of this docs commit; nothing pushed;
nothing applied to DigitalOcean). This session is **docs-only** — no code,
no schema, no decision entry.

- **Gate resolved:** the owner **accepted `ADR-0006`** (File storage and
  retention) in-session 2026-09-21; its status line is now
  `Accepted (2026-09-21)` with a short acceptance note (revertible; the
  provider/region were already decided by `DEC-014`; the **retention periods
  per file class** remain an open item for the privacy review). The row-11
  `file_object` point (6) is **unblocked** and is the next buildable TECH
  task.
- **Docs updated:** `docs/adr/0006-file-storage-and-retention.md` (status +
  acceptance note); `docs/BUILD_ROADMAP.md` (§3 Proposed-ADR list drops
  `ADR-0006`; §5 row-11 point 6 unblocked; §1 next-task framing); this file
  (`Resume here` RESOLVED GATE, open inputs, status, next up, open
  decisions, work log, reversibility).
- **Verification:** docs-only; the test baseline is unchanged
  (**1375/1375** at HEAD `2d4b98b`).

Rollback: docs-only among `docs/adr/0006-file-storage-and-retention.md`,
`docs/BUILD_ROADMAP.md` and `CONTEXT.md` — trivially `git revert`-able; no
migration, code or data touched.
