import { createPostgresHmsStore, findIncident, listCorrectiveActions } from "@aquarela/application";
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
  HMS_CORRECTIVE_ACTION_EDIT_ROLES,
  HMS_CORRECTIVE_ACTION_READ_ROLES,
  HMS_CORRECTIVE_ACTION_VERIFY_ROLES,
  isHmsAuthorized,
  loadHmsAccess,
} from "../../../api/v1/hms/access";
import { correctiveActionStatusView, formatHmsDay, formatHmsInstant } from "../hms-labels";
import { CorrectiveActionControls } from "./action-controls";

export const dynamic = "force-dynamic";
export const metadata = { title: "Corrective actions — Aquarela Business Control" };

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

const STATUS_FILTERS = ["open", "in_progress", "done", "verified"] as const;

const filterChipStyle = {
  padding: `${spacing[2]}px ${spacing[3]}px`,
  borderRadius: 999,
  border: "1px solid currentColor",
  fontSize: 13,
  textDecoration: "none",
} as const;

/**
 * The corrective-action register (`HMS-004`, `DEC-090`, `DEC-095`): every action
 * with its incident link, owner, due date and audited completion/verification,
 * plus the progression controls. Operators progress; only manager-level roles
 * verify. Actions carry no location of their own, so the list is not
 * location-filtered beyond what the read role set already gates.
 */
export default async function CorrectiveActionsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly status?: string }>;
}) {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const access = await loadHmsAccess(session.userId);
  if (!isHmsAuthorized(access, HMS_CORRECTIVE_ACTION_READ_ROLES)) {
    return (
      <div style={contentColumn}>
        <PageHeader title="Corrective actions" scope="HMS" />
        <EmptyState title="Not available for your role">
          Analyst, purchasing and finance have no access to corrective actions (DEC-095).
        </EmptyState>
      </div>
    );
  }

  const params = await searchParams;
  const status = STATUS_FILTERS.find((candidate) => candidate === params.status);

  const organizationId = resolveOrganization();
  const store = createPostgresHmsStore(getDb().db);
  const actions = await listCorrectiveActions(store, {
    organizationId,
    ...(status === undefined ? {} : { status }),
    limit: PAGE_LIMIT,
  });

  const incidentIds = [
    ...new Set(
      actions.flatMap((action) => (action.incidentId === null ? [] : [action.incidentId])),
    ),
  ];
  const incidents = await Promise.all(
    incidentIds.map((incidentId) => findIncidentTitle(store, organizationId, incidentId)),
  );
  const incidentTitleById = new Map(incidents);

  const actorIds = [
    ...new Set(
      actions
        .flatMap((action) => [action.ownerId, action.verifiedBy])
        .filter((actorId): actorId is string => actorId !== null),
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

  const columns: readonly DataTableColumn[] = [
    { key: "description", header: "Action" },
    { key: "incident", header: "Incident" },
    { key: "status", header: "Status" },
    { key: "owner", header: "Owner" },
    { key: "due", header: "Due" },
    { key: "completed", header: "Completed" },
    { key: "verified", header: "Verified" },
    { key: "controls", header: "Progress" },
  ];

  const canEdit = isHmsAuthorized(access, HMS_CORRECTIVE_ACTION_EDIT_ROLES);
  const canVerify = isHmsAuthorized(access, HMS_CORRECTIVE_ACTION_VERIFY_ROLES);

  return (
    <div style={contentColumn}>
      <PageHeader
        title="Corrective actions"
        scope="HMS"
        description="Every corrective action with its incident link and audited closure: operators progress an action, a manager verifies it (DEC-090, DEC-095)."
      />

      <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2] }}>
        <Link
          href="/hms/corrective-actions"
          style={{ ...filterChipStyle, fontWeight: status === undefined ? 600 : 400 }}
        >
          All
        </Link>
        {STATUS_FILTERS.map((candidate) => (
          <Link
            key={candidate}
            href={`/hms/corrective-actions?status=${candidate}`}
            style={{ ...filterChipStyle, fontWeight: status === candidate ? 600 : 400 }}
          >
            {correctiveActionStatusView(candidate).label}
          </Link>
        ))}
      </div>

      <SectionCard
        title="Actions"
        meta={`${actions.length} ${actions.length === 1 ? "action" : "actions"}`}
      >
        <DataTable
          caption="Corrective actions with status, owner, due date and audited closure"
          columns={columns}
          rows={actions.map((action) => {
            const actionStatus = correctiveActionStatusView(action.status);
            return {
              id: action.id,
              description: action.description,
              incident:
                action.incidentId === null ? (
                  "—"
                ) : (
                  <Link href={`/hms/incidents/${action.incidentId}`}>
                    {incidentTitleById.get(action.incidentId) ?? "View incident"}
                  </Link>
                ),
              status: <StatusPill tone={actionStatus.tone}>{actionStatus.label}</StatusPill>,
              owner:
                action.ownerId === null
                  ? "—"
                  : (actorLabelById.get(action.ownerId) ?? action.ownerId),
              due: formatHmsDay(action.dueDate),
              completed: action.completedAt === null ? "—" : formatHmsInstant(action.completedAt),
              verified:
                action.verifiedAt === null
                  ? "—"
                  : `${formatHmsInstant(action.verifiedAt)} by ${
                      actorLabelById.get(action.verifiedBy ?? "") ?? action.verifiedBy ?? "—"
                    }`,
              controls: (
                <div id={`action-${action.id}`}>
                  <CorrectiveActionControls
                    actionId={action.id}
                    status={action.status}
                    canEdit={canEdit}
                    canVerify={canVerify}
                  />
                </div>
              ),
            };
          })}
          emptyMessage="No corrective actions match. Actions are added from an incident's detail page."
        />
      </SectionCard>
    </div>
  );
}

async function findIncidentTitle(
  store: ReturnType<typeof createPostgresHmsStore>,
  organizationId: string,
  incidentId: string,
): Promise<readonly [string, string]> {
  const incident = await findIncident(store, { organizationId, incidentId });
  return [incidentId, incident?.title ?? "View incident"] as const;
}
