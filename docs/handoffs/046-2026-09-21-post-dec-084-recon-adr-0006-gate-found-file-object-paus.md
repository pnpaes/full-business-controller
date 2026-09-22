# 2026-09-21 — Post-`DEC-084` recon: `ADR-0006` gate found; `file_object` paused; gate list corrected

`main` HEAD `9a3d60b` (clean; the tree was clean at `9a3d60b` before this
docs-only edit; nothing pushed; nothing applied to DigitalOcean). This
session is **docs-only** — no code, no schema, no decision entry.

- **Post-`DEC-084` recon** for the planned next task (`file_object`, row-11
  import-framework point 6) found that **`ADR-0006`** (File storage and
  retention) is **`Proposed`** and explicitly governs that table:
  `docs/adr/0006-file-storage-and-retention.md` states the implementation
  must not rely on it until `Accepted`, and names
  `file_object.retention_policy`. Under `docs/BUILD_ROADMAP.md` §3 a
  Proposed ADR required by the slice is a **stop condition** — raised to
  the owner, the loop pauses.
- **Stale gate-list correction:** §3's parenthetical claimed only
  `ADR-0009`–`0011` were `Proposed`; verified from each ADR's Status line,
  the actually-Proposed ADRs are `ADR-0004`, `ADR-0006`, `ADR-0009`,
  `ADR-0010`, `ADR-0011` (`ADR-0007`/`ADR-0008` accepted 2026-09-20).
  Corrected in §3.
- **Pause recorded:** §5 row-11 point 6 annotated as gated; §1's
  next-task statement updated — while paused, the next unblocked TECH item
  is the tracked `DEC-083` **contract step** (delete the frozen
  `diagnostics.dispositions` jsonb keys once nothing depends on them);
  `Resume here` rewritten around the gate with the contract step as the
  recommended interim task. Next free decision id **`DEC-085`**.

Rollback: this change is docs-only among `CONTEXT.md` and
`docs/BUILD_ROADMAP.md` — trivially `git revert`-able; no migration, code
or data touched.
