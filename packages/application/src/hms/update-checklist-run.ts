import { DomainError, NotFoundError } from "@aquarela/domain";

import { isBlank } from "../inventory/validation";

import { HMS_AUDIT_ACTIONS } from "./actions";
import { assertChecklistResultKeys, assertChecklistResults } from "./checklist-validation";
import { CHECKLIST_RUN_STATUSES } from "./record-checklist-run";
import type { ChecklistRunRecord, HmsStore } from "./types";

export interface UpdateChecklistRunInput {
  readonly organizationId: string;
  readonly runId: string;
  /** One of `CHECKLIST_RUN_STATUS`. */
  readonly status?: string;
  /** jsonb array; replaces the whole results list. */
  readonly results?: unknown;
  /** `null` clears the notes. */
  readonly notes?: string | null;
  readonly actorId: string;
}

/** Patch field → audit payload key, so `before`/`after` share one shape. */
const AUDIT_FIELDS = {
  status: "status",
  results: "results",
  notes: "notes",
} as const;

/**
 * Amends one checklist run (`HMS-005`, `DEC-091`). The run is loaded
 * organization-scoped first (`DEC-061`; a missing or cross-organization id is a
 * typed `NotFoundError`), then the patch is validated: `status` is checked
 * against `CHECKLIST_RUN_STATUS` and `results` against the array shape. A
 * replacement `results` is also checked against the run's own template — the
 * template row is resolved from the run's immutable `template_id` and a key
 * outside its `items` is a `DomainError` (`DEC-096`); completeness is not
 * required. The run's provenance (`template_id`/`location_id`/`run_at`/
 * `performed_by`) is immutable, so a completed run keeps the exact template
 * revision it used.
 * `status` has no derived companion (`DEC-096`): unlike the incident close or
 * the corrective-action verification there is no completion instant to keep
 * coherent. The update and its audit fact commit or roll back together.
 */
export async function updateChecklistRun(
  store: HmsStore,
  input: UpdateChecklistRunInput,
): Promise<ChecklistRunRecord> {
  if (isBlank(input.runId)) {
    throw new DomainError("runId is required");
  }

  return store.withTransaction(async (tx) => {
    const run = await tx.findChecklistRun({
      organizationId: input.organizationId,
      runId: input.runId,
    });
    if (run === undefined) {
      throw new NotFoundError("checklist run not found in organization");
    }

    const mutable: {
      status?: string;
      results?: unknown;
      notes?: string | null;
    } = {};

    if (input.status !== undefined) {
      if (!CHECKLIST_RUN_STATUSES.includes(input.status)) {
        throw new DomainError(`status must be one of ${CHECKLIST_RUN_STATUSES.join(", ")}`);
      }
      mutable.status = input.status;
    }
    if (input.results !== undefined) {
      assertChecklistResults(input.results);
      // The run's provenance pins the exact template revision it used, so the
      // replacement results are checked against that row's items (`DEC-096`).
      const template = await tx.findChecklistTemplate({
        organizationId: input.organizationId,
        templateId: run.templateId,
      });
      if (template === undefined) {
        throw new NotFoundError("checklist template not found in organization");
      }
      assertChecklistResultKeys(input.results, template.items);
      mutable.results = input.results;
    }
    if (input.notes !== undefined) {
      mutable.notes = input.notes;
    }

    if (Object.keys(mutable).length === 0) {
      throw new DomainError("no updatable fields provided");
    }

    const updated = await tx.updateChecklistRun({
      organizationId: input.organizationId,
      runId: run.id,
      ...mutable,
      updatedBy: input.actorId,
    });
    if (updated === undefined) {
      throw new NotFoundError("checklist run not found in organization");
    }

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const field of Object.keys(AUDIT_FIELDS) as (keyof typeof AUDIT_FIELDS)[]) {
      if (mutable[field] === undefined) continue;
      before[AUDIT_FIELDS[field]] = run[field];
      after[AUDIT_FIELDS[field]] = updated[field];
    }

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: HMS_AUDIT_ACTIONS.checklistRunUpdated,
      entityType: "checklist_run",
      entityId: updated.id,
      before,
      after,
    });

    return updated;
  });
}
