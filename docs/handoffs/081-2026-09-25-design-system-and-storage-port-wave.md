# 2026-09-25 — Design-system completion and the `file_object` storage port (DEC-129 stage work + DEC-132)

`main`; nothing pushed; nothing applied to DigitalOcean.
This wave covers two independent workstreams committed since handoff
[`080`](080-2026-09-24-w7-ui-refinement-wave.md) (which covers the W7
refinement wave, the DEC-129 stage-1 token layer and the earlier HMS/admin
corrections — do not restate them):

1. **Design-system completion (DEC-129 stages 2–4 + corrections).** The
   stage-1 token layer from handoff `080` was extended to the frozen nav
   primitives and the forgotten shell leftovers, and eight stale styleguide
   claims were corrected against the tokens, `shell.tsx` and the decisions.
2. **The `file_object` storage port (DEC-132).** The largest honest gap left
   by handoff `080` — "`file_object` has no application port, so all file
   bytes are metadata-only" — is closed at the **platform level**: a generic
   `FileStoragePort` with a local adapter and a metadata store, wired to
   exactly one consumer (the staff document library). All other consumers
   remain **deliberately deferred** and named in `DEC-132`.

Decisions `DEC-129` (as corrected in `c451c38`), `DEC-130`, `DEC-131` and
`DEC-132` in `12_OPEN_DECISIONS.md` are the authority of this wave's what and
why; this handoff records the commits and their shape only.
**No migration, no schema change, no data written by any commit in this
wave** — migrations remain through `0066`; **93 public tables**; `db:migrate`
a clean no-op on re-run; `EXPECTED_TABLES` unchanged.

- **Commits (chronological; each independently revertible).**
  1. `c451c38` `docs: correct the DEC-129 shell claim and reallocate
     decision ids` — the DEC-129 row claimed the light sidebar would be
     built in "stage 2"; the live shell was already light. Corrected in the
     decision table and the §209 summary row (line 353), ids `DEC-130`/
     `DEC-131` reallocated to the owner-capability and
     users/scopes-management decisions they now record.
  2. `ca32ca2` `docs(context): bring the handoff current for the HMS and
     admin work` — documentation pass recording the HMS unblock (`70f2525`,
     `03b2533`, `4443364`), the Administration work (`8a4a5f0`, `968ca2e`,
     the `DEC-130`/`DEC-131` implementation) and the permanent `VERIFY-1`
     data written into the dev database. See the `DEC-130`/`DEC-131` rows
     for what that work did; not re-detailed here.
  3. `223651c` `feat(ui): apply the design system recipes to the
     primitives` — **DEC-129 stage 2.** `packages/ui/**`: focus ring 3px
     solid with a 2px offset; control heights 32/40/48; table header 40 and
     row 56; radii 6/10/16/24; disabled opacity 0.45; white inputs; a
     `brandSoft` button variant; the six semantic Badge tones; and a
     `@media (pointer: coarse)` rule raising buttons and fields to the
     44px touch target (which is why the resting 40px height does not cost
     it). Also fixed the login password field's missing
     `autocomplete="current-password"`. Deliberately **not** applied:
     `motion.duration.base` (no panel transition exists to retime) and a
     compact 40px table-row prop (an API addition nobody needs yet).
  4. `4ad6c5d` `feat(ui): re-seat the shell on the light sidebar contract` —
     **DEC-129 stage 4**, plus the last W7 leftover from handoff `080`.
     - **Correction recorded:** the W7 plan had claimed a dark shell would
       be replaced by the package's light sidebar; in fact the shell was
       **already light** and the dark surface existed only as inline styles
       on the frozen primitives, overridden by CSS with `!important` in
       `apps/web/app/(app)/layout.tsx`.
     - `NavItem`/`NavList` now carry the light contract inline (default
       `color.ink.tertiary`; active `color.accent.soft` surface with
       `color.accent.deep` text and a 2px indicator; `NavList` transparent)
       and the dead re-seating layer is gone from
       `apps/web/app/(app)/layout.tsx`.
     - The W7 app-shell search and scope placeholders were resolved by
       **removal, not wiring**: `listLocations` is a per-slice inventory
       option list rather than a shell scope control, and no company/date
       scope read or state exists, so a wired control would have pretended
       to work. (This closes handoff `080`'s "wire or remove" open item.)
  5. `889089f` `fix(ui): re-point the nav hover to the light sidebar
     contract` — `components.tsx` still painted white-on-dark for
     `.aquarela-nav-item:hover`, a leftover of the same misconception; the
     live shell was unaffected but the styleguide specimen was not.
     Re-pointed to `color.ink.primary` on `color.surface.muted`; the
     `!important` kept because `NavItem` sets its resting colour inline.
  6. `da430a6` `docs(styleguide): correct eight stale design-system
     claims` — the styleguide described a palette that no longer exists
     after `DEC-129`; eight claims corrected against the tokens,
     `packages/ui/**` (`shell.tsx`) and the decision. Notably the
     `NavItem` caption ("dark neutral surface, lime cue when active") and
     the `WatercolorBackdrop` body, which claimed berry/green/gold blobs
     while the component renders lavender and info washes.
  7. `9de4c5c` `feat(files): implement the file_object storage port
     (DEC-132)` — the substance of the second workstream:
     - `packages/application/src/files/`: `FileStoragePort`
       (`put`/`get`/`remove`, `put` returning real size and SHA-256), a
       **local adapter** `createLocalFileStorageAdapter({ rootDir })` that
       rejects a storage key escaping its root (gitignored
       `FILE_STORAGE_ROOT`), and `FileObjectsStore` — the metadata port
       over the existing `file_object` table.
     - Commands `storeFileObject`/`readFileObject`/`findFileObject`.
       `storeFileObject` writes bytes then the metadata row + audit event
       in one transaction and **compensates by removing the bytes if the
       metadata write fails**, so no orphaned blob can survive.
     - **No migration**: `file_object` already had `storage_key`, `mime`,
       `filename`, `size_bytes`, `checksum_sha256`, `retention_policy` and
       the polymorphic link (from `DEC-085`, migrations `0035`/`0036`).
     - **One consumer wired** — the staff document library (`DOC-002`):
       `POST /api/v1/documents/[id]/versions/upload` (multipart,
       `DOCUMENT_MANAGE_ROLES`) stores the bytes and creates the version;
       `GET /api/v1/document-versions/[id]/file` (`DOCUMENT_READ_ROLES`
       plus a per-document read check) streams them — a non-manager may
       fetch only the current published `all_staff` version, a manager any
       version.
     - **Deferred and named in `DEC-132`:** the employee-document,
       incident-evidence, maintenance-evidence and payroll-export
       consumers; DigitalOcean Spaces/S3, signed URLs, retention
       enforcement, malware scanning, MIME/signature validation, content
       addressing and per-class retention. The port is the seam; **no
       cloud storage is built**.
  8. `4e2736c` `docs(decisions): record DEC-132, the file_object storage
     port` — the decision row and §209 summary row (line 356).
- **Rollback (Rule 2).** `git revert <sha>` for each commit above, in any
  order — see the reversibility-log entry appended with this handoff.
  Notably: the storage port needs **no migration rollback** (the
  `file_object` table is unchanged; only ordinary blob files under a
  gitignored root are written at runtime by the
  upload route). The design-system commits touch only `packages/ui/**` and
  docs. The `ca32ca2` pass is docs-only; its recorded `VERIFY-1` data in the
  dev database is dev-seed data in an unpushed dev DB, not a migration
  concern.
- **Status of the `080` open-gaps list after this wave.** Changed entries:
  the `file_object` port now **exists** with a local adapter (one consumer
  wired); the app-shell search/scope placeholders are **removed**, not
  wired. Still open as in `080`: no unit-catalogue read, no cost-centre
  list read, no `calculatePriceScenario` HTTP route, no HMS-scoped
  assignable-user read for incident owner assignment, Administration gaps
  (Tax/rules and Integrations backends), planning/forecast tracking,
  rate-limiter shared store, reset-token delivery stub, `WF-003`
  self-assignment (`DEC-102`), unsigned golden fixtures, the
  `task`↔`approval` link, the worker/outbox layer gated on `ADR-0004` — and
  now the four deferred storage consumers listed under `9de4c5c`.
- **In flight at the time of writing — four agents running in this
  worktree with nothing committed. Do not treat any of this as done; check
  `git status`/the commit log before assuming anything below landed:**
  1. A **fixer** on the two measured overflow defects: the shell's
     `.aq-canvas` is content-box with `width: 100%` plus padding, so
     **every page overflows** its viewport (measured 1344/816/407 against
     the 1280/768/375 targets), and `PageHeader`'s actions row does not
     wrap at 375.
  2. A **designer** extending the design system to `sales`, `purchasing`
     and `costs` (the DEC-129 stage-3 screen rollout).
  3. A second **designer** extending it to `recipes`, `production`,
     `insights`, `close`, `tasks`, `administration`, `account` and
     `documents`.
  4. A **fixer** correcting copy that still says "`file_object` has no
     application port" — now false at the platform level (the consumers
     remain deferred, so only the claim is stale, not the honoured gaps).
- **Process findings (recorded so the next session does not relearn them):**
  1. Concurrent agents **share one `playwright-cli` session**, which
     silently invalidated one agent's browser verification when another
     navigated mid-check. The fix, verified working: launch browser work
     with `playwright-cli -s=<name>` per agent so each has its own named
     session. Any coordination plan that runs a designer/verifier beside
     another browser-using agent must carry this.
  2. `writer` agents have `bash` denied, so a writer can never run
     `typecheck`, `prettier` or a screenshot. Documentation-only edits are
     safe to delegate to a writer; **anything needing verification must go
     to a verifying agent** — briefing a writer to verify is a coordinator
     error.
  3. Standing owner rules, restated so they survive into any future plan:
     **every subagent runs in the background**, and **documentation is
     always delegated to the documentation agent**.
- **Migrations / deployment posture at this handoff:** migrations through
  `0066`; **93 public tables**; `db:migrate` a clean no-op; the
  design-system and storage work added none. **Nothing is pushed** and
  nothing is applied to DigitalOcean.
- **Next:** the close-out pass owns `CONTEXT.md` (write the
  `Resume here (next session)` section against the wave plus whatever the
  four in-flight agents have committed by then), the coordinator reconciles
  the in-flight work, and the recorded next step beyond that is the DEC-129
  stage-3 screen rollout beyond what the two designers reached and the
  named `DEC-132` deferred consumers when the owner/OPS confirms the
  decision.
