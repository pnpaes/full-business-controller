import {
  createPostgresInventoryStore,
  createPostgresWorkforceStore,
  EMPLOYMENT_TYPES,
  listEmployees,
  listLocations,
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
  width: "100%",
  maxWidth: 1120,
  margin: "0 auto",
  padding: `${spacing[8]}px ${spacing[4]}px`,
} as const;

const SHOW_FILTERS = ["active", "retired", "all"] as const;
type ShowFilter = (typeof SHOW_FILTERS)[number];

const filterChipStyle = {
  padding: `${spacing[2]}px ${spacing[3]}px`,
  borderRadius: 999,
  border: "1px solid currentColor",
  fontSize: typography.fontSize.sm,
  textDecoration: "none",
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
            style={{
              ...filterChipStyle,
              fontWeight:
                show === candidate ? typography.fontWeight.semibold : typography.fontWeight.regular,
            }}
          >
            {candidate === "active" ? "Active" : candidate === "retired" ? "Retired" : "All"}
          </Link>
        ))}
        {writableLocations.length > 1 ? (
          <Link
            href={`/workforce?show=${show}`}
            style={{
              ...filterChipStyle,
              fontWeight:
                rawLocationId === undefined
                  ? typography.fontWeight.semibold
                  : typography.fontWeight.regular,
            }}
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
              style={{
                ...filterChipStyle,
                fontWeight:
                  rawLocationId === location.id
                    ? typography.fontWeight.semibold
                    : typography.fontWeight.regular,
              }}
            >
              {location.code}
            </Link>
          ))}
      </div>

      <SectionCard
        title="Register"
        meta={`${visible.length} ${visible.length === 1 ? "employee" : "employees"}`}
      >
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
                : (locationLabelById.get(employee.primaryLocationId) ?? employee.primaryLocationId),
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
      </SectionCard>

      <RegisterEmployeeForm
        employmentTypes={EMPLOYMENT_TYPES}
        locations={writableLocations.map((location) => ({
          id: location.id,
          code: location.code,
          name: location.name,
        }))}
        canWrite={canWrite}
      />

      <Alert tone="info" title="Personnel documents are metadata-only">
        Personnel documents (contracts, certificates, ID documents) are visible on each employee's
        detail page to owner, general manager and admin only (DEC-087/DEC-099). File upload,
        download and retention are <strong>not available</strong> — the storage path is deferred
        (DEC-085), so a document row records metadata only and never implies a working file.
      </Alert>
    </div>
  );
}
