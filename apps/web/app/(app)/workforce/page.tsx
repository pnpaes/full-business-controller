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
import { RetireEmployeeButton } from "./retire-employee-button";

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

const SHOW_FILTERS = ["active", "retired", "all"] as const;
type ShowFilter = (typeof SHOW_FILTERS)[number];

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

function readShow(raw: string | undefined): ShowFilter {
  return SHOW_FILTERS.find((candidate) => candidate === raw) ?? "active";
}

/**
 * The employee register (`WF-001`, `WF-007`, `DEC-087`/`DEC-099`): the
 * role/location-aware list with register and retire actions, linking to the
 * employee detail.
 *
 * Reads the same application service and row shape as
 * `GET /api/v1/workforce/employees`. Access is the `employee` matrix row
 * (owner / general_manager / location_manager / finance / admin — `DEC-099`
 * item 6); anyone else gets an explicit "not available" state, never an empty
 * register. A location-scoped caller sees only employees whose primary
 * location is non-null and in scope (fail-closed, `isEmployeeInLocationScope`).
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
          admin (DEC-099). Analyst, kitchen, front of house and purchasing have no access.
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
    { key: "employment", header: "Employment" },
    { key: "rate", header: "Base rate (NOK/h)" },
    { key: "location", header: "Primary location" },
    { key: "activeFrom", header: "Active from" },
    { key: "status", header: "Status" },
    { key: "actions", header: "Actions" },
  ];

  return (
    <div style={contentColumn}>
      <PageHeader
        title="Employees"
        scope="Workforce"
        description="The employee register: profiles, terms and personnel documents (WF-001, WF-007). Employees are retired, never deleted."
      />

      <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2], alignItems: "center" }}>
        {SHOW_FILTERS.map((candidate) => (
          <Link
            key={candidate}
            href={`/workforce?show=${candidate}`}
            aria-current={show === candidate ? "page" : undefined}
            style={show === candidate ? filterChipActiveStyle : filterChipStyle}
          >
            {candidate === "active" ? "Active" : candidate === "retired" ? "Retired" : "All"}
          </Link>
        ))}
        {writableLocations.length > 1 ? (
          <Link
            href={`/workforce?show=${show}`}
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
              href={`/workforce?show=${show}&location=${location.id}`}
              style={filterChipStyle}
            >
              {location.code}
            </Link>
          ))}
      </div>

      <SectionCard
        title="Register"
        meta={`${visible.length} ${visible.length === 1 ? "employee" : "employees"}`}
      >
        <div style={tableWrap}>
          <DataTable
            caption="Employees with role, employment type, base hourly rate, primary location and retirement status"
            columns={columns}
            rowHref={(row) => `/workforce/employees/${String(row.id)}`}
            rows={visible.map((employee) => ({
              id: employee.id,
              name: employee.name,
              role: employee.roleCode,
              employment: employmentTypeLabel(employee.employmentType),
              rate: employee.baseHourlyRate,
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
              actions:
                canWrite && employee.retiredAt === null ? (
                  <RetireEmployeeButton employeeId={employee.id} />
                ) : (
                  "—"
                ),
            }))}
            emptyMessage="No employees match. Register one below, or clear the filters."
          />
        </div>
      </SectionCard>

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

      <Alert tone="info" title="Personnel documents">
        Personnel documents (contracts, certificates, ID documents) are visible on each employee's
        detail page to owner, general manager and admin only (DEC-087/DEC-099). A file chosen when
        recording a document is stored and downloadable from that page (DEC-133); a document
        recorded without a file is metadata-only. Retention is not enforced and file contents are
        not scanned for malware.
      </Alert>

      <p style={{ margin: 0, display: "flex", gap: spacing[4] }}>
        <Link href="/workforce/shifts">Open the roster</Link>
        <Link href="/workforce/my-shifts">My shifts (employee self-service)</Link>
      </p>
    </div>
  );
}
