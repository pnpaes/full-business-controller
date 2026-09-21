import type { AuditInput } from "../auth";

/**
 * Application-level ports and DTOs for the HMS monitoring slice (`HMS-002`,
 * `DEC-089`).
 *
 * `monitoring_point` carries `organization_id` directly, so every read and write
 * takes the organization and is scoped by it (`DEC-061`). `timestamptz` columns
 * are carried as ISO strings, like the other slices; `target_min`/`target_max`
 * and a reading's `value` stay decimal strings at quantity scale
 * (`numeric(19,6)` — decimal only, never floats). `unit` is provisional free text
 * (`DEC-071`): the measured-unit set has no closed vocabulary yet.
 */

/** One `monitoring_point` row. */
export interface MonitoringPointRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly locationId: string;
  readonly storageAreaId: string | null;
  readonly code: string;
  readonly name: string;
  readonly kind: string;
  readonly unit: string;
  /** numeric(19,6); inclusive lower bound. */
  readonly targetMin: string;
  /** numeric(19,6); inclusive upper bound. */
  readonly targetMax: string;
  readonly checkFrequency: string;
  readonly active: boolean;
  /** `timestamptz`, ISO. */
  readonly createdAt: string;
  readonly createdBy: string | null;
}

export interface NewMonitoringPointRecord {
  readonly organizationId: string;
  readonly locationId: string;
  readonly storageAreaId: string | null;
  readonly code: string;
  readonly name: string;
  readonly kind: string;
  readonly unit: string;
  /** numeric(19,6). */
  readonly targetMin: string;
  /** numeric(19,6). */
  readonly targetMax: string;
  readonly checkFrequency: string;
  readonly createdBy: string | null;
}

/**
 * The mutable fields of a monitoring point. `code` is immutable (the
 * `(organization_id, code)` key must not move), so a correction changes the
 * name, vocabulary, targets, location/storage area or `active` only. `undefined`
 * means "leave as is"; `storageAreaId: null` clears the optional area.
 */
export interface MonitoringPointPatch {
  readonly name?: string;
  readonly kind?: string;
  readonly unit?: string;
  /** numeric(19,6). */
  readonly targetMin?: string;
  /** numeric(19,6). */
  readonly targetMax?: string;
  readonly checkFrequency?: string;
  readonly locationId?: string;
  readonly storageAreaId?: string | null;
  readonly active?: boolean;
}

/** An organization-scoped patch of one point by id (`DEC-061`). */
export interface UpdateMonitoringPointRecord extends MonitoringPointPatch {
  readonly organizationId: string;
  readonly monitoringPointId: string;
}

/**
 * One `monitoring_reading` row — an append-only fact (the `0038` trigger): only
 * `notes` may be amended after the insert. `inRange` is the caller-derived
 * verdict stored at record time (domain `isReadingInRange`), so a later change
 * to the point's targets does not rewrite history.
 */
export interface MonitoringReadingRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly monitoringPointId: string;
  /** numeric(19,6). */
  readonly value: string;
  readonly unit: string;
  /** `timestamptz`, ISO: when the measurement was taken. */
  readonly measuredAt: string;
  /** Plain uuid: the `app_user` FK is deferred, like `created_by`. */
  readonly recordedBy: string | null;
  readonly inRange: boolean;
  readonly notes: string | null;
  /** `timestamptz`, ISO. */
  readonly createdAt: string;
}

export interface NewMonitoringReadingRecord {
  readonly organizationId: string;
  readonly monitoringPointId: string;
  /** numeric(19,6). */
  readonly value: string;
  readonly unit: string;
  /** ISO instant. */
  readonly measuredAt: string;
  readonly recordedBy: string | null;
  readonly inRange: boolean;
  readonly notes: string | null;
}

/** Monitoring-point filters for the store read. */
export interface MonitoringPointListQuery {
  readonly organizationId: string;
  readonly locationId?: string;
  /** When true, only `active` points are returned; when omitted, all are. */
  readonly activeOnly?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

/** Reading filters for the store read. */
export interface MonitoringReadingListQuery {
  readonly organizationId: string;
  readonly monitoringPointId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * One `hms_incident` row (`DEC-090`, `HMS-003`). `timestamptz` columns cross the
 * port as ISO strings, `due_date` as a plain `YYYY-MM-DD` day (`date`).
 * `closedAt` is non-null exactly when `status === "closed"` (a derived
 * invariant the commands keep coherent); `reportedBy`/`ownerId` are plain uuids
 * (the `app_user` FK is deferred).
 */
export interface IncidentRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly locationId: string;
  readonly category: string;
  readonly severity: string;
  readonly occurredAt: string;
  readonly reportedAt: string;
  readonly reportedBy: string;
  readonly ownerId: string | null;
  readonly title: string;
  readonly description: string | null;
  /** `date`, `YYYY-MM-DD`, or null. */
  readonly dueDate: string | null;
  readonly involvesPersonalData: boolean;
  readonly status: string;
  /** `timestamptz`, ISO; non-null iff `status === "closed"`. */
  readonly closedAt: string | null;
  /** `timestamptz`, ISO. */
  readonly createdAt: string;
  readonly createdBy: string | null;
  /** The actor of the last amendment, or null before any update. */
  readonly updatedBy?: string | null;
}

export interface NewIncidentRecord {
  readonly organizationId: string;
  readonly locationId: string;
  readonly category: string;
  readonly severity: string;
  /** ISO instant. */
  readonly occurredAt: string;
  /** ISO instant. */
  readonly reportedAt: string;
  readonly reportedBy: string;
  readonly ownerId: string | null;
  readonly title: string;
  readonly description: string | null;
  /** `date`, `YYYY-MM-DD`, or null. */
  readonly dueDate: string | null;
  readonly involvesPersonalData: boolean;
  readonly status: string;
  /** The acting actor; recorded as `created_by`. */
  readonly createdBy: string | null;
}

/** One `hms_incident` patch. Omitted field = unchanged; `null` clears a nullable column. */
export interface IncidentPatch {
  readonly status?: string;
  readonly severity?: string;
  readonly ownerId?: string | null;
  /** `date`, `YYYY-MM-DD`, or null to clear it. */
  readonly dueDate?: string | null;
  readonly title?: string;
  readonly description?: string | null;
  /** Derived companion of `status`: non-null iff `status === "closed"`. */
  readonly closedAt?: string | null;
}

/** An organization-scoped patch of one incident by id (`DEC-061`). */
export interface UpdateIncidentRecord extends IncidentPatch {
  readonly organizationId: string;
  readonly incidentId: string;
  /** The acting actor; recorded as `updated_by`. */
  readonly updatedBy?: string | null;
}

/** Incident filters for the store read. */
export interface IncidentListQuery {
  readonly organizationId: string;
  readonly status?: string;
  readonly locationId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * One `corrective_action` row (`DEC-090`, `HMS-004`). Both links are nullable and
 * independent (an action may hang off an incident, a reading, or neither).
 * Derived invariants the commands keep coherent: `completedAt` is non-null
 * exactly when `status` is `done` or `verified`; `verifiedBy`/`verifiedAt` are
 * non-null exactly when `status === "verified"`.
 */
export interface CorrectiveActionRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly incidentId: string | null;
  readonly monitoringReadingId: string | null;
  readonly description: string;
  readonly ownerId: string | null;
  /** `date`, `YYYY-MM-DD`, or null. */
  readonly dueDate: string | null;
  readonly status: string;
  /** `timestamptz`, ISO; non-null iff `status` is `done` or `verified`. */
  readonly completedAt: string | null;
  readonly verifiedBy: string | null;
  /** `timestamptz`, ISO; non-null iff `status === "verified"`. */
  readonly verifiedAt: string | null;
  /** `timestamptz`, ISO. */
  readonly createdAt: string;
  readonly createdBy: string | null;
  /** The actor of the last amendment, or null before any update. */
  readonly updatedBy?: string | null;
}

export interface NewCorrectiveActionRecord {
  readonly organizationId: string;
  readonly incidentId: string | null;
  readonly monitoringReadingId: string | null;
  readonly description: string;
  readonly ownerId: string | null;
  /** `date`, `YYYY-MM-DD`, or null. */
  readonly dueDate: string | null;
  readonly status: string;
  /** The acting actor; recorded as `created_by`. */
  readonly createdBy: string | null;
}

/** One `corrective_action` patch, with its derived status companions. */
export interface CorrectiveActionPatch {
  readonly status?: string;
  readonly ownerId?: string | null;
  /** `date`, `YYYY-MM-DD`, or null to clear it. */
  readonly dueDate?: string | null;
  readonly description?: string;
  /** Derived companion of `status`: non-null iff `done`/`verified`. */
  readonly completedAt?: string | null;
  /** Derived companion of `status === "verified"`: the acting verifier. */
  readonly verifiedBy?: string | null;
  /** Derived companion of `status === "verified"`. */
  readonly verifiedAt?: string | null;
}

/** An organization-scoped patch of one corrective action by id (`DEC-061`). */
export interface UpdateCorrectiveActionRecord extends CorrectiveActionPatch {
  readonly organizationId: string;
  readonly correctiveActionId: string;
  /** The acting actor; recorded as `updated_by`. */
  readonly updatedBy?: string | null;
}

/** Corrective-action filters for the store read. */
export interface CorrectiveActionListQuery {
  readonly organizationId: string;
  readonly incidentId?: string;
  readonly status?: string;
  readonly ownerId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * One `checklist_template` row (`DEC-091`/`DEC-096`, `HMS-005`). `items` is a
 * jsonb array carried as-is across the port (validated at the command boundary,
 * not re-typed here); `supersedesId` links a revision to the template row it
 * replaces, so a run stays pinned to the exact row it used.
 */
export interface ChecklistTemplateRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly category: string;
  /** Reuses the shared `CHECK_FREQUENCY` vocabulary. */
  readonly frequency: string;
  /** jsonb array of `{ key, label, required? }` items. */
  readonly items: unknown;
  readonly active: boolean;
  readonly supersedesId: string | null;
  /** `timestamptz`, ISO. */
  readonly createdAt: string;
  readonly createdBy: string | null;
  /** The actor of the last amendment, or null before any update. */
  readonly updatedBy?: string | null;
}

export interface NewChecklistTemplateRecord {
  readonly organizationId: string;
  readonly name: string;
  readonly category: string;
  readonly frequency: string;
  readonly items: unknown;
  readonly active: boolean;
  readonly supersedesId: string | null;
  /** The acting actor; recorded as `created_by`. */
  readonly createdBy: string | null;
}

/** One `checklist_template` patch. Omitted field = unchanged. */
export interface ChecklistTemplatePatch {
  readonly name?: string;
  readonly category?: string;
  readonly frequency?: string;
  readonly items?: unknown;
  readonly active?: boolean;
}

/** An organization-scoped patch of one template by id (`DEC-061`). */
export interface UpdateChecklistTemplateRecord extends ChecklistTemplatePatch {
  readonly organizationId: string;
  readonly templateId: string;
  /** The acting actor; recorded as `updated_by`. */
  readonly updatedBy?: string | null;
}

/** Template filters for the store read. */
export interface ChecklistTemplateListQuery {
  readonly organizationId: string;
  readonly category?: string;
  readonly active?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * One `checklist_run` row (`DEC-091`/`DEC-096`, `HMS-005`). There is no
 * completion instant: `runAt` is the run's time and `status` is validated
 * against `CHECKLIST_RUN_STATUS` with no derived companion (unlike the incident
 * close or corrective-action verification).
 */
export interface ChecklistRunRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly templateId: string;
  readonly locationId: string;
  /** `timestamptz`, ISO: when the checklist was walked. */
  readonly runAt: string;
  readonly performedBy: string;
  readonly status: string;
  /** jsonb array of `{ key, outcome, note? }` results. */
  readonly results: unknown;
  readonly notes: string | null;
  /** `timestamptz`, ISO. */
  readonly createdAt: string;
  readonly createdBy: string | null;
  /** The actor of the last amendment, or null before any update. */
  readonly updatedBy?: string | null;
}

export interface NewChecklistRunRecord {
  readonly organizationId: string;
  readonly templateId: string;
  readonly locationId: string;
  /** ISO instant. */
  readonly runAt: string;
  readonly performedBy: string;
  readonly status: string;
  readonly results: unknown;
  readonly notes: string | null;
  /** The acting actor; recorded as `created_by`. */
  readonly createdBy: string | null;
}

/** One `checklist_run` patch. Omitted field = unchanged; `null` clears `notes`. */
export interface ChecklistRunPatch {
  readonly status?: string;
  readonly results?: unknown;
  readonly notes?: string | null;
}

/** An organization-scoped patch of one run by id (`DEC-061`). */
export interface UpdateChecklistRunRecord extends ChecklistRunPatch {
  readonly organizationId: string;
  readonly runId: string;
  /** The acting actor; recorded as `updated_by`. */
  readonly updatedBy?: string | null;
}

/** Run filters for the store read. */
export interface ChecklistRunListQuery {
  readonly organizationId: string;
  readonly templateId?: string;
  readonly locationId?: string;
  readonly status?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface HmsStore {
  /**
   * Binds `fn` to one transaction so a create and its audit fact commit or roll
   * back together.
   */
  withTransaction<T>(fn: (store: HmsStore) => Promise<T>): Promise<T>;
  /** Append-only audit fact; the caller must not pass secrets (ADR-0003 convention). */
  writeAudit(input: AuditInput): Promise<void>;
  createMonitoringPoint(input: NewMonitoringPointRecord): Promise<MonitoringPointRecord>;
  /** One point by id, organization-scoped (`DEC-061`), or `undefined`. */
  findMonitoringPoint(query: {
    readonly organizationId: string;
    readonly monitoringPointId: string;
  }): Promise<MonitoringPointRecord | undefined>;
  /**
   * Applies a patch to one point, organization-scoped (`DEC-061`); `undefined`
   * when no row matches in the organization. `code` is never patchable.
   */
  updateMonitoringPoint(
    input: UpdateMonitoringPointRecord,
  ): Promise<MonitoringPointRecord | undefined>;
  listMonitoringPoints(query: MonitoringPointListQuery): Promise<readonly MonitoringPointRecord[]>;
  recordMonitoringReading(input: NewMonitoringReadingRecord): Promise<MonitoringReadingRecord>;
  listMonitoringReadings(
    query: MonitoringReadingListQuery,
  ): Promise<readonly MonitoringReadingRecord[]>;
  createIncident(input: NewIncidentRecord): Promise<IncidentRecord>;
  /** One incident by id, organization-scoped (`DEC-061`), or `undefined`. */
  findIncident(query: {
    readonly organizationId: string;
    readonly incidentId: string;
  }): Promise<IncidentRecord | undefined>;
  /**
   * Applies a patch to one incident, organization-scoped (`DEC-061`);
   * `undefined` when no row matches in the organization.
   */
  updateIncident(input: UpdateIncidentRecord): Promise<IncidentRecord | undefined>;
  listIncidents(query: IncidentListQuery): Promise<readonly IncidentRecord[]>;
  createCorrectiveAction(input: NewCorrectiveActionRecord): Promise<CorrectiveActionRecord>;
  /** One corrective action by id, organization-scoped (`DEC-061`), or `undefined`. */
  findCorrectiveAction(query: {
    readonly organizationId: string;
    readonly correctiveActionId: string;
  }): Promise<CorrectiveActionRecord | undefined>;
  /**
   * Applies a patch to one corrective action, organization-scoped (`DEC-061`);
   * `undefined` when no row matches in the organization.
   */
  updateCorrectiveAction(
    input: UpdateCorrectiveActionRecord,
  ): Promise<CorrectiveActionRecord | undefined>;
  listCorrectiveActions(
    query: CorrectiveActionListQuery,
  ): Promise<readonly CorrectiveActionRecord[]>;
  createChecklistTemplate(input: NewChecklistTemplateRecord): Promise<ChecklistTemplateRecord>;
  /** One template by id, organization-scoped (`DEC-061`), or `undefined`. */
  findChecklistTemplate(query: {
    readonly organizationId: string;
    readonly templateId: string;
  }): Promise<ChecklistTemplateRecord | undefined>;
  /**
   * Applies a patch to one template, organization-scoped (`DEC-061`);
   * `undefined` when no row matches in the organization. `supersedes_id` is
   * immutable after creation — a new revision is a new row (`HMS-005`).
   */
  updateChecklistTemplate(
    input: UpdateChecklistTemplateRecord,
  ): Promise<ChecklistTemplateRecord | undefined>;
  listChecklistTemplates(
    query: ChecklistTemplateListQuery,
  ): Promise<readonly ChecklistTemplateRecord[]>;
  createChecklistRun(input: NewChecklistRunRecord): Promise<ChecklistRunRecord>;
  /** One run by id, organization-scoped (`DEC-061`), or `undefined`. */
  findChecklistRun(query: {
    readonly organizationId: string;
    readonly runId: string;
  }): Promise<ChecklistRunRecord | undefined>;
  /**
   * Applies a patch to one run, organization-scoped (`DEC-061`); `undefined`
   * when no row matches in the organization. The run's provenance
   * (`template_id`/`location_id`/`run_at`/`performed_by`) is never patchable.
   */
  updateChecklistRun(input: UpdateChecklistRunRecord): Promise<ChecklistRunRecord | undefined>;
  listChecklistRuns(query: ChecklistRunListQuery): Promise<readonly ChecklistRunRecord[]>;
}
