/**
 * Audit action vocabulary for the competitor-observation slice (`DEC-126`).
 * Values are the `audit_event.action` strings; keeping them here stops a handler
 * from drifting into near-duplicate names.
 *
 * The register rows are mutable, so each command records its own action rather
 * than overloading `updated`. An idempotent `registerCompetitor` re-registration
 * (the name already exists) writes **no** fact, and the one-shot review writes
 * exactly one of `reviewed`/`rejected`.
 */
export const COMPETITOR_AUDIT_ACTIONS = {
  competitorRegistered: "competitors.competitor.registered",
  observationRecorded: "competitors.observation.recorded",
  observationReviewed: "competitors.observation.reviewed",
  observationRejected: "competitors.observation.rejected",
  // `ADR-0010`/`DEC-143` (row 18a): competitor sources. A registration that
  // enables automation records the terms approval as its own fact (below), so
  // the higher-bar decision is always separately auditable.
  sourceRegistered: "competitors.source.registered",
  sourceTermsApproved: "competitors.source.terms_approved",
  sourceTermsRejected: "competitors.source.terms_rejected",
  sourceDeactivated: "competitors.source.deactivated",
} as const;
