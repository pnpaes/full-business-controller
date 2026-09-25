# ADR-0011 — External publishing

- **Status:** Accepted (2026-09-25)
- Accepted 2026-09-25 by the owner + tech lead (in-session, revertible). INTG-001, the per-source
  integrations registry, is in scope; INTG-002 publishing execution remains gated on `ADR-0004`
  (still `Proposed`).
- **Date:** 2026-09-14
- **Deciders:** TECH, BUS
- **Related:** DEC-002, DEC-015, ADR-0008
- **Requirements:** INTG-001, INTG-002, INTG-003

## Context

The owner (DEC-015, 2026-09-14) wants approved internal changes published to external systems — first
POS and Medusa/Sanity, and later Wolt and Fiken once their APIs and terms permit — instead of relying
on manual re-entry. The previous integration posture was read-only ingestion with no external writes
(ADR-0008, `06:97`). External sources differ widely in whether they expose a write API, what their
terms allow and how they behave under failure, so an unrestricted "sync everything" approach is not
acceptable. Internal remains the system of record for approved costs and prices (DEC-002), so
publishing must never become a second source of truth or a silent bidirectional sync.

## Decision

- **Per-source allowed operations.** Each integration declares exactly which operations are permitted
  (read; write price; write menu/product; write stock; write accounting) in an
  `integration_source` registry, with a **named credentials owner**. Nothing outside the registry is
  allowed, and read-only remains the default until an operation is explicitly approved.
- **Push-only from approved internal changes.** Publishing flows one way, from an approved internal
  entity/version to the external system; there is no bidirectional sync that lets the external system
  write back into internal masters.
- **Idempotent publish jobs.** Every publish is an idempotent background job with an idempotency key
  unique per integration, so retries and replays cannot double-write (`publish_run`).
- **Confirmation read-back.** After a write, the job reads the source back and stores the observed
  result as evidence that the publish actually landed.
- **Audit.** Every publish attempt records actor, time, integration, entity and version, operation,
  request/response snapshots and outcome (FND-005, `07.3`).
- **Rollback.** Every write type has a defined, tested rollback procedure; rollbacks reference the
  original run (`rollback_of_id`) and are themselves audited.
- **Failure alerts.** A failed, unconfirmed or rolled-back publish raises an alert to the integration
  owner rather than leaving internal and external state silently divergent.
- **Credentials per integration.** Each integration keeps its own credentials in the managed secret
  store with a named owner, scoped as narrowly as its approved operations require.
- **Internal stays the system of record.** Approved internal cost/price decisions remain authoritative
  (DEC-002); publishing projects them outward without weakening that ownership (ADR-0008).

## Alternatives considered

- **Read-only only (previous default).** Simplest and lowest vendor/legal risk, but it leaves the
  owner's approved changes to be re-entered by hand; superseded by DEC-015.
- **Optimistic full sync (write everything, everywhere).** Maximum automation, but it ignores vendor
  write-API availability and terms, has no safe conflict or rollback story, and risks the external
  system overwriting approved internal decisions; rejected.
- **Manual publishing (recorded as a task).** No vendor write dependency, but it does not remove the
  staff-time cost the owner wants to eliminate and cannot guarantee confirmation or audit; kept only as
  the fallback for sources without a permitted write API.

## Consequences

- Publishing depends on each **vendor's write API and terms**; an operation cannot be enabled until
  both permit it, so scope advances source by source.
- **Conflicts must be detected** when a source changed independently of the last approved internal
  change (e.g. an external edit between publishes); a conflict routes to review rather than a blind
  overwrite.
- **Rollback must be designed per operation** and rehearsed; some sources cannot fully undo a write, so
  compensation may be required.
- **Test coverage** is needed for idempotency (replay safety), confirmation read-back, failure alerting
  and rollback for every enabled operation.
- New tables `integration_source` and `publish_run` and enums `allowed_operation`, `publish_status`
  (DATA_DICTIONARY §4D, `schemas/phase1_2_draft.sql`).
- ADR-0008 is updated: read-only ingestion is no longer the universal default and ownership is now per
  field **and per operation**.

## Open items

- Which operations are approved per source is decided as **read-only** for all registered sources
  (`DEC-137`, 2026-09-25): Frontline POS, Wolt, Foodora, Medusa, Sanity (credentials owner TECH) and
  Fiken (credentials owner FIN); `terms_status='pending'` and no write operation enabled.
- Enabling a write operation per source still awaits each vendor's confirmed write-API availability
  and terms (I15/I18; credentials owners are named but write terms are not confirmed).
- Publishing execution (job/outbox) remains gated on `ADR-0004` (`Proposed`); INTG-002's
  `publish_run` is not built.
- Rehearse the rollback path for each enabled operation before it goes live.
