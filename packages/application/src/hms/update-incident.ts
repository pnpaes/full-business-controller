import { DomainError, NotFoundError } from "@aquarela/domain";
import { INCIDENT_STATUS } from "@aquarela/persistence";

import { isBlank } from "../inventory/validation";

import { HMS_AUDIT_ACTIONS } from "./actions";
import { INCIDENT_SEVERITIES, assertOptionalCalendarDate } from "./register-incident";
import type { HmsStore, IncidentRecord } from "./types";

/** The `status` vocabulary (`INCIDENT_STATUS`). */
export const INCIDENT_STATUSES: readonly string[] = INCIDENT_STATUS;

export interface UpdateIncidentInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly incidentId: string;
  /** One of `INCIDENT_STATUS`. */
  readonly status?: string;
  /** One of `INCIDENT_SEVERITY`. */
  readonly severity?: string;
  /** `null` clears the optional owner. */
  readonly ownerId?: string | null;
  /** `date`, `YYYY-MM-DD`, or null to clear it. */
  readonly dueDate?: string | null;
  /** Non-empty; trimmed. Omitted leaves the title unchanged. */
  readonly title?: string;
  /** `null` clears the description. */
  readonly description?: string | null;
}

/** Patch field → audit payload key, so `before`/`after` share one shape. */
const AUDIT_FIELDS = {
  status: "status",
  severity: "severity",
  ownerId: "owner_id",
  dueDate: "due_date",
  title: "title",
  description: "description",
} as const;

/**
 * Amends or closes one incident (`HMS-003`, `DEC-090`). The incident is loaded
 * organization-scoped first (`DEC-061`; a missing or cross-organization id is a
 * typed `NotFoundError`), then the patch is validated: `status` and `severity`
 * are checked against their vocabularies and `title` must stay non-empty.
 *
 * `closed_at` is derived and kept coherent with `status`: it is set on the
 * transition into `closed` and cleared when the status moves away, so a
 * reopened incident no longer carries a close instant. The update and its audit
 * fact — `hms.incident.closed` when the patch makes the close transition,
 * `hms.incident.updated` otherwise — commit or roll back together.
 */
export async function updateIncident(
  store: HmsStore,
  input: UpdateIncidentInput,
): Promise<IncidentRecord> {
  if (isBlank(input.incidentId)) {
    throw new DomainError("incidentId is required");
  }

  return store.withTransaction(async (tx) => {
    const incident = await tx.findIncident({
      organizationId: input.organizationId,
      incidentId: input.incidentId.trim(),
    });
    if (incident === undefined) {
      throw new NotFoundError("incident not found in organization");
    }

    const mutable: {
      status?: string;
      severity?: string;
      ownerId?: string | null;
      dueDate?: string | null;
      title?: string;
      description?: string | null;
      closedAt?: string | null;
    } = {};

    if (input.status !== undefined) {
      if (!INCIDENT_STATUSES.includes(input.status)) {
        throw new DomainError(`status must be one of ${INCIDENT_STATUSES.join(", ")}`);
      }
      mutable.status = input.status;
      // `closed_at` is non-null iff the incident is `closed`; clear it on any
      // move away from `closed` so the invariant survives a reopen. Closing an
      // already-closed incident preserves the original instant — the close is
      // idempotent, so a second close must not move it.
      mutable.closedAt =
        input.status === "closed"
          ? incident.status === "closed"
            ? incident.closedAt
            : new Date().toISOString()
          : null;
    }
    if (input.severity !== undefined) {
      if (!INCIDENT_SEVERITIES.includes(input.severity)) {
        throw new DomainError(`severity must be one of ${INCIDENT_SEVERITIES.join(", ")}`);
      }
      mutable.severity = input.severity;
    }
    if (input.title !== undefined) {
      if (isBlank(input.title)) {
        throw new DomainError("title is required");
      }
      mutable.title = input.title.trim();
    }
    if (input.ownerId !== undefined) {
      mutable.ownerId = input.ownerId;
    }
    if (input.dueDate !== undefined) {
      assertOptionalCalendarDate(input.dueDate, "dueDate");
      mutable.dueDate = input.dueDate;
    }
    if (input.description !== undefined) {
      mutable.description = input.description;
    }

    if (Object.keys(mutable).length === 0) {
      throw new DomainError("no updatable fields provided");
    }

    const updated = await tx.updateIncident({
      organizationId: input.organizationId,
      incidentId: incident.id,
      ...mutable,
      updatedBy: input.actorId,
    });
    if (updated === undefined) {
      throw new NotFoundError("incident not found in organization");
    }

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const field of Object.keys(AUDIT_FIELDS) as (keyof typeof AUDIT_FIELDS)[]) {
      if (mutable[field] === undefined) continue;
      before[AUDIT_FIELDS[field]] = incident[field];
      after[AUDIT_FIELDS[field]] = updated[field];
    }

    const closing = mutable.status === "closed" && incident.status !== "closed";
    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: closing ? HMS_AUDIT_ACTIONS.incidentClosed : HMS_AUDIT_ACTIONS.incidentUpdated,
      entityType: "hms_incident",
      entityId: updated.id,
      before,
      after,
    });

    return updated;
  });
}
