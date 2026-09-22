import { DomainError } from "@aquarela/domain";

import { assertIsoInstant, isBlank } from "../inventory/validation";

import { HMS_AUDIT_ACTIONS } from "./actions";
import { listChecklistRuns } from "./list-checklist-runs";
import { listCorrectiveActions } from "./list-corrective-actions";
import { listEquipment } from "./list-equipment";
import { listIncidents } from "./list-incidents";
import { listMaintenanceLogs } from "./list-maintenance-logs";
import { listMonitoringPoints } from "./list-monitoring-points";
import { listMonitoringReadings } from "./list-monitoring-readings";
import type {
  ChecklistRunRecord,
  CorrectiveActionRecord,
  HmsStore,
  IncidentRecord,
  MaintenanceLogRecord,
  MonitoringReadingRecord,
} from "./types";

/**
 * Hard ceiling on each source in one compliance/evidence export bundle. A source
 * that hits it is reported as `truncated` rather than silently shortened.
 */
export const COMPLIANCE_EXPORT_MAX_PER_SOURCE = 5000;

/** The five sources an export covers, in bundle order (`snake_case` for the audit fact). */
export const COMPLIANCE_EXPORT_SOURCES = [
  "monitoring_readings",
  "incidents",
  "corrective_actions",
  "checklist_runs",
  "maintenance_logs",
] as const;

/**
 * The bundle fields that carry personal data, named by their source column (the
 * `snake_case` audit convention). This is the contract a future minimisation
 * pass (`DEC-098` item 5; `07_SECURITY_AND_NFR.md` §7.4) shrinks — **no
 * minimisation is applied in this increment**: every field below is returned
 * verbatim and the privacy review is the blocker.
 */
export const COMPLIANCE_EXPORT_PERSONAL_DATA_FIELDS = [
  "reported_by",
  "recorded_by",
  "owner_id",
  "performed_by",
  "verified_by",
  "involves_personal_data",
] as const;

export interface BuildComplianceExportQuery {
  readonly organizationId: string;
  readonly actorId: string;
  /** Inclusive lower bound; an ISO instant. Omit for open-ended. */
  readonly from?: string;
  /** Inclusive upper bound; an ISO instant. Omit for open-ended. */
  readonly to?: string;
  /**
   * The caller's location scope. `undefined` **or an empty list** means
   * organization-wide — the repo convention is "empty scope =
   * organization-wide" (an unscoped caller has no location rows;
   * `apps/web/app/api/v1/hms/access.ts`). A non-empty list restricts every
   * source to those locations. Explicit `undefined` is accepted (the route
   * forwards it for an unscoped caller), so the field allows it.
   */
  readonly locationIds?: readonly string[] | undefined;
}

/** The plain, serialisable bundle `buildComplianceExport` returns. */
export interface ComplianceExportBundle {
  /** `timestamptz`, ISO: when the bundle was assembled. */
  readonly generatedAt: string;
  readonly organizationId: string;
  readonly period: {
    readonly from: string | null;
    readonly to: string | null;
  };
  /**
   * The bundle fields that carry personal data (see
   * `COMPLIANCE_EXPORT_PERSONAL_DATA_FIELDS`). Present so a future minimisation
   * pass has a contract to shrink; **no minimisation is applied in this
   * increment** (`DEC-098` item 5, pending the privacy review).
   */
  readonly personalDataFields: readonly string[];
  readonly counts: {
    readonly monitoringReadings: number;
    readonly incidents: number;
    readonly correctiveActions: number;
    readonly checklistRuns: number;
    readonly maintenanceLogs: number;
  };
  readonly truncated: {
    readonly monitoringReadings: boolean;
    readonly incidents: boolean;
    readonly correctiveActions: boolean;
    readonly checklistRuns: boolean;
    readonly maintenanceLogs: boolean;
  };
  readonly monitoringReadings: readonly MonitoringReadingRecord[];
  readonly incidents: readonly IncidentRecord[];
  readonly correctiveActions: readonly CorrectiveActionRecord[];
  readonly checklistRuns: readonly ChecklistRunRecord[];
  readonly maintenanceLogs: readonly MaintenanceLogRecord[];
}

/**
 * Cap a source at the export ceiling. `truncated` is the caller's honest
 * completeness signal: true when the source **may** be missing in-scope rows —
 * either its own raw DB read filled its window, or a parent list feeding its
 * scoping filled its own window. It is deliberately **conservative**: `true` does
 * not mean exactly `MAX` rows were returned, only that more may exist. That is
 * the safe direction for a regulator-facing completeness attestation.
 */
function bounded<T>(
  rows: readonly T[],
  truncated: boolean,
): {
  readonly rows: readonly T[];
  readonly truncated: boolean;
} {
  if (rows.length <= COMPLIANCE_EXPORT_MAX_PER_SOURCE) {
    return { rows, truncated };
  }
  return { rows: rows.slice(0, COMPLIANCE_EXPORT_MAX_PER_SOURCE), truncated: true };
}

/**
 * Assembles a serialisable compliance/evidence export bundle from the five HMS
 * sources — monitoring readings, incidents, corrective actions, checklist runs
 * and maintenance logs (`DEC-093`; maintenance is included per `HMS-007` as
 * clarified by `DEC-098`), each organization-scoped (`DEC-061`), period-bounded
 * (inclusive `from`/`to`) and capped at `COMPLIANCE_EXPORT_MAX_PER_SOURCE` with a
 * per-source `truncated` flag. `truncated` is conservative: it is `true` when a
 * raw DB read filled its window **or** a parent list feeding a source's scoping
 * filled its own window, so `true` means "in-scope rows may be missing", not
 * "exactly `MAX` were returned" (see `bounded`). Records are the existing view
 * shapes, so provenance is carried by their ids (`monitoringPointId`,
 * `incidentId`, `templateId`, `equipmentId`, and a maintenance log's evidence
 * `fileObjectId`).
 *
 * Personal data: the bundle carries actor ids and the `involvesPersonalData`
 * flag verbatim. `personalDataFields` names them as the contract a future
 * minimisation pass shrinks (`DEC-098` item 5, `07_SECURITY_AND_NFR.md` §7.4);
 * **no minimisation is applied in this increment** — the privacy review is the
 * blocker.
 *
 * No file bytes, storage client or signed URL are involved: the storage
 * integration is deferred by `DEC-085`. Exactly one audit fact is appended, with
 * the actor, the selected scope, the period, the included sources and the counts
 * (`hms.compliance_export.generated`) — an export is a sensitive read.
 *
 * Location scope: the rows that carry `location_id` (`monitoring_point`,
 * `hms_incident`, `checklist_run`, `equipment`) are filtered on it. Readings are
 * scoped through their `monitoring_point`; corrective actions and maintenance
 * logs have **no** `location_id` and are scoped through their parent
 * (`incident_id` / `equipment_id`) by collecting the in-scope parent ids first
 * and filtering the children to that set — a reading-linked or standalone
 * corrective action therefore falls outside a scoped export.
 */
export async function buildComplianceExport(
  store: HmsStore,
  query: BuildComplianceExportQuery,
): Promise<ComplianceExportBundle> {
  if (isBlank(query.organizationId)) {
    throw new DomainError("organizationId is required");
  }
  if (isBlank(query.actorId)) {
    throw new DomainError("actorId is required");
  }
  if (query.from !== undefined) {
    assertIsoInstant(query.from, "from");
  }
  if (query.to !== undefined) {
    assertIsoInstant(query.to, "to");
  }
  if (
    query.from !== undefined &&
    query.to !== undefined &&
    Date.parse(query.from) > Date.parse(query.to)
  ) {
    throw new DomainError("from must be on or before to");
  }

  const { organizationId, from, to } = query;
  // Repo convention: an empty scope list means "organization-wide" (an unscoped
  // caller has no location rows — `apps/web/app/api/v1/hms/access.ts`), so an
  // empty `locationIds` is treated exactly like `undefined`. Both the route and
  // this query apply the rule, so neither layer can reintroduce the bug.
  const scopeSet =
    query.locationIds === undefined || query.locationIds.length === 0
      ? undefined
      : new Set(query.locationIds);
  const scoped = scopeSet !== undefined;
  const inScope = (locationId: string): boolean =>
    scopeSet === undefined || scopeSet.has(locationId);

  // Read one row more than the ceiling so a raw window that filled is
  // detectable. `truncated` is then computed conservatively (see `bounded`).
  const window = COMPLIANCE_EXPORT_MAX_PER_SOURCE + 1;
  /** True when a raw DB read filled its `window`: more matching rows may exist. */
  const windowFilled = <T>(rows: readonly T[]): boolean => rows.length >= window;
  const period =
    from === undefined && to === undefined
      ? {}
      : {
          ...(from === undefined ? {} : { from }),
          ...(to === undefined ? {} : { to }),
        };

  // `due_date` is a calendar day, so the corrective-action window takes the
  // leading `YYYY-MM-DD` day of each ISO instant bound (inclusive); the
  // application date bound stays a `YYYY-MM-DD` string. The slice is literal (no
  // timezone conversion), so `2026-02-01T00:30:00+02:00` resolves to the day
  // `2026-02-01` even though its UTC instant is `2026-01-31T22:30Z` — the
  // deterministic, offset-independent behaviour the tests pin.
  const dayPeriod =
    from === undefined && to === undefined
      ? {}
      : {
          ...(from === undefined ? {} : { from: from.slice(0, 10) }),
          ...(to === undefined ? {} : { to: to.slice(0, 10) }),
        };

  // ponytail: one org-scoped list call per source, then in-memory scope filter —
  // no location join. The ceiling: a scoped export can return a short page when
  // out-of-scope rows fill the `window` before in-scope ones (same recorded
  // point as the checklist multi-location filter); that case is now reported as
  // `truncated`. Upgrade path: a `locationIds` filter (or a location-joined
  // query) on the list repositories.
  const parentPoints = scoped
    ? await listMonitoringPoints(store, { organizationId, limit: window })
    : undefined;
  const pointIds =
    parentPoints === undefined
      ? undefined
      : new Set(parentPoints.filter((point) => inScope(point.locationId)).map((point) => point.id));

  const rawReadings = await listMonitoringReadings(store, {
    organizationId,
    ...period,
    limit: window,
  });
  const monitoringReadings = bounded(
    rawReadings.filter(
      (reading) => pointIds === undefined || pointIds.has(reading.monitoringPointId),
    ),
    windowFilled(rawReadings) || (parentPoints !== undefined && windowFilled(parentPoints)),
  );

  const rawIncidents = await listIncidents(store, { organizationId, ...period, limit: window });
  const filteredIncidents = rawIncidents.filter((incident) => inScope(incident.locationId));
  // Built from the filtered (pre-cap) list, not the capped output: an in-scope
  // incident beyond the ceiling must still contribute its corrective actions.
  const incidentIds = new Set(filteredIncidents.map((incident) => incident.id));
  const incidents = bounded(filteredIncidents, windowFilled(rawIncidents));

  const rawCorrectiveActions = await listCorrectiveActions(store, {
    organizationId,
    ...dayPeriod,
    limit: window,
  });
  const correctiveActions = bounded(
    rawCorrectiveActions.filter(
      (action) => !scoped || (action.incidentId !== null && incidentIds.has(action.incidentId)),
    ),
    // Scoped only: a filled incident window means some in-scope incidents — and
    // so their actions — may be missing.
    windowFilled(rawCorrectiveActions) || (scoped && windowFilled(rawIncidents)),
  );

  const rawChecklistRuns = await listChecklistRuns(store, {
    organizationId,
    ...period,
    limit: window,
  });
  const checklistRuns = bounded(
    rawChecklistRuns.filter((run) => inScope(run.locationId)),
    windowFilled(rawChecklistRuns),
  );

  const rawEquipment = await listEquipment(store, { organizationId, limit: window });
  const filteredEquipment = rawEquipment.filter((row) => inScope(row.locationId));
  // Again from the filtered (pre-cap) list, so a surviving equipment row still
  // contributes its maintenance logs.
  const equipmentIds = new Set(filteredEquipment.map((row) => row.id));

  const rawMaintenanceLogs = await listMaintenanceLogs(store, {
    organizationId,
    ...period,
    limit: window,
  });
  const maintenanceLogs = bounded(
    rawMaintenanceLogs.filter((log) => !scoped || equipmentIds.has(log.equipmentId)),
    windowFilled(rawMaintenanceLogs) || (scoped && windowFilled(rawEquipment)),
  );

  const bundle: ComplianceExportBundle = {
    generatedAt: new Date().toISOString(),
    organizationId,
    period: { from: from ?? null, to: to ?? null },
    personalDataFields: [...COMPLIANCE_EXPORT_PERSONAL_DATA_FIELDS],
    counts: {
      monitoringReadings: monitoringReadings.rows.length,
      incidents: incidents.rows.length,
      correctiveActions: correctiveActions.rows.length,
      checklistRuns: checklistRuns.rows.length,
      maintenanceLogs: maintenanceLogs.rows.length,
    },
    truncated: {
      monitoringReadings: monitoringReadings.truncated,
      incidents: incidents.truncated,
      correctiveActions: correctiveActions.truncated,
      checklistRuns: checklistRuns.truncated,
      maintenanceLogs: maintenanceLogs.truncated,
    },
    monitoringReadings: monitoringReadings.rows,
    incidents: incidents.rows,
    correctiveActions: correctiveActions.rows,
    checklistRuns: checklistRuns.rows,
    maintenanceLogs: maintenanceLogs.rows,
  };

  await store.writeAudit({
    organizationId,
    actorId: query.actorId,
    action: HMS_AUDIT_ACTIONS.complianceExportGenerated,
    entityType: "hms_compliance_export",
    entityId: null,
    after: {
      scope: scopeSet === undefined ? "organization" : [...scopeSet],
      period: { from: bundle.period.from, to: bundle.period.to },
      sources: [...COMPLIANCE_EXPORT_SOURCES],
      counts: {
        monitoring_readings: bundle.counts.monitoringReadings,
        incidents: bundle.counts.incidents,
        corrective_actions: bundle.counts.correctiveActions,
        checklist_runs: bundle.counts.checklistRuns,
        maintenance_logs: bundle.counts.maintenanceLogs,
      },
      truncated: {
        monitoring_readings: bundle.truncated.monitoringReadings,
        incidents: bundle.truncated.incidents,
        corrective_actions: bundle.truncated.correctiveActions,
        checklist_runs: bundle.truncated.checklistRuns,
        maintenance_logs: bundle.truncated.maintenanceLogs,
      },
    },
  });

  return bundle;
}
