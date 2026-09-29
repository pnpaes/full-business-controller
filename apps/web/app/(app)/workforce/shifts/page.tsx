import {
  createPostgresInventoryStore,
  createPostgresSchedulingStore,
  createPostgresWorkforceStore,
  listEmployees,
  listLocations,
  listPendingSelfAssignments,
  listPositions,
  listShiftAssignments,
  listShifts,
} from "@aquarela/application";
import {
  DataTable,
  type DataTableColumn,
  EmptyState,
  InfoTip,
  PageHeader,
  SectionCard,
  StatusPill,
  color,
  geometry,
  radius,
  spacing,
  typography,
} from "@aquarela/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getDb } from "../../../../lib/db";
import { resolveOrganization } from "../../../../lib/organization";
import { getServerSession } from "../../../../lib/server-session";
import {
  isWorkforceAuthorized,
  loadWorkforceAccess,
  SHIFT_READ_ROLES,
  SHIFT_WRITE_ROLES,
  WORKFORCE_EMPLOYEE_READ_ROLES,
} from "../../../api/v1/workforce/access";
import {
  dayEndIso,
  dayStartIso,
  formatShiftWindow,
  shiftStateView,
  todayUtcDay,
} from "../workforce-labels";
import { CreateShiftForm } from "./create-shift-form";
import { PendingApprovalActions } from "./pending-approval-actions";
import { RosterFilter } from "./roster-filter";
import { ShiftActions, type AssignableEmployeeOption } from "./shift-actions";
import { WithdrawAssignmentButton } from "./withdraw-assignment-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Roster — Aquarela Business Control" };

/** The roster shows a bounded window; the read API pages beyond it. */
const PAGE_LIMIT = 200;
/** The default roster window length in days. */
const DEFAULT_WINDOW_DAYS = 14;

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

/** Filter link styled as a chip: token surfaces, pill radius, 44px target. */
const filterChipStyle = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: geometry.touchTarget,
  padding: `${spacing[2]}px ${spacing[3]}px`,
  borderRadius: radius.pill,
  border: `1px solid ${color.border.default}`,
  backgroundColor: color.surface.base,
  color: color.ink.secondary,
  fontSize: typography.fontSize.sm,
  textDecoration: "none",
} as const;

const filterChipActiveStyle = {
  ...filterChipStyle,
  backgroundColor: color.accent.soft,
  borderColor: color.accent.deep,
  boxShadow: `inset 0 0 0 1px ${color.accent.deep}`,
  color: color.ink.primary,
  fontWeight: typography.fontWeight.semibold,
} as const;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The roster board (`WF-002`, `DEC-037`/`DEC-102`/`DEC-146`): shifts by date and
 * location with status, the lifecycle actions (publish/complete/cancel), manager
 * assignment, and the pending self-assignment queue with approve/reject controls
 * (employees self-assign from their own `My shifts` view).
 *
 * Reads the same application services and row shapes as
 * `GET /api/v1/workforce/shifts`. Access is the shift matrix row (owner, GM,
 * location manager, kitchen, front of house, finance, admin); writing is
 * narrower (owner/GM/location manager/admin). Assignment names are shown only
 * to callers who may also read employee records — fail-closed for the
 * operational read-only roles.
 */
export default async function RosterPage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly location?: string;
    readonly from?: string;
    readonly to?: string;
  }>;
}) {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const access = await loadWorkforceAccess(session.userId);
  if (!isWorkforceAuthorized(access, SHIFT_READ_ROLES)) {
    return (
      <div style={contentColumn}>
        <PageHeader title="Roster" scope="Workforce" description="Shifts by date and location." />
        <EmptyState title="Not available for your role">
          The roster is limited to owner, general manager, location manager, kitchen, front of
          house, finance and admin. Analyst and purchasing have no access.
        </EmptyState>
      </div>
    );
  }

  const params = await searchParams;
  const today = todayUtcDay();
  const from = DAY.test(params.from ?? "") ? params.from! : today;
  const to = DAY.test(params.to ?? "") ? params.to! : nextUtcDayN(from, DEFAULT_WINDOW_DAYS - 1);
  const rawLocationId = params.location;

  const organizationId = resolveOrganization();
  const schedulingStore = createPostgresSchedulingStore(getDb().db);
  const shifts = await listShifts(schedulingStore, {
    organizationId,
    from: dayStartIso(from),
    to: dayEndIso(to),
    limit: PAGE_LIMIT,
  });

  const allLocations = await listLocations(createPostgresInventoryStore(getDb().db), {
    organizationId,
  });
  const locationLabelById = new Map(
    allLocations.map((location) => [location.id, `${location.code} · ${location.name}`]),
  );

  // `DEC-151`: the roster shows the shift's position, and planning selects one.
  const catalogue = await listPositions(createPostgresWorkforceStore(getDb().db), {
    organizationId,
  });
  const positionNameById = new Map(catalogue.map((position) => [position.id, position.name]));

  // Fail-closed, mirroring the GET route: a scoped caller never sees a shift
  // at another location.
  const scoped =
    access.locationIds.length === 0
      ? shifts
      : shifts.filter((shift) => access.locationIds.includes(shift.locationId));
  const visible =
    rawLocationId !== undefined && access.locationIds.includes(rawLocationId)
      ? scoped.filter((shift) => shift.locationId === rawLocationId)
      : scoped;

  const canWrite = isWorkforceAuthorized(access, SHIFT_WRITE_ROLES);
  const canReadEmployees = isWorkforceAuthorized(access, WORKFORCE_EMPLOYEE_READ_ROLES);

  // Assignment names need employee-record access; without it the roster shows
  // only the assignment state (fail-closed, no name leak).
  const employees: readonly AssignableEmployeeOption[] = canReadEmployees
    ? (
        await listEmployees(createPostgresWorkforceStore(getDb().db), {
          organizationId,
          active: true,
          limit: PAGE_LIMIT,
        })
      )
        .filter(
          (employee) =>
            access.locationIds.length === 0 ||
            (employee.primaryLocationId !== null &&
              access.locationIds.includes(employee.primaryLocationId)),
        )
        .map((employee) => ({
          id: employee.id,
          name: employee.name,
          roleCode: employee.roleCode,
          primaryLocationId: employee.primaryLocationId,
        }))
    : [];
  const employeeNameById = new Map(employees.map((employee) => [employee.id, employee.name]));

  const assignmentsByShift = new Map(
    await Promise.all(
      visible.map(async (shift) => {
        const assignments = await listShiftAssignments(schedulingStore, {
          organizationId,
          shiftId: shift.id,
          limit: 50,
        });
        return [shift.id, assignments] as const;
      }),
    ),
  );

  // The manager review queue (DEC-146): self-originated pending_approval rows.
  // A location-scoped manager sees only their own locations (fail-closed).
  const pendingQueue = canWrite
    ? (
        await listPendingSelfAssignments(schedulingStore, {
          organizationId,
          limit: PAGE_LIMIT,
        })
      ).filter(
        (row) => access.locationIds.length === 0 || access.locationIds.includes(row.locationId),
      )
    : [];

  const writableLocations =
    access.locationIds.length === 0
      ? allLocations
      : allLocations.filter((location) => access.locationIds.includes(location.id));

  const columns: readonly DataTableColumn[] = [
    { key: "shift", header: "Shift (UTC)" },
    { key: "location", header: "Location" },
    { key: "position", header: "Position" },
    { key: "break", header: "Break" },
    { key: "status", header: "Status" },
    { key: "assigned", header: "Assigned" },
    { key: "actions", header: "Actions" },
  ];

  const planAction =
    canWrite && writableLocations.length > 0 ? (
      <CreateShiftForm
        locations={writableLocations.map((location) => ({
          id: location.id,
          code: location.code,
          name: location.name,
        }))}
        positions={catalogue.map((position) => ({
          id: position.id,
          code: position.code,
          name: position.name,
        }))}
        defaultLocationId={
          rawLocationId !== undefined && writableLocations.some((l) => l.id === rawLocationId)
            ? rawLocationId
            : (writableLocations[0]?.id ?? "")
        }
      />
    ) : null;

  return (
    <div style={contentColumn}>
      <PageHeader
        title="Roster"
        scope="Workforce"
        description="Shifts by date and location: plan, publish, assign, complete and cancel (WF-002, WF-003)."
        actions={planAction}
      />

      {canWrite ? (
        <SectionCard
          title="Pending self-assignments"
          meta={
            <>
              {pendingQueue.length} awaiting a decision
              <InfoTip
                label="About pending self-assignments"
                content="An employee self-assigns from My shifts and the request opens here as pending approval. Owner, general manager, location manager and admin decide: approve confirms the assignment against the shift; reject records a required reason and withdraws it."
              />
            </>
          }
        >
          {pendingQueue.length === 0 ? (
            <EmptyState variant="plain" title="No self-assignments awaiting a decision">
              Employee self-assignment requests appear here for approval.
            </EmptyState>
          ) : (
            <div style={tableWrap}>
              <DataTable
                caption="Self-assigned shifts awaiting a manager decision, with approve and reject controls"
                columns={[
                  { key: "employee", header: "Employee" },
                  { key: "shift", header: "Shift (UTC)" },
                  { key: "location", header: "Location" },
                  { key: "role", header: "Role" },
                  { key: "requested", header: "Requested" },
                  { key: "actions", header: "Decision" },
                ]}
                rows={pendingQueue.map((row) => ({
                  id: row.assignmentId,
                  employee: row.employeeName,
                  shift: formatShiftWindow(row.startsAt, row.endsAt),
                  location: locationLabelById.get(row.locationId) ?? row.locationId,
                  role: row.roleCode ?? "Any role",
                  requested: row.assignedAt,
                  actions: <PendingApprovalActions assignmentId={row.assignmentId} />,
                }))}
                emptyMessage="No self-assignments are awaiting a decision."
              />
            </div>
          )}
        </SectionCard>
      ) : null}

      <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2], alignItems: "center" }}>
        {writableLocations.length > 1 ? (
          <Link
            href={`/workforce/shifts?from=${from}&to=${to}`}
            aria-current={rawLocationId === undefined ? "page" : undefined}
            style={rawLocationId === undefined ? filterChipActiveStyle : filterChipStyle}
          >
            All locations
          </Link>
        ) : null}
        {writableLocations
          .filter((location) => location.id !== rawLocationId)
          .map((location) => (
            <Link
              key={location.id}
              href={`/workforce/shifts?from=${from}&to=${to}&location=${location.id}`}
              style={filterChipStyle}
            >
              {location.code}
            </Link>
          ))}
      </div>

      <RosterFilter
        locations={writableLocations.map((location) => ({
          id: location.id,
          code: location.code,
          name: location.name,
        }))}
        locationId={rawLocationId ?? ""}
        from={from}
        to={to}
      />

      <SectionCard
        title="Shifts"
        meta={
          <>
            {visible.length} {visible.length === 1 ? "shift" : "shifts"} · {from} → {to}
            <InfoTip
              label="About the roster window"
              content="The window is UTC calendar days, inclusive of the end day; a shift appears on the day its start instant falls on."
            />
          </>
        }
      >
        <div style={tableWrap}>
          <DataTable
            caption="Shifts by start time with location, position, break, status, assignments and actions"
            columns={columns}
            rows={visible.map((shift) => {
              const status = shiftStateView(shift.state);
              const assignments = assignmentsByShift.get(shift.id) ?? [];
              const liveAssignments = assignments.filter(
                (assignment) => assignment.state === "approved",
              );
              return {
                id: shift.id,
                shift: formatShiftWindow(shift.startsAt, shift.endsAt),
                location: locationLabelById.get(shift.locationId) ?? shift.locationId,
                position:
                  shift.positionId === null
                    ? "Any position"
                    : (positionNameById.get(shift.positionId) ?? shift.positionId),
                break: `${shift.breakMinutes} min`,
                status: <StatusPill tone={status.tone}>{status.label}</StatusPill>,
                assigned:
                  liveAssignments.length === 0
                    ? "—"
                    : canReadEmployees
                      ? liveAssignments
                          .map(
                            (assignment) =>
                              employeeNameById.get(assignment.employeeId) ?? assignment.employeeId,
                          )
                          .join(", ")
                      : `${liveAssignments.length} assigned (names need employee-record access)`,
                actions: (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: spacing[2],
                      alignItems: "flex-start",
                    }}
                  >
                    <ShiftActions
                      shiftId={shift.id}
                      shiftState={shift.state}
                      shiftLocationId={shift.locationId}
                      shiftRoleCode={shift.roleCode}
                      employees={employees}
                      canWrite={canWrite}
                    />
                    {canWrite && shift.state === "assigned"
                      ? liveAssignments.map((assignment) => (
                          <WithdrawAssignmentButton
                            key={assignment.id}
                            assignmentId={assignment.id}
                          />
                        ))
                      : null}
                  </div>
                ),
              };
            })}
            emptyMessage="No shifts in this window. Plan one with Plan shift, or widen the window."
          />
        </div>
      </SectionCard>

      {!canWrite ? (
        <EmptyState title="Planning is not available for your role">
          You can read the roster, but planning, publishing and assignment need owner, general
          manager, location manager or admin.
        </EmptyState>
      ) : writableLocations.length === 0 ? (
        <EmptyState title="Add a location to plan shifts">
          Planning a shift needs a location in your scope. Ask an owner or administrator for a
          location-scoped role, or register a location first.
        </EmptyState>
      ) : null}
    </div>
  );
}

/** `YYYY-MM-DD` + n days → `YYYY-MM-DD` (UTC). */
function nextUtcDayN(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
