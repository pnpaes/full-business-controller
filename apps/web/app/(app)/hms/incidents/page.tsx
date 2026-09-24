import {
  createPostgresHmsStore,
  createPostgresInventoryStore,
  listIncidents,
  listLocations,
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
import Link from "next/link";
import { redirect } from "next/navigation";

import { getAuthStore } from "../../../../lib/auth";
import { getDb } from "../../../../lib/db";
import { resolveOrganization } from "../../../../lib/organization";
import { getServerSession } from "../../../../lib/server-session";

import {
  HMS_INCIDENT_CREATE_ROLES,
  HMS_INCIDENT_READ_ROLES,
  isHmsAuthorized,
  loadHmsAccess,
} from "../../../api/v1/hms/access";
import {
  formatHmsDay,
  formatHmsInstant,
  incidentCategoryLabel,
  incidentSeverityView,
  incidentStatusView,
} from "../hms-labels";
import { NewIncidentForm } from "./new-incident-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "HMS incidents — Aquarela Business Control" };

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

const STATUS_FILTERS = ["open", "investigating", "resolved", "closed"] as const;

const filterChipStyle = {
  padding: `${spacing[2]}px ${spacing[3]}px`,
  borderRadius: 999,
  border: "1px solid currentColor",
  fontSize: 13,
  textDecoration: "none",
} as const;

/**
 * The HMS incident register (`HMS-003`, `DEC-090`, `DEC-095`): the list by
 * status/location with owner, due date and severity, plus the raise-incident
 * form for the create roles. Kitchen/front_of_house may raise and read but not
 * edit or close — the detail page offers no edit controls to them.
 *
 * Reads the same application service and row shape as
 * `GET /api/v1/hms/incidents`. **Evidence is metadata-only (`DEC-085`/`DEC-090`):**
 * `file_object` has no application port, so an incident carries no photo/file
 * here — the detail page says so where a photo would be expected.
 */
export default async function HmsIncidentsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly status?: string; readonly locationId?: string }>;
}) {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const access = await loadHmsAccess(session.userId);
  if (!isHmsAuthorized(access, HMS_INCIDENT_READ_ROLES)) {
    return (
      <div style={contentColumn}>
        <PageHeader
          title="Incidents"
          scope="HMS"
          description="The food-safety incident register."
        />
        <EmptyState title="Not available for your role">
          The incident register is limited to owner, general manager, location manager, kitchen,
          front of house and admin. Analyst, purchasing and finance have no access (DEC-095).
        </EmptyState>
      </div>
    );
  }

  const params = await searchParams;
  const status = STATUS_FILTERS.find((candidate) => candidate === params.status);
  const rawLocationId = params.locationId;

  const organizationId = resolveOrganization();
  const store = createPostgresHmsStore(getDb().db);
  const incidents = await listIncidents(store, {
    organizationId,
    ...(status === undefined ? {} : { status }),
    limit: PAGE_LIMIT,
  });

  const allLocations = await listLocations(createPostgresInventoryStore(getDb().db), {
    organizationId,
  });
  const scopedLocationIds =
    access.locationIds.length > 0
      ? access.locationIds
      : allLocations.map((location) => location.id);
  const visibleLocations = allLocations.filter((location) =>
    scopedLocationIds.includes(location.id),
  );
  const locationLabelById = new Map(
    allLocations.map((location) => [location.id, `${location.code} · ${location.name}`]),
  );

  const visible = incidents.filter((incident) => scopedLocationIds.includes(incident.locationId));
  const filtered =
    rawLocationId !== undefined && scopedLocationIds.includes(rawLocationId)
      ? visible.filter((incident) => incident.locationId === rawLocationId)
      : visible;

  // Resolve owners/reporters to a profile label; an unresolved id stays itself.
  const actorIds = [
    ...new Set(
      filtered.flatMap((incident) =>
        [incident.ownerId, incident.reportedBy].filter((id): id is string => id !== null),
      ),
    ),
  ];
  const actors = await Promise.all(actorIds.map((id) => getAuthStore().findUserById(id)));
  const actorLabelById = new Map(
    actorIds.map((id, index) => {
      const actor = actors[index];
      return [id, actor === undefined ? id : (actor.email ?? actor.username ?? id)] as const;
    }),
  );

  const columns: readonly DataTableColumn[] = [
    { key: "title", header: "Title" },
    { key: "category", header: "Category" },
    { key: "severity", header: "Severity" },
    { key: "status", header: "Status" },
    { key: "location", header: "Location" },
    { key: "owner", header: "Owner" },
    { key: "due", header: "Due" },
    { key: "occurred", header: "Occurred" },
  ];

  const canCreate = isHmsAuthorized(access, HMS_INCIDENT_CREATE_ROLES);

  return (
    <div style={contentColumn}>
      <PageHeader
        title="Incidents"
        scope="HMS"
        description="The food-safety incident register: raise, investigate and close incidents with their corrective actions (DEC-090, DEC-095)."
      />

      <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2], alignItems: "center" }}>
        <Link
          href="/hms/incidents"
          style={{ ...filterChipStyle, fontWeight: status === undefined ? 600 : 400 }}
        >
          All
        </Link>
        {STATUS_FILTERS.map((candidate) => (
          <Link
            key={candidate}
            href={`/hms/incidents?status=${candidate}`}
            style={{
              ...filterChipStyle,
              fontWeight: status === candidate ? 600 : 400,
            }}
          >
            {incidentStatusView(candidate).label}
          </Link>
        ))}
      </div>

      <SectionCard
        title="Incidents"
        meta={`${filtered.length} ${filtered.length === 1 ? "incident" : "incidents"}`}
      >
        <DataTable
          caption="Incidents by status, severity, location, owner and due date"
          columns={columns}
          rowHref={(row) => `/hms/incidents/${String(row.id)}`}
          rows={filtered.map((incident) => ({
            id: incident.id,
            title: incident.title,
            category: incidentCategoryLabel(incident.category),
            severity: (
              <StatusPill tone={incidentSeverityView(incident.severity).tone}>
                {incidentSeverityView(incident.severity).label}
              </StatusPill>
            ),
            status: (
              <StatusPill tone={incidentStatusView(incident.status).tone}>
                {incidentStatusView(incident.status).label}
              </StatusPill>
            ),
            location: locationLabelById.get(incident.locationId) ?? incident.locationId,
            owner:
              incident.ownerId === null
                ? "—"
                : (actorLabelById.get(incident.ownerId) ?? incident.ownerId),
            due: formatHmsDay(incident.dueDate),
            occurred: formatHmsInstant(incident.occurredAt),
          }))}
          emptyMessage="No incidents match. Raise one below if something happened, or clear the filters."
        />
      </SectionCard>

      {canCreate ? (
        <NewIncidentForm
          locations={visibleLocations.map((location) => ({
            id: location.id,
            label: `${location.code} · ${location.name}`,
          }))}
        />
      ) : (
        <SectionCard title="Raise an incident" meta="create roles only">
          <EmptyState title="Creating is not available for your role">
            You can read and follow incidents, but raising one needs owner, general manager,
            location manager, kitchen or front of house.
          </EmptyState>
        </SectionCard>
      )}
    </div>
  );
}
