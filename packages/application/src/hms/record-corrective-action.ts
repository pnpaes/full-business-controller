import { DomainError } from "@aquarela/domain";

import { isBlank } from "../inventory/validation";

import { HMS_AUDIT_ACTIONS } from "./actions";
import { assertOptionalCalendarDate } from "./register-incident";
import type { HmsStore, CorrectiveActionRecord } from "./types";

/** The status a freshly recorded corrective action starts in. */
export const INITIAL_CORRECTIVE_ACTION_STATUS = "open";

export interface RecordCorrectiveActionInput {
  readonly organizationId: string;
  readonly actorId: string;
  /** The incident the action responds to, or null. */
  readonly incidentId?: string | null;
  /** The monitoring reading the action responds to, or null. */
  readonly monitoringReadingId?: string | null;
  readonly description: string;
  readonly ownerId?: string | null;
  /** `date`, `YYYY-MM-DD`, or null; the target completion day. */
  readonly dueDate?: string | null;
}

/**
 * Records one corrective action (`HMS-004`, `DEC-090`): validates the required
 * description, then creates the action (starting `open`, with no completion or
 * verification fields) and its audit fact in one transaction.
 *
 * `incidentId` and `monitoringReadingId` are both optional and independent: an
 * action may hang off an incident, a reading, or neither (a standalone
 * improvement action), so neither link is required. The create is
 * organization-scoped through `input.organizationId` (`DEC-061`).
 */
export async function recordCorrectiveAction(
  store: HmsStore,
  input: RecordCorrectiveActionInput,
): Promise<CorrectiveActionRecord> {
  if (isBlank(input.description)) {
    throw new DomainError("description is required");
  }
  assertOptionalCalendarDate(input.dueDate, "dueDate");

  return store.withTransaction(async (tx) => {
    const action = await tx.createCorrectiveAction({
      organizationId: input.organizationId,
      incidentId: input.incidentId ?? null,
      monitoringReadingId: input.monitoringReadingId ?? null,
      description: input.description.trim(),
      ownerId: input.ownerId ?? null,
      dueDate: input.dueDate ?? null,
      // A new action is always `open`; no completion/verification fields yet.
      status: INITIAL_CORRECTIVE_ACTION_STATUS,
      createdBy: input.actorId,
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: HMS_AUDIT_ACTIONS.correctiveActionCreated,
      entityType: "corrective_action",
      entityId: action.id,
      after: {
        incident_id: action.incidentId,
        monitoring_reading_id: action.monitoringReadingId,
        description: action.description,
        owner_id: action.ownerId,
        due_date: action.dueDate,
        status: action.status,
        completed_at: action.completedAt,
        verified_by: action.verifiedBy,
        verified_at: action.verifiedAt,
      },
    });

    return action;
  });
}
