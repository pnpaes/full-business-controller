import {
  IMPORT_POSTING_POLICY as CANONICAL_IMPORT_POSTING_POLICY,
  IMPORT_STATUS as CANONICAL_IMPORT_STATUS,
  MAPPING_STATE as CANONICAL_MAPPING_STATE,
} from "@aquarela/persistence";

/**
 * Canonical import vocabularies. The authority is `schemas/domain-enums.yaml`
 * (`import_status`, `mapping_state`, `import_posting_policy`) and the
 * persistence slice (migration `0022`, `schema/vocabularies.ts`) is the source
 * of truth here. They are widened to `readonly string[]` so the commands can
 * membership-test a caller string without a cast.
 */
export const IMPORT_STATUS: readonly string[] = CANONICAL_IMPORT_STATUS;
export const MAPPING_STATE: readonly string[] = CANONICAL_MAPPING_STATE;
export const IMPORT_POSTING_POLICY: readonly string[] = CANONICAL_IMPORT_POSTING_POLICY;

/** Default partial-posting policy per `DEC-025` (the fallback when a source has no `import_profile`). */
export const DEFAULT_IMPORT_POSTING_POLICY = "allow_partial";

/**
 * Approved dispositions for a non-posted row (`DEC-035`, `SALE-007`). These are
 * the categories reconciliation counts against the source totals; there is no
 * disposition table, so the application records them in the run diagnostics
 * (recorded open point).
 */
export const IMPORT_DISPOSITIONS = ["unmapped", "rejected", "ignored"] as const;
export type ImportDispositionKind = (typeof IMPORT_DISPOSITIONS)[number];
