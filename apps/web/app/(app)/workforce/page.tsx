import {
  createPostgresInventoryStore,
  createPostgresWorkforceStore,
  EMPLOYMENT_TYPES,
  listEmployees,
  listLocations,
  listPositions,
} from "@aquarela/application";
import { listRoles } from "@aquarela/persistence";
import {
  Alert,
  DataTable,
  type DataTableColumn,
  EmptyState,
  InfoTip,
  PageHeader,
  SectionCard,
  StatusPill,
  formatMoney,
  spacing,
  typography,
} from "@aquarela/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getDb } from "../../../lib/db";
import { resolveOrganization } from "../../../lib/organization";
import { getServerSession } from "../../../lib/server-session";
import {
  isWorkforceAuthorized,
  loadWorkforceAccess,
  WORKFORCE_EMPLOYEE_READ_ROLES,
  WORKFORCE_EMPLOYEE_WRITE_ROLES,
} from "../../api/v1/workforce/access";
import { employmentTypeLabel } from "./workforce-labels";
import { RegisterEmployeeForm } from "./register-employee-form";
import { RegisterFilters } from "./register-filters";

export const dynamic = "force-dynamic";
export const metadata = { title: "Employees — Aquarela Business Control" };

/** The register shows a bounded working set; the read API pages beyond it. */
const PAGE_LIMIT = 200;

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

/** A column header with an adjacent (i) explanation. */
const headerWithTip = {
  display: "inline-flex",
  alignItems: "center",
  gap: spacing[1],
} as const;

const SHOW_FILTERS = ["active", "retired", "all"] as const;
type ShowFilter = (typeof SHOW_FILTERS)[number];

function readShow(raw: string | undefined): ShowFilter {
  return SHOW_FILTERS.find((candidate) => candidate === raw) ?? "active";
}

/**
 * The employee register (`WF-001`, `WF-007`): the role/location-aware list of
 * employees linking to the employee detail, where amending and retirement live.
 *
 * Reads the same application service and row shape as
 * `GET /api/v1/workforce/employees`. Access is the `employee` matrix row
 * (owner / general_manager / location_manager / finance / admin); anyone else
 * gets an explicit "not available" state, never an empty register. A
 * location-scoped caller sees only employees whose primary location is non-null
 * and in scope (fail-closed, `isEmployeeInLocationScope`).
 */
export default async function WorkforcePage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly location?: string; readonly show?: string }>;
}) {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const access = await loadWorkforceAccess(session.userId);
  if (!isWorkforceAuthorized(access, WORKFORCE_EMPLOYEE_READ_ROLES)) {
    return (
      <div style={contentColumn}>
        <PageHeader
          title="Employees"
          scope="Workforce"
          description="The employee register and personnel documents."
        />
        <EmptyState title="Not available for your role">
          The employee register is limited to owner, general manager, location manager, finance and
          admin. Analyst, kitchen, front of house and purchasing have no access.
        </EmptyState>
      </div>
    );
  }

  const params = await searchParams;
  const show = readShow(params.show);
  const rawLocationId = params.location;

  const organizationId = resolveOrganization();
  const store = createPostgresWorkforceStore(getDb().db);
  const employees = await listEmployees(store, {
    organizationId,
    ...(show === "active" ? { active: true } : {}),
    ...(show === "retired" ? { retired: true } : {}),
    limit: PAGE_LIMIT,
  });

  const allLocations = await listLocations(createPostgresInventoryStore(getDb().db), {
    organizationId,
  });
  const locationLabelById = new Map(
    allLocations.map((location) => [location.id, `${location.code} · ${location.name}`]),
  );

  // `DEC-151`: the employee form's fixed role select (the organization's roles)
  // and the open position catalogue it may grant from.
  const roles = await listRoles(getDb().db, organizationId);
  const positions = await listPositions(store, { organizationId, active: true });

  // Fail-closed, mirroring the GET route: a scoped caller never sees an
  // employee whose primary location is null or outside their scope.
  const scoped =
    access.locationIds.length === 0
      ? employees
      : employees.filter(
          (employee) =>
            employee.primaryLocationId !== null &&
            access.locationIds.includes(employee.primaryLocationId),
        );
  const visible =
    rawLocationId !== undefined && access.locationIds.includes(rawLocationId)
      ? scoped.filter((employee) => employee.primaryLocationId === rawLocationId)
      : scoped;

  const canWrite = isWorkforceAuthorized(access, WORKFORCE_EMPLOYEE_WRITE_ROLES);
  const writableLocations =
    access.locationIds.length === 0
      ? allLocations
      : allLocations.filter((location) => access.locationIds.includes(location.id));

  const columns: readonly DataTableColumn[] = [
    { key: "name", header: "Name" },
    { key: "role", header: "Role" },
    {
      key: "employment",
      header: (
        <span style={headerWithTip}>
          Employment
          <InfoTip
            content="Full time or part time — the employment type recorded on the employee's profile."
            label="What employment type means"
          />
        </span>
      ),
    },
    {
      key: "rate",
      header: (
        <span style={headerWithTip}>
          Base rate (NOK/h)
          <InfoTip
            content="The employee's base hourly rate in NOK per hour. The payroll report prices worked hours at this rate."
            label="What the base rate is"
          />
        </span>
      ),
    },
    { key: "location", header: "Primary location" },
    { key: "activeFrom", header: "Active from" },
    {
      key: "status",
      header: (
        <span style={headerWithTip}>
          Status
          <InfoTip
            content="Employees are retired, never deleted: retirement stamps a retirement date, drops the employee from the active register and from shift assignment, and keeps the record and its history. Open the employee to retire them."
            label="What active or retired means"
          />
        </span>
      ),
    },
  ];

  return (
    <div style={contentColumn}>
      <PageHeader
        title="Employees"
        scope="Workforce"
        description="The employee register: profiles, terms and personnel documents. Employees are retired, never deleted."
        {...(canWrite
          ? {
              actions: (
                <RegisterEmployeeForm
                  employmentTypes={EMPLOYMENT_TYPES}
                  locations={writableLocations.map((location) => ({
                    id: location.id,
                    code: location.code,
                    name: location.name,
                  }))}
                  roles={roles.map((role) => ({ code: role.code, name: role.name }))}
                  positions={positions.map((position) => ({
                    id: position.id,
                    code: position.code,
                    name: position.name,
                  }))}
                  canWrite={canWrite}
                />
              ),
            }
          : {})}
      />

      {!canWrite ? (
        <Alert tone="info" title="Read-only register">
          Registering an employee needs an employee-write role (owner, general manager, location
          manager, finance or admin). You can still browse the register.
        </Alert>
      ) : null}

      <RegisterFilters
        show={show}
        locationId={rawLocationId ?? null}
        locations={writableLocations.map((location) => ({
          id: location.id,
          code: location.code,
          name: location.name,
        }))}
      />

      <SectionCard
        title="Register"
        meta={`${visible.length} ${visible.length === 1 ? "employee" : "employees"}`}
      >
        {visible.length === 0 ? (
          <EmptyState variant="plain" title="No employees match">
            No employee matches the current status and location filter.{" "}
            {canWrite
              ? "Register one with “New employee”, or clear the filters."
              : "Clear the filters to see the register."}
          </EmptyState>
        ) : (
          <div style={tableWrap}>
            <DataTable
              caption="Employees with role, employment type, base hourly rate, primary location and retirement status; open a row to amend or retire the employee"
              columns={columns}
              rowHref={(row) => `/workforce/employees/${String(row.id)}`}
              rows={visible.map((employee) => ({
                id: employee.id,
                name: employee.name,
                role: employee.roleCode,
                employment: employmentTypeLabel(employee.employmentType),
                rate: formatMoney(employee.baseHourlyRate),
                location:
                  employee.primaryLocationId === null
                    ? "—"
                    : (locationLabelById.get(employee.primaryLocationId) ??
                      employee.primaryLocationId),
                activeFrom: employee.activeFrom,
                status: (
                  <StatusPill tone={employee.retiredAt === null ? "success" : "warning"}>
                    {employee.retiredAt === null ? "Active" : "Retired"}
                  </StatusPill>
                ),
              }))}
            />
          </div>
        )}
      </SectionCard>

      <Alert tone="info" title="Personnel documents">
        Personnel documents (contracts, certificates, ID documents) are visible on each employee's
        detail page to owner, general manager and admin only. A file chosen when recording a
        document is stored and downloadable from that page; a document recorded without a file is
        metadata-only. Retention is not enforced and file contents are not scanned for malware.
      </Alert>

      <p
        style={{
          margin: 0,
          display: "flex",
          gap: spacing[4],
          fontSize: typography.fontSize.sm,
        }}
      >
        <Link href="/workforce/shifts">Open the roster</Link>
        <Link href="/workforce/my-shifts">My shifts (employee self-service)</Link>
      </p>
    </div>
  );
}
