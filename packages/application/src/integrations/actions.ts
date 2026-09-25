/**
 * Audit action vocabulary for the integrations registry (`INTG-001`,
 * `DEC-137`). Values are the `audit_event.action` strings; keeping them here
 * stops a handler from drifting into near-duplicate names. `entityType` is
 * `integration_source` for every action.
 */
export const INTEGRATION_AUDIT_ACTIONS = {
  integrationSourceCreated: "integrations.integration_source.created",
  integrationSourceUpdated: "integrations.integration_source.updated",
} as const;

export const INTEGRATION_SOURCE_ENTITY_TYPE = "integration_source";
