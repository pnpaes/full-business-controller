import {
  createPostgresInventoryStore,
  createPostgresSchedulingStore,
  findSelfEmployee,
  listAvailableShifts,
  listLocations,
  listMyShifts,
} from "@aquarela/application";
import {
  Alert,
  DataTable,
  type DataTableColumn,
  EmptyState,
  PageHeader,
  SectionCard,
  StatusPill,
  spacing,
  typography,
} from "@aquarela/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getDb } from "../../../../lib/db";
import { resolveOrganization } from "../../../../lib/organization";
import { getServerSession } from "../../../../lib/server-session";
import { assignmentStateView, formatShiftWindow } from "../workforce-labels";
import { SelfAssignButton } from "./self-assign-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "My shifts — Aquarela Business Control" };

/** The view shows a bounded working set. */
const PAGE_LIMIT = 200;

const contentColumn = {
  display: "flex",
  flexDirection: "column",
  gap: spacing[6],
  maxWidth: 1120,
  margin: "0 auto",
  padding: `${spacing[8]}px ${spacing[4]}px`,
} as const;

const tableWrap = { overflowX: "auto", minWidth: 0 } as const;

/**
 * The employee self-service view (`WF-003`, `DEC-146`): a linked employee sees
 * their own shifts (including `pending_approval` requests) and may self-assign
 * an `open`/`published` shift at their primary location and matching role,
 * subject to the weekly maximum. A signed-in account with no employee link (or
 * an ambiguous one) sees an explicit refusal, never an empty page pretending to
 * be their rota.
 */
export default async function MyShiftsPage() {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const organizationId = resolveOrganization();
  const schedulingStore = createPostgresSchedulingStore(getDb().db);

  const employee = await findSelfEmployee(schedulingStore, {
    organizationId,
    actorUserId: session.userId,
  });
  if (employee === undefined) {
    return (
      <div style={contentColumn}>
        <PageHeader title="My shifts" scope="Workforce" description="Your own shifts." />
        <EmptyState title="Not available for your account">
          This view is for employees whose login is linked to an employee record. Ask a manager to
          link your account, or open the roster if you have shift access.
        </EmptyState>
      </div>
    );
  }

  const own = await listMyShifts(schedulingStore, {
    organizationId,
    actorUserId: session.userId,
  });

  // `DEC-151`: the server offers only `open`/`published` shifts at the
  // employee's primary location whose position they hold (or with no position),
  // excluding shifts they already asked for.
  const available = await listAvailableShifts(schedulingStore, {
    organizationId,
    actorUserId: session.userId,
    limit: PAGE_LIMIT,
  });

  const locations = await listLocations(createPostgresInventoryStore(getDb().db), {
    organizationId,
  });
  const locationLabelById = new Map(
    locations.map((location) => [location.id, `${location.code} · ${location.name}`]),
  );

  const ownColumns: readonly DataTableColumn[] = [
    { key: "shift", header: "Shift (UTC)" },
    { key: "location", header: "Location" },
    { key: "position", header: "Position" },
    { key: "status", header: "Status" },
  ];

  const availableColumns: readonly DataTableColumn[] = [
    { key: "shift", header: "Shift (UTC)" },
    { key: "location", header: "Location" },
    { key: "position", header: "Position" },
    { key: "actions", header: "Actions" },
  ];

  return (
    <div style={contentColumn}>
      <PageHeader
        title="My shifts"
        scope="Workforce"
        description="Your own shifts and the shifts you may self-assign (WF-003). Self-assignment is subject to manager approval and a weekly maximum."
      />

      <Alert tone="info" title="Manager approval required">
        A self-assignment opens as <strong>awaiting approval</strong>; a manager approves or rejects
        it. The weekly maximum of self-assigned shifts is enforced server-side (default 2).
      </Alert>

      <SectionCard
        title="My shifts"
        meta={`${own.length} ${own.length === 1 ? "assignment" : "assignments"}`}
      >
        <div style={tableWrap}>
          <DataTable
            caption="Your own shift assignments with their approval status"
            columns={ownColumns}
            rows={own.map((row) => {
              const state = assignmentStateView(row.assignmentState);
              return {
                id: row.assignmentId,
                shift: formatShiftWindow(row.startsAt, row.endsAt),
                location: locationLabelById.get(row.locationId) ?? row.locationId,
                position: row.positionName ?? "Any position",
                status: <StatusPill tone={state.tone}>{state.label}</StatusPill>,
              };
            })}
            emptyMessage="You have no shifts assigned yet."
          />
        </div>
      </SectionCard>

      <SectionCard
        title="Available to self-assign"
        meta={`${available.length} open ${available.length === 1 ? "shift" : "shifts"} at your location`}
      >
        <div style={tableWrap}>
          <DataTable
            caption="Open shifts at your primary location whose position you hold, which you may self-assign"
            columns={availableColumns}
            rows={available.map((shift) => ({
              id: shift.shiftId,
              shift: formatShiftWindow(shift.startsAt, shift.endsAt),
              location: locationLabelById.get(shift.locationId) ?? shift.locationId,
              position: shift.positionName ?? "Any position",
              actions: <SelfAssignButton shiftId={shift.shiftId} />,
            }))}
            emptyMessage="No open shifts for your positions at your location in the next two weeks."
          />
        </div>
      </SectionCard>

      <p style={{ margin: 0, fontSize: typography.fontSize.sm }}>
        <Link href="/workforce/shifts">Open the roster</Link> if your role may plan shifts.
      </p>
    </div>
  );
}
