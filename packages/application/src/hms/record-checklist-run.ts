import { DomainError, NotFoundError } from "@aquarela/domain";
import { CHECKLIST_RUN_STATUS } from "@aquarela/persistence";

import { assertIsoInstant, isBlank } from "../inventory/validation";

import { HMS_AUDIT_ACTIONS } from "./actions";
import { assertChecklistResultKeys, assertChecklistResults } from "./checklist-validation";
import type { ChecklistRunRecord, HmsStore } from "./types";

/** The `status` vocabulary a run may hold (`CHECKLIST_RUN_STATUS`). */
export const CHECKLIST_RUN_STATUSES: readonly string[] = CHECKLIST_RUN_STATUS;
/** The status a freshly recorded run starts in. */
export const INITIAL_CHECKLIST_RUN_STATUS = "in_progress";

export interface RecordChecklistRunInput {
  readonly organizationId: string;
  readonly templateId: string;
  readonly locationId: string;
  /** ISO instant the checklist was walked at. */
  readonly runAt: string;
  readonly performedBy: string;
  /** One of `CHECKLIST_RUN_STATUS`; defaults `in_progress`. */
  readonly status?: string;
  /** jsonb array of `{ key, outcome, note? }` results. */
  readonly results: unknown;
  readonly notes?: string | null;
  readonly actorId: string;
}

/**
 * Records one checklist run (`HMS-005`, `DEC-091`): validates the template and
 * location ids, the `run_at` instant, the operator, the `status` vocabulary and
 * the `results` array shape, then creates the run and its audit fact in one
 * transaction. The create is organization-scoped through
 * `input.organizationId` (`DEC-061`).
 *
 * The template is resolved organization-scoped first (missing/cross-organization
 * → typed `NotFoundError`) so every `results[i].key` can be checked against the
 * template's `items` (`DEC-096`); a key outside the template is a `DomainError`.
 * There is no completeness rule — a `completed` run missing an item's result is
 * allowed (open point).
 *
 * There is no completion instant (`DEC-096`): `run_at` is the run's own time and
 * `status` is just a vocabulary value with no derived companion — don't invent
 * one. The template's own organization is enforced by the database
 * (`checklist_run_template_org_guard`, `23514`) as a backstop.
 */
export async function recordChecklistRun(
  store: HmsStore,
  input: RecordChecklistRunInput,
): Promise<ChecklistRunRecord> {
  if (isBlank(input.templateId)) {
    throw new DomainError("templateId is required");
  }
  if (isBlank(input.locationId)) {
    throw new DomainError("locationId is required");
  }
  assertIsoInstant(input.runAt, "runAt");
  if (isBlank(input.performedBy)) {
    throw new DomainError("performedBy is required");
  }
  const status = input.status ?? INITIAL_CHECKLIST_RUN_STATUS;
  if (!CHECKLIST_RUN_STATUSES.includes(status)) {
    throw new DomainError(`status must be one of ${CHECKLIST_RUN_STATUSES.join(", ")}`);
  }
  assertChecklistResults(input.results);

  return store.withTransaction(async (tx) => {
    const template = await tx.findChecklistTemplate({
      organizationId: input.organizationId,
      templateId: input.templateId,
    });
    if (template === undefined) {
      throw new NotFoundError("checklist template not found in organization");
    }
    assertChecklistResultKeys(input.results, template.items);

    const run = await tx.createChecklistRun({
      organizationId: input.organizationId,
      templateId: input.templateId,
      locationId: input.locationId,
      runAt: input.runAt,
      performedBy: input.performedBy,
      status,
      results: input.results,
      notes: input.notes ?? null,
      createdBy: input.actorId,
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: HMS_AUDIT_ACTIONS.checklistRunRecorded,
      entityType: "checklist_run",
      entityId: run.id,
      after: {
        template_id: run.templateId,
        location_id: run.locationId,
        run_at: run.runAt,
        performed_by: run.performedBy,
        status: run.status,
        results: run.results,
        notes: run.notes,
      },
    });

    return run;
  });
}
