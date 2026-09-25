import {
  createPostgresFileObjectsStore,
  createPostgresHmsStore,
  createPostgresInventoryStore,
  createPostgresTaskStore,
  findIncident,
  listAssignableUsers,
  listCorrectiveActions,
  listFileObjects,
  listLocations,
} from "@aquarela/application";
import {
  DataTable,
  type DataTableColumn,
  DescriptionList,
  type DescriptionListItem,
  EmptyState,
  PageHeader,
  SectionCard,
  StatusPill,
  spacing,
} from "@aquarela/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getAuthStore } from "../../../../../lib/auth";
import { getDb } from "../../../../../lib/db";
import { resolveOrganization } from "../../../../../lib/organization";
import { getServerSession } from "../../../../../lib/server-session";

import {
  HMS_CORRECTIVE_ACTION_CREATE_ROLES,
  HMS_CORRECTIVE_ACTION_READ_ROLES,
  HMS_INCIDENT_EDIT_ROLES,
  HMS_INCIDENT_READ_ROLES,
  isHmsAuthorized,
  loadHmsAccess,
} from "../../../../api/v1/hms/access";
import {
  correctiveActionStatusView,
  formatHmsDay,
  formatHmsInstant,
  incidentCategoryLabel,
  incidentSeverityView,
  incidentStatusView,
} from "../../hms-labels";
import { AttachEvidenceForm } from "./attach-evidence-form";
import { IncidentUpdateForm } from "./incident-update-form";
import { NewCorrectiveActionForm } from "./new-corrective-action-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Incident detail — Aquarela Business Control" };

const contentColumn = {
  display: "flex",
  flexDirection: "column",
  gap: spacing[6],
  maxWidth: 1120,
  margin: "0 auto",
  padding: `${spacing[8]}px ${spacing[4]}px`,
} as const;

/** Tables scroll inside a labelled region; the page never scrolls sideways. */
const tableWrap = { overflowX: "auto", minWidth: 0 } as const;

/** A compact, exact-enough byte label for an evidence row. */
function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KiB`;
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/**
 * One incident (`HMS-003`, `DEC-090`): the full record, its evidence
 * attachments, its corrective actions and the audited update/close controls for
 * the edit roles. Kitchen/FOH read only (`DEC-095`).
 *
 * Evidence is wired to the `DEC-132` port (`DEC-134`): the polymorphic
 * `hms_incident` link (`DEC-095`) is listed here through `listFileObjects` and
 * each attachment is downloadable, while an edit-role caller can attach a new
 * photo or report. The list is metadata only; the bytes stream from the
 * download route.
 */
export default async function IncidentDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const access = await loadHmsAccess(session.userId);
  if (!isHmsAuthorized(access, HMS_INCIDENT_READ_ROLES)) {
    return (
      <div style={contentColumn}>
        <PageHeader title="Incident" scope="HMS" />
        <EmptyState title="Not available for your role">
          Analyst, purchasing and finance have no access to incidents (DEC-095).
        </EmptyState>
      </div>
    );
  }

  const { id } = await params;
  const organizationId = resolveOrganization();
  const store = createPostgresHmsStore(getDb().db);
  const incident = await findIncident(store, { organizationId, incidentId: id });

  if (incident === undefined || incident.organizationId !== organizationId) {
    return (
      <div style={contentColumn}>
        <PageHeader title="Incident" scope="HMS" />
        <EmptyState title="Incident not found">
          No incident with this id exists in your organization. It may have been raised at another
          organization, or the link is stale.
        </EmptyState>
      </div>
    );
  }

  if (access.locationIds.length > 0 && !access.locationIds.includes(incident.locationId)) {
    return (
      <div style={contentColumn}>
        <PageHeader title="Incident" scope="HMS" />
        <EmptyState title="Outside your location scope">
          This incident belongs to a location your role does not cover.
        </EmptyState>
      </div>
    );
  }

  const actions = await listCorrectiveActions(store, {
    organizationId,
    incidentId: incident.id,
    limit: 200,
  });

  const evidence = await listFileObjects(createPostgresFileObjectsStore(getDb().db), {
    organizationId,
    linkedEntityType: "hms_incident",
    linkedEntityId: incident.id,
    limit: 200,
  });

  const allLocations = await listLocations(createPostgresInventoryStore(getDb().db), {
    organizationId,
  });
  const locationLabelById = new Map(
    allLocations.map((location) => [location.id, `${location.code} · ${location.name}`]),
  );

  const actorIds = [
    ...new Set(
      [
        incident.ownerId,
        incident.reportedBy,
        incident.createdBy,
        ...actions.flatMap((action) => [action.ownerId, action.verifiedBy]),
      ].filter((actorId): actorId is string => actorId !== null),
    ),
  ];
  const actors = await Promise.all(actorIds.map((actorId) => getAuthStore().findUserById(actorId)));
  const actorLabelById = new Map(
    actorIds.map((actorId, index) => {
      const actor = actors[index];
      return [
        actorId,
        actor === undefined ? actorId : (actor.email ?? actor.username ?? actorId),
      ] as const;
    }),
  );

  const status = incidentStatusView(incident.status);
  const severity = incidentSeverityView(incident.severity);

  const facts: readonly DescriptionListItem[] = [
    { term: "Status", description: <StatusPill tone={status.tone}>{status.label}</StatusPill> },
    {
      term: "Severity",
      description: <StatusPill tone={severity.tone}>{severity.label}</StatusPill>,
    },
    { term: "Category", description: incidentCategoryLabel(incident.category) },
    {
      term: "Location",
      description: locationLabelById.get(incident.locationId) ?? incident.locationId,
    },
    { term: "Occurred at", description: formatHmsInstant(incident.occurredAt) },
    { term: "Reported at", description: formatHmsInstant(incident.reportedAt) },
    {
      term: "Reported by",
      description: actorLabelById.get(incident.reportedBy) ?? incident.reportedBy,
    },
    {
      term: "Owner",
      description:
        incident.ownerId === null
          ? "Unassigned"
          : (actorLabelById.get(incident.ownerId) ?? incident.ownerId),
    },
    { term: "Due date", description: formatHmsDay(incident.dueDate) },
    {
      term: "Personal data",
      description: incident.involvesPersonalData ? "Yes — handle per GDPR" : "No",
    },
    ...(incident.closedAt === null
      ? []
      : [{ term: "Closed at", description: formatHmsInstant(incident.closedAt) }]),
  ];

  const columns: readonly DataTableColumn[] = [
    { key: "description", header: "Action" },
    { key: "status", header: "Status" },
    { key: "owner", header: "Owner" },
    { key: "due", header: "Due" },
    { key: "verified", header: "Verified" },
  ];

  const evidenceColumns: readonly DataTableColumn[] = [
    { key: "file", header: "File" },
    { key: "type", header: "Type" },
    { key: "size", header: "Size" },
    { key: "uploaded", header: "Uploaded" },
  ];

  const canEdit = isHmsAuthorized(access, HMS_INCIDENT_EDIT_ROLES, incident.locationId);
  const canCreateAction = isHmsAuthorized(
    access,
    HMS_CORRECTIVE_ACTION_CREATE_ROLES,
    incident.locationId,
  );
  // The owner picker's options are the organization's active users (the same
  // candidate-assignee read the task picker uses). An owner who is no longer
  // active stays listed so the current assignment is not silently rewritten.
  const ownerOptions =
    canEdit || canCreateAction
      ? (await listAssignableUsers(createPostgresTaskStore(getDb().db), { organizationId })).map(
          (user) => ({
            id: user.id,
            label:
              user.username === null ? user.displayName : `${user.displayName} · ${user.username}`,
          }),
        )
      : [];
  if (
    canEdit &&
    incident.ownerId !== null &&
    !ownerOptions.some((option) => option.id === incident.ownerId)
  ) {
    ownerOptions.push({
      id: incident.ownerId,
      label: actorLabelById.get(incident.ownerId) ?? incident.ownerId,
    });
  }
  const canReadActions = isHmsAuthorized(access, HMS_CORRECTIVE_ACTION_READ_ROLES);

  return (
    <div style={contentColumn}>
      <PageHeader
        title={incident.title}
        scope="HMS · Incident"
        {...(incident.description === null ? {} : { description: incident.description })}
      />

      <SectionCard title="Incident record" meta={`Raised ${formatHmsInstant(incident.createdAt)}`}>
        <DescriptionList items={facts} />
      </SectionCard>

      {canEdit ? (
        <IncidentUpdateForm
          incidentId={incident.id}
          owners={ownerOptions}
          current={{
            status: incident.status,
            severity: incident.severity,
            title: incident.title,
            description: incident.description,
            dueDate: incident.dueDate,
            ownerId: incident.ownerId,
          }}
        />
      ) : (
        <SectionCard title="Update or close" meta="edit roles only">
          <EmptyState title="Editing is not available for your role">
            Kitchen and front of house can raise and read incidents but not update or close them
            (DEC-095). Closing is an audited management action.
          </EmptyState>
        </SectionCard>
      )}

      <SectionCard
        title="Evidence"
        meta={`${evidence.length} ${evidence.length === 1 ? "attachment" : "attachments"}`}
      >
        <div style={tableWrap}>
          <DataTable
            caption="Photos and reports attached to this incident"
            columns={evidenceColumns}
            rowHref={(row) =>
              `/api/v1/hms/incidents/${incident.id}/evidence/${String(row.id)}/file`
            }
            rows={evidence.map((file) => ({
              id: file.id,
              file: file.filename,
              type: file.mime,
              size: formatBytes(file.sizeBytes),
              uploaded: formatHmsInstant(file.uploadedAt),
            }))}
            emptyMessage="No evidence attached yet. A manager or admin can attach a photo or a report below."
          />
        </div>
      </SectionCard>

      {canEdit ? <AttachEvidenceForm incidentId={incident.id} /> : null}

      {canReadActions ? (
        <SectionCard
          title="Corrective actions"
          meta={`${actions.length} linked ${actions.length === 1 ? "action" : "actions"}`}
          actions={<Link href="/hms/corrective-actions">All actions</Link>}
        >
          <div style={tableWrap}>
            <DataTable
              caption="Corrective actions linked to this incident"
              columns={columns}
              rowHref={(row) => `/hms/corrective-actions#action-${String(row.id)}`}
              rows={actions.map((action) => {
                const actionStatus = correctiveActionStatusView(action.status);
                return {
                  id: action.id,
                  description: action.description,
                  status: <StatusPill tone={actionStatus.tone}>{actionStatus.label}</StatusPill>,
                  owner:
                    action.ownerId === null
                      ? "—"
                      : (actorLabelById.get(action.ownerId) ?? action.ownerId),
                  due: formatHmsDay(action.dueDate),
                  verified:
                    action.verifiedAt === null
                      ? "—"
                      : `${formatHmsInstant(action.verifiedAt)} by ${
                          actorLabelById.get(action.verifiedBy ?? "") ?? action.verifiedBy ?? "—"
                        }`,
                };
              })}
              emptyMessage="No corrective actions linked yet. Add one below so the incident has a tracked fix."
            />
          </div>
        </SectionCard>
      ) : null}

      {canCreateAction ? (
        <NewCorrectiveActionForm incidentId={incident.id} owners={ownerOptions} />
      ) : null}
    </div>
  );
}
