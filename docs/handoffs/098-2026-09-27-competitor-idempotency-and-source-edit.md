# 098 — 2026-09-27 — Competitor capture idempotency + source editing (`ADR-0010`, `DEC-149`, migration `0078`)

On branch `main`; **committed** as `d5193d3` (shared with the `WF-003` `0077`
slice — the two migrations share the drizzle `_journal.json`). Migration `0078`.

## What was built.

Two recorded `DEC-149` follow-ups from row 18.

### Capture idempotency (migration `0078`)

- `competitor_observation.content_hash` (nullable) + a **partial unique index**
  `(organization_id, competitor_source_id, content_hash) WHERE content_hash IS
  NOT NULL` — an index rather than a table constraint because a constraint
  cannot express the `WHERE` predicate and would allow only one NULL per source.
- The automated capture path inserts with `ON CONFLICT DO NOTHING` on that index
  (race-free; returns `undefined`/skips and writes no audit fact); the collector
  passes a hash, counts duplicates and logs them. **Manual captures are never
  deduped** (a supplied hash is dropped to NULL).
- **Honest deviation:** the hash is not the raw page hash but
  `sha256(pageHash ⧵0 externalName ⧵0 price)`, because the index shape forces an
  observation-scoped key — a raw page hash would collapse every fact on a page
  after the first. `provenance.contentHash` still carries the raw page hash.

### Source editing (no migration)

- `updateCompetitorSource` allows URL / rate-limit-note edits and a **mode
  change**, where switching to `automated` **requires `terms_status = 'approved'`**
  (the DB check is the backstop) and switching to `manual` is always allowed;
  a no-op edit writes no fact; audit `competitors.source.updated` (before/after —
  a new action value).
- `PATCH /api/v1/competitors/sources/[id]`: URL / rate-limit / mode→manual under
  `COMPETITOR_WRITE_ROLES`; **mode→automated under `COMPETITOR_TERMS_ROLES`**
  (owner/admin). Same-origin + limiter + UUID + `NotFoundError`→404 /
  `DomainError`→400. The sources UI gains a row **Edit** affordance (the
  `automated` option is offered only to the terms roles).

## Verification.

typecheck / lint / format:check clean; `next build` exit 0; **5386/5386 tests
(395 files)** with `DATABASE_URL`; `db:migrate` applied `0078` and is a no-op on
re-run; the down path rehearsed on a scratch DB (column + partial index present →
down → absent, 103 tables and `competitor_source`'s 18 columns intact).
**Not browser-verified**: the Edit affordance is covered by typecheck and the
PATCH route tests, but no live click-through was run.

## Deferred / recorded.

- The `ON CONFLICT … WHERE` arbiter must track the index predicate: a future
  migration changing the predicate must update the insert too.
- Changing fact extraction (name/price normalisation) re-records facts once.
- `competitors.source.updated` is a new audit value with no `12_OPEN_DECISIONS`
  entry (it is a mechanical action name, not a decision).
- `updateCompetitorSource` does not bump `version` (the pre-existing repo
  convention for these updates).

## Rollback.

Run `0078`'s down file (drops the partial index then the column; no observation
row or posted fact touched), then `git revert d5193d3` (which also reverts the
`WF-003` slice).
