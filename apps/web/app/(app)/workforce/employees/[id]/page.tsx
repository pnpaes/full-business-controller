import {
  computeWorkedHours,
  createPostgresInventoryStore,
  createPostgresSchedulingStore,
  createPostgresWorkforceStore,
  EMPLOYEE_DOCUMENT_KINDS,
  EMPLOYMENT_TYPES,
  findEmployee,
  findShift,
  listEmployeeDocuments,
  listLocations,
  listPositions,
  listShiftAssignments,
} from "@aquarela/application";
import { listRoles } from "@aquarela/persistence";
import {
  Alert,
  Badge,
  Collapsible,
  DataTable,
  type DataTableColumn,
  DescriptionList,
  type DescriptionListItem,
  EmptyState,
  InfoTip,
  MetricBand,
  MetricHero,
  MetricSecondary,
  PageHeader,
  SectionCard,
  StatusPill,
  color,
  formatMoney,
  formatNumber,
  spacing,
  typography,
} from "@aquarela/ui";
import { notFound, redirect } from "next/navigation";

import { getDb } from "../../../../../lib/db";
import { resolveOrganization } from "../../../../../lib/organization";
import { uuidOrNotFound } from "../../../../../lib/route-params";
import { getServerSession } from "../../../../../lib/server-session";
import {
  isEmployeeInLocationScope,
  isWorkforceAuthorized,
  loadWorkforceAccess,
  WORKED_HOURS_READ_ROLES,
  WORKED_HOURS_WRITE_ROLES,
  WORKFORCE_EMPLOYEE_DOCUMENT_READ_ROLES,
  WORKFORCE_EMPLOYEE_DOCUMENT_WRITE_ROLES,
  WORKFORCE_EMPLOYEE_READ_ROLES,
  WORKFORCE_EMPLOYEE_WRITE_ROLES,
} from "../../../../api/v1/workforce/access";
import { RetireEmployeeButton } from "../../retire-employee-button";
import {
  assignmentStateView,
  documentKindLabel,
  employmentTypeLabel,
  formatInstant,
  formatShiftWindow,
  monthStartUtcDay,
  shiftStateView,
  todayUtcDay,
} from "../../workforce-labels";
import { EditEmployeeForm } from "./edit-employee-form";
import { EditEmployeeDocumentForm } from "./edit-employee-document-form";
import { EmployeeDocumentForm } from "./employee-document-form";
import { RecordAdjustmentForm } from "./record-adjustment-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Employee — Aquarela Business Control" };

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

/** Row link style matching the DataTable drill-down links. */
const linkStyle = {
  color: color.ink.primary,
  fontWeight: typography.fontWeight.medium,
  textDecoration: "underline",
  textDecorationColor: color.border.strong,
  textUnderlineOffset: 3,
} as const;

const inlineTip = {
  display: "inline-flex",
  alignItems: "center",
  gap: spacing[1],
} as const;

/**
 * The employee detail ("Employee detail"): the read-only profile with the
 * amend and retire actions, the employee's shifts and assignments, their worked
 * hours for the current UTC month (role-aware) and the personnel documents
 * (owner/GM/admin only). The personnel-document consumer is wired to the
 * file-storage port: a file chosen at creation is stored and downloadable from
 * the list, while a document created without one stays metadata-only.
 *
 * Amending and retiring are mutations: they live behind the header "Edit"
 * button and the danger-zone retire confirmation, never inline in the read-only
 * profile. Reads use the same application services and row shapes as the
 * workforce API routes. Access: the `employee` matrix row to open the page at
 * all; the documents section is additionally gated on the document role set
 * (finance and location_manager are deliberately excluded there) and the hours
 * section on the worked-hours read set — each stated, never hidden.
 */
export default async function EmployeeDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
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
          title="Employee"
          scope="Workforce"
          description="Employee profile and documents."
        />
        <EmptyState title="Not available for your role">
          Employee records are limited to owner, general manager, location manager, finance and
          admin.
        </EmptyState>
      </div>
    );
  }

  const { id: rawId } = await params;
  const employeeId = uuidOrNotFound(rawId);
  const organizationId = resolveOrganization();
  const store = createPostgresWorkforceStore(getDb().db);

  const employee = await findEmployee(store, { organizationId, employeeId });
  if (employee === undefined) {
    notFound();
  }
  // Fail-closed, mirroring the GET route: a scoped caller cannot open an
  // employee whose primary location is null or outside their scope.
  if (!isEmployeeInLocationScope(access, employee.primaryLocationId)) {
    return (
      <div style={contentColumn}>
        <PageHeader
          title="Employee"
          scope="Workforce"
          description="Employee profile and documents."
        />
        <EmptyState title="Outside your location scope">
          This employee's primary location is not in your scope (or has none), so the record is not
          visible to you (fail-closed).
        </EmptyState>
      </div>
    );
  }

  const schedulingStore = createPostgresSchedulingStore(getDb().db);
  const allLocations = await listLocations(createPostgresInventoryStore(getDb().db), {
    organizationId,
  });
  const locationLabelById = new Map(
    allLocations.map((location) => [location.id, `${location.code} · ${location.name}`]),
  );

  const canWrite = isWorkforceAuthorized(access, WORKFORCE_EMPLOYEE_WRITE_ROLES);
  const canReadHours = isWorkforceAuthorized(access, WORKED_HOURS_READ_ROLES);
  const canWriteHours = isWorkforceAuthorized(access, WORKED_HOURS_WRITE_ROLES);
  const canReadDocuments = isWorkforceAuthorized(access, WORKFORCE_EMPLOYEE_DOCUMENT_READ_ROLES);
  const canWriteDocuments = isWorkforceAuthorized(access, WORKFORCE_EMPLOYEE_DOCUMENT_WRITE_ROLES);

  const assignments = await listShiftAssignments(schedulingStore, {
    organizationId,
    employeeId: employee.id,
    limit: 200,
  });
  const shifts = await Promise.all(
    [...new Set(assignments.map((assignment) => assignment.shiftId))].map((shiftId) =>
      findShift(schedulingStore, { organizationId, shiftId }),
    ),
  );
  const shiftById = new Map(
    shifts.flatMap((shift) => (shift === undefined ? [] : [[shift.id, shift] as const])),
  );

  // Worked hours for the current UTC month, this employee only.
  const today = todayUtcDay();
  const monthStart = monthStartUtcDay(today);
  const hours = canReadHours
    ? await computeWorkedHours(schedulingStore, {
        organizationId,
        from: `${monthStart}T00:00:00.000Z`,
        to: new Date().toISOString(),
        employeeId: employee.id,
      })
    : null;

  const documents = canReadDocuments
    ? await listEmployeeDocuments(store, { organizationId, employeeId: employee.id, limit: 200 })
    : [];

  const writableLocations =
    access.locationIds.length === 0
      ? allLocations
      : allLocations.filter((location) => access.locationIds.includes(location.id));

  // `DEC-151`: the fixed role select and the open position catalogue.
  const roles = await listRoles(getDb().db, organizationId);
  const catalogue = await listPositions(store, { organizationId });
  const positionNameById = new Map(catalogue.map((position) => [position.id, position.name]));

  const profileItems: readonly DescriptionListItem[] = [
    { term: "Role", description: employee.roleCode },
    {
      term: "Positions",
      description:
        employee.positionIds.length === 0
          ? "—"
          : employee.positionIds
              .map((positionId) => positionNameById.get(positionId) ?? positionId)
              .join(", "),
    },
    { term: "Employment", description: employmentTypeLabel(employee.employmentType) },
    {
      term: "Base hourly rate",
      description: formatMoney(employee.baseHourlyRate, { currency: "NOK" }),
    },
    {
      term: "Primary location",
      description:
        employee.primaryLocationId === null
          ? "—"
          : (locationLabelById.get(employee.primaryLocationId) ?? employee.primaryLocationId),
    },
    { term: "Active from", description: employee.activeFrom },
    { term: "Active to", description: employee.activeTo ?? "—" },
    {
      term: "Login",
      description: (
        <span style={inlineTip}>
          {employee.userId === null ? "None" : "Linked"}
          <InfoTip
            content="A linked login lets the employee sign in and use My shifts to self-serve. The link is set when the account is created and is not changed from here."
            label="What the login link means"
          />
        </span>
      ),
    },
    {
      term: "Retired",
      description: employee.retiredAt === null ? "—" : formatInstant(employee.retiredAt),
    },
  ];

  const assignmentColumns: readonly DataTableColumn[] = [
    { key: "shift", header: "Shift (UTC)" },
    { key: "location", header: "Location" },
    { key: "shiftState", header: "Shift status" },
    { key: "assignmentState", header: "Assignment" },
    { key: "assignedAt", header: "Assigned at" },
  ];

  const documentColumns: readonly DataTableColumn[] = [
    { key: "title", header: "Title" },
    { key: "kind", header: "Kind" },
    { key: "issued", header: "Issued" },
    { key: "expires", header: "Expires" },
    { key: "file", header: "File" },
    { key: "createdAt", header: "Recorded" },
  ];

  return (
    <div style={contentColumn}>
      <PageHeader
        title={employee.name}
        scope="Workforce · Employees"
        description="Profile, shifts and worked hours, and personnel documents."
        {...(canWrite && employee.retiredAt === null
          ? {
              actions: (
                <EditEmployeeForm
                  employeeId={employee.id}
                  name={employee.name}
                  roleCode={employee.roleCode}
                  employmentType={employee.employmentType}
                  baseHourlyRate={employee.baseHourlyRate}
                  primaryLocationId={employee.primaryLocationId}
                  activeTo={employee.activeTo}
                  positionIds={employee.positionIds}
                  employmentTypes={EMPLOYMENT_TYPES}
                  locations={writableLocations.map((location) => ({
                    id: location.id,
                    code: location.code,
                    name: location.name,
                  }))}
                  roles={roles.map((role) => ({ code: role.code, name: role.name }))}
                  positions={catalogue.map((position) => ({
                    id: position.id,
                    code: position.code,
                    name: position.name,
                  }))}
                  canClearLocation={access.locationIds.length === 0}
                />
              ),
            }
          : {})}
      />

      <SectionCard title="Profile" meta={employee.retiredAt === null ? "Active" : "Retired"}>
        <DescriptionList items={profileItems} />
      </SectionCard>

      <Collapsible
        summary="Worked hours"
        badge={hours === null ? undefined : <Badge>{`${hours.totalHours} h`}</Badge>}
      >
        {hours === null ? (
          <Alert tone="info" title="Worked hours not shown">
            Reading worked hours is limited to owner, general manager, location manager, finance and
            admin; your role does not hold it.
          </Alert>
        ) : (
          <MetricBand
            hero={
              <MetricHero
                label="Worked hours"
                value={formatNumber(hours.totalHours)}
                unit="h"
                meta={`Current UTC month from ${monthStart}`}
                info={
                  <InfoTip
                    content="Worked hours are derived from this employee's completed shifts and any append-only hour adjustments, for the current UTC month only."
                    label="How worked hours are derived"
                  />
                }
              />
            }
            metrics={[
              <MetricSecondary
                key="rate"
                label="Base hourly rate"
                value={formatMoney(employee.baseHourlyRate, { currency: "NOK" })}
                meta="The payroll report prices hours at this rate"
              />,
            ]}
          />
        )}
      </Collapsible>

      <Collapsible
        summary="Shifts and assignments"
        badge={
          <Badge>
            {`${assignments.length} ${assignments.length === 1 ? "assignment" : "assignments"}`}
          </Badge>
        }
      >
        <div style={tableWrap}>
          <DataTable
            caption="This employee's shift assignments with the shift window, location and states"
            columns={assignmentColumns}
            rows={assignments.map((assignment) => {
              const shift = shiftById.get(assignment.shiftId);
              const shiftStatus = shiftStateView(shift?.state ?? "unknown");
              const assignmentStatus = assignmentStateView(assignment.state);
              return {
                id: assignment.id,
                shift:
                  shift === undefined
                    ? assignment.shiftId
                    : formatShiftWindow(shift.startsAt, shift.endsAt),
                location:
                  shift === undefined
                    ? "—"
                    : (locationLabelById.get(shift.locationId) ?? shift.locationId),
                shiftState: <StatusPill tone={shiftStatus.tone}>{shiftStatus.label}</StatusPill>,
                assignmentState: (
                  <StatusPill tone={assignmentStatus.tone}>{assignmentStatus.label}</StatusPill>
                ),
                assignedAt: formatInstant(assignment.assignedAt),
              };
            })}
            emptyMessage="No shift assignments yet. A manager assigns this employee from the roster."
          />
        </div>
      </Collapsible>

      {canWriteHours && assignments.length > 0 ? (
        <RecordAdjustmentForm
          assignmentId={assignments[0]!.id}
          employeeName={employee.name}
          shiftLabel={
            shiftById.has(assignments[0]!.shiftId)
              ? formatShiftWindow(
                  shiftById.get(assignments[0]!.shiftId)!.startsAt,
                  shiftById.get(assignments[0]!.shiftId)!.endsAt,
                )
              : assignments[0]!.shiftId
          }
        />
      ) : null}

      <Collapsible
        summary="Personnel documents"
        badge={
          <Badge>
            {canReadDocuments
              ? `${documents.length} ${documents.length === 1 ? "document" : "documents"}`
              : "restricted"}
          </Badge>
        }
      >
        {canReadDocuments ? (
          <>
            <Alert tone="info" title="Files are stored privately">
              A file attached when a document was created is stored and downloadable with the
              personnel-document role set; a document recorded without a file is metadata-only.
              Retention is not enforced and file contents are not scanned for malware.
            </Alert>
            <div style={tableWrap}>
              <DataTable
                caption="Personnel documents with kind, validity window and file status"
                columns={documentColumns}
                rows={documents.map((document) => ({
                  id: document.id,
                  title: document.title,
                  kind: documentKindLabel(document.kind),
                  issued: document.issuedAt ?? "—",
                  expires: document.expiresAt ?? "—",
                  file:
                    document.fileObjectId === null ? (
                      "Metadata only"
                    ) : (
                      <a
                        href={`/api/v1/workforce/employee-documents/${document.id}/file`}
                        style={linkStyle}
                      >
                        Download
                      </a>
                    ),
                  createdAt: formatInstant(document.createdAt),
                }))}
                emptyMessage="No personnel documents recorded for this employee yet."
              />
            </div>
            <p
              style={{
                margin: `${spacing[3]}px 0 0`,
                display: "flex",
                alignItems: "center",
                gap: spacing[1],
                fontSize: typography.fontSize.sm,
                color: color.ink.tertiary,
              }}
            >
              Document metadata can be amended; an attached file is fixed once recorded.
              <InfoTip
                content="Personnel-document metadata (kind, title, validity dates) can be amended in place and each change is audit-logged. A file is attached only when the document is created, cannot be replaced, and stays downloadable. Retention is not enforced."
                label="What can change on a personnel document"
              />
            </p>
            <EmployeeDocumentForm employeeId={employee.id} kinds={EMPLOYEE_DOCUMENT_KINDS} />
            {canWriteDocuments && documents.length > 0 ? (
              <EditEmployeeDocumentForm
                employeeName={employee.name}
                documentId={documents[0]!.id}
                kind={documents[0]!.kind}
                title={documents[0]!.title}
                issuedAt={documents[0]!.issuedAt}
                expiresAt={documents[0]!.expiresAt}
                kinds={EMPLOYEE_DOCUMENT_KINDS}
              />
            ) : null}
          </>
        ) : (
          <Alert tone="info" title="Documents are restricted">
            Personnel documents are visible to owner, general manager and admin only — finance and
            location managers can read the employee record but are deliberately excluded from the
            documents.
          </Alert>
        )}
      </Collapsible>

      {canWrite && employee.retiredAt === null ? (
        <SectionCard title="Danger zone" meta="retiring is permanent for the register">
          <p style={{ margin: 0, color: color.ink.secondary }}>
            Retiring takes the employee off the active register and out of shift assignment. The
            record and its history are kept — this is a tombstone, not a deletion — and it cannot be
            undone from here.
          </p>
          <p
            style={{
              margin: `${spacing[2]}px 0 0`,
              display: "flex",
              alignItems: "center",
              gap: spacing[1],
              fontSize: typography.fontSize.sm,
              color: color.ink.tertiary,
            }}
          >
            What retiring does
            <InfoTip
              content="Retirement stamps a retirement date and drops the employee from the active register and from shift assignment, while keeping the record and its history. It is idempotent and is the only way to take an employee off the active register."
              label="What retiring an employee does"
            />
          </p>
          <div style={{ marginTop: spacing[4] }}>
            <RetireEmployeeButton employeeId={employee.id} />
          </div>
        </SectionCard>
      ) : null}
    </div>
  );
}
