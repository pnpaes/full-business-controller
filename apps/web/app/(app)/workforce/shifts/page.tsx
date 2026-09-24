import {
  createPostgresInventoryStore,
  createPostgresSchedulingStore,
  createPostgresWorkforceStore,
  listEmployees,
  listLocations,
  listShiftAssignments,
  listShifts,
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
  width: "100%",
  maxWidth: 1120,
  margin: "0 auto",
  padding: `${spacing[8]}px ${spacing[4]}px`,
} as const;

const filterChipStyle = {
  padding: `${spacing[2]}px ${spacing[3]}px`,
  borderRadius: 999,
  border: "1px solid currentColor",
  fontSize: 13,
  textDecoration: "none",
} as const;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The roster board (`WF-002`, `DEC-037`/`DEC-102`): shifts by date and
 * location with status, the lifecycle actions (publish/complete/cancel) and
 **manager assignment only** — self-assignment is deferred pending the WF-003
 * login model (DEC-102), stated on the page rather than implied.
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

  const writableLocations =
    access.locationIds.length === 0
      ? allLocations
      : allLocations.filter((location) => access.locationIds.includes(location.id));

  const columns: readonly DataTableColumn[] = [
    { key: "shift", header: "Shift (UTC)" },
    { key: "location", header: "Location" },
    { key: "role", header: "Role" },
    { key: "break", header: "Break" },
    { key: "status", header: "Status" },
    { key: "assigned", header: "Assigned" },
    { key: "actions", header: "Actions" },
  ];

  return (
    <div style={contentColumn}>
      <PageHeader
        title="Roster"
        scope="Workforce"
        description="Shifts by date and location: plan, publish, assign, complete and cancel (WF-002, WF-003)."
      />

      <Alert tone="info" title="Manager assignment only">
        Assignment is a manager action (owner, general manager, location manager, admin).
        Self-assignment is <strong>deferred</strong> pending the WF-003 login-model owner input
        (DEC-102) — there is no self-assign control anywhere in this screen.
      </Alert>

      <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2], alignItems: "center" }}>
        {writableLocations.length > 1 ? (
          <Link
            href={`/workforce/shifts?from=${from}&to=${to}`}
            style={{ ...filterChipStyle, fontWeight: rawLocationId === undefined ? 600 : 400 }}
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
              style={{
                ...filterChipStyle,
                fontWeight: rawLocationId === location.id ? 600 : 400,
              }}
            >
              {location.code}
            </Link>
          ))}
        <span style={{ fontSize: 13, opacity: 0.75 }}>
          Window {from} → {to} (UTC days).
        </span>
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
        meta={`${visible.length} ${visible.length === 1 ? "shift" : "shifts"} · ${from} → ${to}`}
      >
        <DataTable
          caption="Shifts by start time with location, role, break, status, assignments and actions"
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
              role: shift.roleCode ?? "Any role",
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
          emptyMessage="No shifts in this window. Plan one below, or widen the window."
        />
      </SectionCard>

      {canWrite ? (
        <CreateShiftForm
          locations={writableLocations.map((location) => ({
            id: location.id,
            code: location.code,
            name: location.name,
          }))}
          defaultLocationId={
            rawLocationId !== undefined && writableLocations.some((l) => l.id === rawLocationId)
              ? rawLocationId
              : (writableLocations[0]?.id ?? "")
          }
        />
      ) : (
        <SectionCard title="Plan a shift" meta="write roles only">
          <EmptyState title="Planning is not available for your role">
            You can read the roster, but planning, publishing and assignment need owner, general
            manager, location manager or admin.
          </EmptyState>
        </SectionCard>
      )}
    </div>
  );
}

/** `YYYY-MM-DD` + n days → `YYYY-MM-DD` (UTC). */
function nextUtcDayN(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
