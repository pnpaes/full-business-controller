# 095 — 2026-09-27 — Competitor collector, row 18 slice 18b (`ADR-0010`, `DEC-143`/`DEC-149`)

Status: uncommitted at authoring; branch `main`. No migration.

## What was built.

The scheduled, polite, fail-closed collector behind 18a's source model.

- `packages/jobs-runtime/src/competitor-collector.ts`: an injectable-fetch client
  (`createCompetitorCollectorRun`) + a robots.txt parser + a fact extractor, and
  the cron producer `registerCompetitorCollection`. Per run: robots per origin
  (cached; **fail closed** on a non-2xx/unparseable file), ≥ 1 request/second
  per host, a bounded page budget, bounded 429/5xx retries with backoff, and
  `Retry-After` honoured (integer seconds, capped). Extraction reads JSON-LD
  (`@graph`) product nodes with a `og:`/`product:`/itemprop meta fallback and
  normalises prices; **only facts + a sha256 content hash leave the response** —
  no raw HTML is stored or logged.
- `registerCompetitorCollection(boss, db, options)` — cron
  `COMPETITOR_COLLECTION_QUEUE = "outbox.maintenance.competitor_collection"`
  (`missed:"once"`). **Guard order:** kill switch (`COMPETITOR_COLLECTION_ENABLED`,
  default off) → active + `automated` + `approved` sources (none ⇒ skip) → a
  source with no `competitor_id` link is skipped (never guessed) → robots →
  budget → fetch. Each fact becomes a `pending` `competitor_observation`
  (`capture_method: "automated"`, `competitorSourceId`, `source_url`, provenance
  `{url, capturedAt, method, contentHash}`, system actor `null`). A failing
  source is logged and the run continues; the handler never throws. **Nothing is
  published or applied.**
- Wiring: `startScheduler` registers it; `apps/scheduler/src/main.ts` reads
  `COMPETITOR_COLLECTION_ENABLED` (default false), `COMPETITOR_COLLECTION_CRON`
  (default `0 7 * * 1`), `COMPETITOR_USER_AGENT`, `COMPETITOR_MAX_PAGES_PER_RUN`
  (20), `COMPETITOR_MIN_DELAY_MS` (1000; `< 1000` fails boot rather than breach
  the policy) and `COMPETITOR_TIMEOUT_MS` (10 s). `actorId` on
  `recordCompetitorObservation` widened to `string | null` for system capture.

## Verification.

typecheck / lint / format:check clean; focused suites green (jobs-runtime +
competitors + scheduler, 177 tests including 24 collector tests); build and full
suite at the tip are in the commit. No migration.

## Deferred / recorded.

- **No content-hash dedupe**: each run re-records the same facts as new `pending`
  observations; the human review gate bounds the harm, but repeated runs
  duplicate. Candidate follow-up (a per-source `contentHash` idempotency check).
- Extractor misses JS-rendered menus / pages without JSON-LD or meta (0
  observations, no error); markup changes silently reduce yield.
- robots fail-closed on 404 is stricter than RFC 9309 (which treats 4xx as
  allow-all) — deliberate; those hosts are never collected.
- Example upstream sources (e.g. the actual Wolt partner URL) must be registered
  with approved terms before enabling; the drone runs with the switch off by
  default.
- Sources UI (register/approve/deactivate) is the remaining 18c nicety.

## Rollback.

`git revert` the slice; set `COMPETITOR_COLLECTION_ENABLED=false` for an
immediate stop. No schema change; observations already written stay `pending`
and can be rejected. No posted money or stock fact is touched.
