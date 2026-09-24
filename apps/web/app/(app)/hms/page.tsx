import {
  createPostgresHmsStore,
  createPostgresInventoryStore,
  listLocations,
  listMonitoringPoints,
  listMonitoringReadings,
} from "@aquarela/application";
import {
  DataTable,
  type DataTableColumn,
  EmptyState,
  PageHeader,
  SectionCard,
  StatusPill,
  spacing,
} from "@aquarela/ui";
import { redirect } from "next/navigation";

import { getDb } from "../../../lib/db";
import { resolveOrganization } from "../../../lib/organization";
import { getServerSession } from "../../../lib/server-session";

import {
  HMS_READ_ROLES,
  HMS_RECORD_ROLES,
  isHmsAuthorized,
  loadHmsAccess,
} from "../../api/v1/hms/access";
import { ReadingEntryForm } from "./reading-entry-form";
import {
  checkFrequencyLabel,
  formatAge,
  formatHmsInstant,
  frequencyWindowHours,
  monitoringPointKindLabel,
} from "./hms-labels";

export const dynamic = "force-dynamic";
export const metadata = { title: "HMS monitoring log — Aquarela Business Control" };

/** The register/history show a bounded working set; the read API pages beyond it. */
const PAGE_LIMIT = 200;

const contentColumn = {
  display: "flex",
  flexDirection: "column",
  gap: spacing[6],
  width: "100%",
  maxWidth: 1120,
  margin: "0 auto",
  padding: `${spacing[8]}px ${spacing[4]}px`,
} as const;

interface PointRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly kindLabel: string;
  readonly targetLabel: string;
  readonly frequencyLabel: string;
  readonly locationId: string;
  readonly active: boolean;
  /** Label of the newest reading, or why there is none. */
  readonly lastReadingLabel: string;
  /** `null` when the cadence has no window (`other`) or the point is inactive. */
  readonly overdue: boolean | null;
}

interface ReadingRow {
  readonly id: string;
  readonly pointLabel: string;
  readonly valueLabel: string;
  readonly inRange: boolean;
  readonly measuredAtLabel: string;
  readonly notes: string | null;
}

/**
 * The HMS monitoring log (`HMS-002`, `DEC-089`): monitoring points with their
 * target ranges, fast reading entry for the operational roles, in/out-of-range
 * status, the recent reading history and a cadence-based overdue cue.
 *
 * Reads the same application services and row shapes as
 * `GET /api/v1/hms/monitoring-points` and `GET .../[id]/readings`, so the screen
 * and the API cannot drift. Access is the monitoring read role set; a caller
 * outside it gets an explicit "not available" state. Location-scoped callers
 * only see their locations (the same in-memory filter the list route applies).
 *
 * **Append-only readings (`DEC-089`):** a reading's value/unit/measured_at are
 * immutable, so the history offers no edit — only the entry form appends.
 * **Overdue is a presentation heuristic:** the backend records no due instant,
 * so a point is flagged when its newest reading is older than the cadence window
 * (`frequencyWindowHours`); it is a cue, not a compliance verdict.
 */
export default async function HmsMonitoringPage() {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const access = await loadHmsAccess(session.userId);
  if (!isHmsAuthorized(access, HMS_READ_ROLES)) {
    return (
      <div style={contentColumn}>
        <PageHeader
          title="HMS monitoring log"
          scope="HMS"
          description="Food-safety monitoring points, readings and overdue cues."
        />
        <EmptyState title="Not available for your role">
          The monitoring log is limited to the monitoring roles (owner, general manager, location
          manager, kitchen, front of house, admin and analyst). Purchasing and finance have no
          access. Ask an owner or administrator if you need access.
        </EmptyState>
      </div>
    );
  }

  const organizationId = resolveOrganization();
  const store = createPostgresHmsStore(getDb().db);
  const points = await listMonitoringPoints(store, {
    organizationId,
    limit: PAGE_LIMIT,
  });
  const visiblePoints =
    access.locationIds.length > 0
      ? points.filter((point) => access.locationIds.includes(point.locationId))
      : points;

  const readings = await listMonitoringReadings(store, {
    organizationId,
    limit: PAGE_LIMIT,
  });
  const visibleReadings =
    access.locationIds.length > 0
      ? readings.filter((reading) =>
          visiblePoints.some((point) => point.id === reading.monitoringPointId),
        )
      : readings;

  const allLocations = await listLocations(createPostgresInventoryStore(getDb().db), {
    organizationId,
  });
  const locationLabelById = new Map(
    allLocations.map((location) => [location.id, `${location.code} · ${location.name}`]),
  );

  const pointLabelById = new Map(
    visiblePoints.map((point) => [point.id, `${point.code} · ${point.name}`]),
  );
  const lastReadingByPoint = new Map<string, (typeof visibleReadings)[number]>();
  for (const reading of visibleReadings) {
    // Newest first from the store, so the first seen per point is the newest.
    if (!lastReadingByPoint.has(reading.monitoringPointId)) {
      lastReadingByPoint.set(reading.monitoringPointId, reading);
    }
  }

  const now = Date.now();
  const pointRows: PointRow[] = visiblePoints.map((point) => {
    const last = lastReadingByPoint.get(point.id);
    const windowHours = point.active ? frequencyWindowHours(point.checkFrequency) : null;
    const overdue =
      windowHours === null || last === undefined
        ? windowHours === null
          ? null
          : true
        : now - Date.parse(last.measuredAt) > windowHours * 3600000;
    return {
      id: point.id,
      code: point.code,
      name: point.name,
      kindLabel: monitoringPointKindLabel(point.kind),
      targetLabel: `${point.targetMin} – ${point.targetMax} ${point.unit}`,
      frequencyLabel: checkFrequencyLabel(point.checkFrequency),
      locationId: point.locationId,
      active: point.active,
      lastReadingLabel:
        last === undefined
          ? "No readings yet"
          : `${last.value} ${last.unit} · ${formatAge(last.measuredAt, now)}`,
      overdue,
    };
  });

  const readingRows: ReadingRow[] = visibleReadings.map((reading) => ({
    id: reading.id,
    pointLabel: pointLabelById.get(reading.monitoringPointId) ?? reading.monitoringPointId,
    valueLabel: `${reading.value} ${reading.unit}`,
    inRange: reading.inRange,
    measuredAtLabel: formatHmsInstant(reading.measuredAt),
    notes: reading.notes,
  }));

  const pointColumns: readonly DataTableColumn[] = [
    { key: "code", header: "Code" },
    { key: "name", header: "Name" },
    { key: "kind", header: "Kind" },
    { key: "target", header: "Target range" },
    { key: "frequency", header: "Cadence" },
    { key: "location", header: "Location" },
    { key: "last", header: "Last reading" },
    { key: "status", header: "Cadence status" },
  ];

  const readingColumns: readonly DataTableColumn[] = [
    { key: "point", header: "Point" },
    { key: "value", header: "Value" },
    { key: "status", header: "Verdict" },
    { key: "measuredAt", header: "Measured at" },
    { key: "notes", header: "Notes" },
  ];

  const canRecord = isHmsAuthorized(access, HMS_RECORD_ROLES);
  const recordablePoints = visiblePoints.filter((point) => point.active);
  const overdueCount = pointRows.filter((row) => row.overdue === true).length;

  return (
    <div style={contentColumn}>
      <PageHeader
        title="HMS monitoring log"
        scope="HMS"
        description="Food-safety monitoring points with target ranges, fast reading entry, in/out-of-range status and cadence-based overdue cues (DEC-089)."
      />

      {canRecord ? (
        <ReadingEntryForm
          points={recordablePoints.map((point) => ({
            id: point.id,
            label: `${point.code} · ${point.name}`,
            unit: point.unit,
            targetMin: point.targetMin,
            targetMax: point.targetMax,
          }))}
        />
      ) : (
        <SectionCard
          title="Record a reading"
          meta="owner, general manager, location manager, kitchen, front of house"
        >
          <EmptyState title="Recording is not available for your role">
            Recording a reading needs owner, general manager, location manager, kitchen or front of
            house. You can still read the points and history below.
          </EmptyState>
        </SectionCard>
      )}

      <SectionCard
        title="Monitoring points"
        meta={`${pointRows.length} ${pointRows.length === 1 ? "point" : "points"} · ${overdueCount} overdue`}
      >
        <DataTable
          caption="Monitoring points with target ranges and cadence status"
          columns={pointColumns}
          rows={pointRows.map((row) => ({
            code: row.code,
            name: row.name,
            kind: row.kindLabel,
            target: row.targetLabel,
            frequency: row.frequencyLabel,
            location: locationLabelById.get(row.locationId) ?? row.locationId,
            last: row.lastReadingLabel,
            status:
              row.overdue === null ? (
                <span style={{ color: "inherit" }}>No window</span>
              ) : row.overdue ? (
                <StatusPill tone="danger">Overdue</StatusPill>
              ) : (
                <StatusPill tone="success">On cadence</StatusPill>
              ),
          }))}
          emptyMessage="No monitoring points yet. Register one through the API or ask an owner to set the first point up."
        />
      </SectionCard>

      <SectionCard
        title="Reading history"
        meta={`${readingRows.length} recent ${readingRows.length === 1 ? "reading" : "readings"} · newest first`}
      >
        <DataTable
          caption="Recent monitoring readings, newest first; values are append-only (DEC-089)"
          columns={readingColumns}
          rows={readingRows.map((row) => ({
            point: row.pointLabel,
            value: row.valueLabel,
            status: row.inRange ? (
              <StatusPill tone="success">In range</StatusPill>
            ) : (
              <StatusPill tone="danger">Out of range</StatusPill>
            ),
            measuredAt: row.measuredAtLabel,
            notes: row.notes ?? "—",
          }))}
          emptyMessage="No readings recorded yet. Use the entry form above to log the first one."
        />
      </SectionCard>
    </div>
  );
}
