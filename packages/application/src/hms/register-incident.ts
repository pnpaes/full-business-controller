import { DomainError } from "@aquarela/domain";
import { INCIDENT_CATEGORY, INCIDENT_SEVERITY } from "@aquarela/persistence";

import { assertIsoInstant, isBlank } from "../inventory/validation";

import { HMS_AUDIT_ACTIONS } from "./actions";
import type { HmsStore, IncidentRecord } from "./types";

/** The `category` vocabulary an incident may hold (`INCIDENT_CATEGORY`). */
export const INCIDENT_CATEGORIES: readonly string[] = INCIDENT_CATEGORY;
/** The `severity` vocabulary (`INCIDENT_SEVERITY`, `DEC-095`). */
export const INCIDENT_SEVERITIES: readonly string[] = INCIDENT_SEVERITY;
/** The status a freshly registered incident starts in. */
export const INITIAL_INCIDENT_STATUS = "open";

/** A `date` column's wire form: `YYYY-MM-DD` with no time part. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `date` columns are carried as `YYYY-MM-DD`. The regex alone accepts an
 * impossible day such as `2026-02-31`, which reaches Postgres as a driver error
 * rather than a `DomainError`, so the day is round-tripped through `Date` too.
 * Null/undefined means "no due date" and is allowed.
 */
export function assertOptionalCalendarDate(value: string | null | undefined, field: string): void {
  if (value === null || value === undefined) {
    return;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    !ISO_DATE.test(value) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new DomainError(`${field} must be a date (YYYY-MM-DD)`);
  }
}

export interface RegisterIncidentInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly locationId: string;
  /** One of `INCIDENT_CATEGORY`. */
  readonly category: string;
  /** One of `INCIDENT_SEVERITY`. */
  readonly severity: string;
  /** ISO instant the incident occurred at (not the report time). */
  readonly occurredAt: string;
  /** ISO instant the incident was reported at. */
  readonly reportedAt: string;
  readonly reportedBy: string;
  readonly ownerId?: string | null;
  readonly title: string;
  readonly description?: string | null;
  /** `date`, `YYYY-MM-DD`, or null; the target resolution day. */
  readonly dueDate?: string | null;
  readonly involvesPersonalData: boolean;
}

/**
 * Registers one incident (`HMS-003`, `DEC-090`): validates the vocabulary, the
 * required text and the instants, then creates the incident (starting `open`,
 * with a null `closed_at`) and its audit fact in one transaction. The create is
 * organization-scoped through `input.organizationId` (`DEC-061`).
 *
 * `category`/`severity`/`status` have database checks too
 * (`hms_incident_category_check`, `hms_incident_severity_check`,
 * `hms_incident_status_check`), but they are enforced here so the fake-store
 * unit suite and the API see one error class (`DomainError`) with a readable
 * message rather than a driver constraint violation.
 */
export async function registerIncident(
  store: HmsStore,
  input: RegisterIncidentInput,
): Promise<IncidentRecord> {
  if (isBlank(input.locationId)) {
    throw new DomainError("locationId is required");
  }
  if (isBlank(input.title)) {
    throw new DomainError("title is required");
  }
  if (isBlank(input.reportedBy)) {
    throw new DomainError("reportedBy is required");
  }
  if (!INCIDENT_CATEGORIES.includes(input.category)) {
    throw new DomainError(`category must be one of ${INCIDENT_CATEGORIES.join(", ")}`);
  }
  if (!INCIDENT_SEVERITIES.includes(input.severity)) {
    throw new DomainError(`severity must be one of ${INCIDENT_SEVERITIES.join(", ")}`);
  }
  assertIsoInstant(input.occurredAt, "occurredAt");
  assertIsoInstant(input.reportedAt, "reportedAt");
  assertOptionalCalendarDate(input.dueDate, "dueDate");

  return store.withTransaction(async (tx) => {
    const incident = await tx.createIncident({
      organizationId: input.organizationId,
      locationId: input.locationId,
      category: input.category,
      severity: input.severity,
      occurredAt: input.occurredAt,
      reportedAt: input.reportedAt,
      reportedBy: input.reportedBy,
      ownerId: input.ownerId ?? null,
      title: input.title.trim(),
      description: input.description ?? null,
      dueDate: input.dueDate ?? null,
      involvesPersonalData: input.involvesPersonalData,
      // A new incident is always `open`; `closed_at` follows from the status.
      status: INITIAL_INCIDENT_STATUS,
      createdBy: input.actorId,
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: HMS_AUDIT_ACTIONS.incidentCreated,
      entityType: "hms_incident",
      entityId: incident.id,
      after: {
        location_id: incident.locationId,
        category: incident.category,
        severity: incident.severity,
        occurred_at: incident.occurredAt,
        reported_at: incident.reportedAt,
        reported_by: incident.reportedBy,
        owner_id: incident.ownerId,
        title: incident.title,
        due_date: incident.dueDate,
        involves_personal_data: incident.involvesPersonalData,
        status: incident.status,
        closed_at: incident.closedAt,
      },
    });

    return incident;
  });
}
