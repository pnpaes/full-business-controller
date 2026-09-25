/**
 * Audit action vocabulary for the `DEC-011` forecast-tracking slice. Values are
 * the `audit_event.action` strings; keeping them here stops a handler from
 * drifting into near-duplicate names.
 */
export const FORECAST_AUDIT_ACTIONS = {
  forecastSnapshotRecorded: "analytics.forecast_snapshot.recorded",
  forecastOverrideRecorded: "analytics.forecast_override.recorded",
} as const;

export const FORECAST_SNAPSHOT_ENTITY_TYPE = "forecast_snapshot";
export const FORECAST_OVERRIDE_ENTITY_TYPE = "forecast_override";
