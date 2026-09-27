# 094 — 2026-09-27 — Competitor sources, row 18 slice 18a (`ADR-0010`, `DEC-143`/`DEC-149`, migration `0076`)

Status: uncommitted at authoring; branch `main`. Migration `0076`.

## What was decided and what was built.

`ADR-0010` was accepted 2026-09-27 (`DEC-143`) with approved automated sources
= public competitor websites under the `DEC-020` rules plus the Wolt menu
subject to its terms, Instagram manual. Recon found that the delivered
`DEC-126` slice (migration `0066`) is a **different, simpler shape** than the
`ADR-0010` §4C model; **`DEC-149`** decided the reconciliation (additive) and
the collection policy. This slice is 18a: the sources model. The collector
(cron + robots/rate-limit politeness) is 18b.

- **Migration `0076_competitor_source.sql`** (expand-only, + down + journal/
  snapshot): new `competitor_source` (org-scoped; `competitor_name`,
  `source_type` website/wolt/instagram_manual/other, `url_or_identifier`
  unique per org, `collection_mode` automated/manual, `terms_status`
  pending/approved/rejected, plain-uuid `approved_by` + `approved_at`,
  `rate_limit_note`, active window, audit columns). Two invariant checks:
  **`collection_mode <> 'automated' OR terms_status = 'approved'`** (automation
  requires approval) and a completed terms decision records who + when.
  `competitor_observation` gains nullable `competitor_source_id` (FK),
  `capture_method`, `product_category`, `season`, `provenance jsonb`. The
  `DEC-126` columns, including `review_status`, are untouched — §4C
  `review_state` **is** `review_status`. Public tables **101 → 102**.
- Application (`packages/application/src/competitors/**`): `registerCompetitorSource`,
  `approveCompetitorSourceTerms` / `rejectCompetitorSourceTerms`,
  `deactivateCompetitorSource`, `listCompetitorSources` (active filter),
  `findCompetitorSource`; `recordCompetitorObservation` extended with the new
  optional fields (a supplied source must belong to the org).
- Routes (`apps/web/app/api/v1/competitors/**`): `GET/POST /sources`,
  `POST /sources/[id]/approve-terms|reject-terms|deactivate`; observations
  accept the new optional fields. **Role split:** read = `COMPETITOR_READ_ROLES`;
  manual source registration and observation review = `COMPETITOR_WRITE_ROLES`;
  **terms approval = `COMPETITOR_TERMS_ROLES` (owner/admin only)**; automated
  registration is gated to the terms roles (it registers already approved, with
  actor + instant — the DB check is the backstop).
- `schemas/domain-enums.yaml` gains `competitor_source_type`,
  `competitor_collection_mode`, `competitor_terms_status`; `review_state` reuses
  the existing `competitor_review_status`.

## Verification.

typecheck / lint / format:check clean; focused suites green (competitors +
persistence + competitor routes); `db:migrate` applied `0076` and is a no-op on
re-run; the `0076` down path rehearsed on a scratch DB (table + 5 columns
present → down → absent, the 15 pre-existing observation columns intact). Build
and full-suite results at the tip are in the commit.

## Deferred / recorded.

- **No mode-change path**: `collection_mode` is set at registration; manual →
  automated needs a new source (URL unique) or a future command.
- No free-text reason on a source rejection (the schema has no field): status +
  actor + instant only.
- `active` filter means "not ended" (`active_to IS NULL`), not "active as of
  today" — a future `active_from` still counts.
- `provenance` is any JSON object; excluding personal data is the 18b collector's
  obligation.
- Deferred FKs: `competitor_id`/`approved_by` are plain uuids (the repo
  precedent).
- **18b** (collector: scheduler cron behind a default-off kill switch,
  robots.txt + per-host rate politeness, bounded page budget, facts-not-copies
  provenance) and a sources UI are the next steps.

## Rollback.

Run `0076`'s down file (drops the 5 §4C columns + the table; `DEC-126` data
intact), then `git revert`. No posted money or stock fact is touched; no
external write exists yet.
