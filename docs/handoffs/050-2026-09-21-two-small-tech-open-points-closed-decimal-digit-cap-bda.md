# 2026-09-21 — Two small TECH open points closed (decimal digit cap `bda0b6b`; `IMPORT_DISPOSITION` yaml key `8b22468`); handoff updated

`main` HEAD `8b22468`; the session's work is committed as three commits —
`bda0b6b`, `8b22468` and this context docs update (nothing pushed; nothing
applied to DigitalOcean); the tree was clean at `ebd6ed3` (the `file_object`
slice handoff) before the work. **3 commits** in order: `fix(domain)` —
`parseDecimal` rejects a value beyond the `numeric(19, scale)` storage
precision (money `numeric(19,4)`, quantities `numeric(19,6)`; leading zeros
excluded from the count), new `packages/domain/src/decimal.test.ts`
(boundaries at scale 6/4/0, leading zeros, negative); `chore(vocabularies)`
— the canonical `import_disposition` key added to
`schemas/domain-enums.yaml`, the `YAML_ABSENT_VOCABULARIES` exemption removed
(now empty, so the guard enforces every exported vocabulary has a yaml key),
and the provisional-mirror comments corrected; plus this docs(context)
update.

- **Delivered (two small unblocked TECH open points closed):** (i) the
  missing `numeric(19,6)` digit cap in `packages/domain/src/decimal.ts`
  (`bda0b6b`); (ii) the missing `schemas/domain-enums.yaml` key for
  `IMPORT_DISPOSITION` (the `DEC-083`-review point (iii)) (`8b22468`). No
  schema change — **68 tables** (unchanged); migrations through `0036`. Next
  free decision id **`DEC-086`** (now `DEC-095`).
- **Reviews and reconciliation.** `reviewer-glm` on the `decimal.ts` change
  — **no blocker/major**; **accepted and applied** its minor (add the
  negative over-limit and scale-0 boundary tests); its second minor (the
  19-digit cap is looser than the `numeric(9,6)` rate and `numeric(19,10)`
  tax columns) is **noted, no action** — it is out of the cap's scope and
  recorded in the `ponytail:` note. The vocabulary change was mechanical (no
  review).
- **Verification (at HEAD `8b22468`, exact):** `typecheck`, `lint`,
  `format:check`, `build` clean; **1397/1397 tests with `DATABASE_URL`** (137
  files); `npm audit --omit=dev` = 0; `db:migrate` through `0036` is a no-op
  on re-run; 68 tables.
- **Next step:** the `FakeCountStore.withTransaction` rollback
  (test-fidelity: snapshot/restore the count + inventory + exception maps
  like `FakeProductionStore`), then the per-IP rate-limiter shared store
  (needs a migration and a store choice). The remaining small unblocked TECH
  open points (the reset-token delivery stub) and the owner-gated items (the
  unit `m`/`length` dimension; the palette hex values) stay recorded — see
  "Resume here".

Rollback: each of the three commits is independently `git revert`-able; no
migration was touched (migrations stay through `0036`, 68 tables); nothing
pushed; nothing applied to DigitalOcean.
