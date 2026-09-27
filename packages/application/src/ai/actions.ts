/**
 * Audit action vocabulary for AI advisory decisions (`ADR-0009`, `DEC-142`).
 * Values are the `audit_event.action` strings; keeping them here stops a handler
 * from drifting into near-duplicate names. The entity is always the suggestion.
 */
export const AI_AUDIT_ACTIONS = {
  suggestionApproved: "ai.suggestion.approved",
  suggestionRejected: "ai.suggestion.rejected",
} as const;

export const AI_SUGGESTION_ENTITY_TYPE = "ai_suggestion";
