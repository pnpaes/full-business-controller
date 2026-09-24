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
  listShiftAssignments,
} from "@aquarela/application";
import {
  Alert,
  DataTable,
  type DataTableColumn,
  EmptyState,
  KpiCard,
  PageHeader,
  SectionCard,
  StatusPill,
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
  width: "100%",
  maxWidth: 1120,
  margin: "0 auto",
  padding: `${spacing[8]}px ${spacing[4]}px`,
} as const;

const profileStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: spacing[3],
  margin: 0,
} as const;

function ProfileItem({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <div style={{ fontSize: typography.fontSize.sm, opacity: 0.75 }}>{label}</div>
      <div style={{ fontWeight: typography.fontWeight.semibold }}>{value}</div>
    </div>
  );
}

/**
 * The employee detail (08_UI_UX.md §8.3 "Employee detail"): the profile with
 * amend/retire, the employee's shifts and assignments, their worked hours for
 * the current UTC month (role-aware) and the personnel documents
 * (owner/GM/admin only, metadata-only per `DEC-085`/`DEC-099`).
 *
 * Reads the same application services and row shapes as the workforce API
 * routes. Access: the `employee` matrix row to open the page at all; the
 * documents section is additionally gated on the document role set (finance
 * and location_manager are deliberately excluded there, `DEC-099` item 6) and
 * the hours section on the worked-hours read set — each stated, never hidden.
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
          admin (DEC-099).
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
          visible to you (fail-closed, DEC-099).
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
        description="Profile, shifts and worked hours, and personnel documents (WF-001, WF-007)."
      />

      <SectionCard title="Profile" meta={employee.retiredAt === null ? "Active" : "Retired"}>
        <div style={profileStyle}>
          <ProfileItem label="Role" value={employee.roleCode} />
          <ProfileItem label="Employment" value={employmentTypeLabel(employee.employmentType)} />
          <ProfileItem label="Base hourly rate" value={`${employee.baseHourlyRate} NOK`} />
          <ProfileItem
            label="Primary location"
            value={
              employee.primaryLocationId === null
                ? "—"
                : (locationLabelById.get(employee.primaryLocationId) ?? employee.primaryLocationId)
            }
          />
          <ProfileItem label="Active from" value={employee.activeFrom} />
          <ProfileItem label="Active to" value={employee.activeTo ?? "—"} />
          <ProfileItem label="Login" value={employee.userId === null ? "None" : "Linked"} />
          <ProfileItem
            label="Retired"
            value={employee.retiredAt === null ? "—" : formatInstant(employee.retiredAt)}
          />
        </div>
        {canWrite && employee.retiredAt === null ? (
          <div style={{ marginTop: spacing[4] }}>
            <RetireEmployeeButton employeeId={employee.id} />
          </div>
        ) : null}
      </SectionCard>

      {canWrite && employee.retiredAt === null ? (
        <EditEmployeeForm
          employeeId={employee.id}
          name={employee.name}
          roleCode={employee.roleCode}
          employmentType={employee.employmentType}
          baseHourlyRate={employee.baseHourlyRate}
          primaryLocationId={employee.primaryLocationId}
          activeTo={employee.activeTo}
          employmentTypes={EMPLOYMENT_TYPES}
          locations={writableLocations.map((location) => ({
            id: location.id,
            code: location.code,
            name: location.name,
          }))}
          canClearLocation={access.locationIds.length === 0}
        />
      ) : null}

      {hours === null ? (
        <Alert tone="info" title="Worked hours not shown">
          Reading worked hours is limited to owner, general manager, location manager, finance and
          admin (DEC-103); your role does not hold it.
        </Alert>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: spacing[4],
          }}
        >
          <KpiCard
            label="Worked hours"
            value={hours.totalHours}
            meta={`Current UTC month (${monthStart} →) · DEC-103 derivation`}
          />
          <KpiCard
            label="Base hourly rate"
            value={`${employee.baseHourlyRate} NOK`}
            meta="The payroll report prices hours at this rate"
          />
        </div>
      )}

      <SectionCard
        title="Shifts and assignments"
        meta={`${assignments.length} ${assignments.length === 1 ? "assignment" : "assignments"}`}
      >
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
      </SectionCard>

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

      <SectionCard title="Personnel documents" meta="owner / general manager / admin only">
        {canReadDocuments ? (
          <>
            <Alert tone="warning" title="Metadata only — no files">
              Upload, download and retention are <strong>not available</strong>: the storage path is
              deferred (DEC-085, DEC-099), so a document row records metadata only and never implies
              a working file.
            </Alert>
            <DataTable
              caption="Personnel documents with kind, validity window and file status"
              columns={documentColumns}
              rows={documents.map((document) => ({
                id: document.id,
                title: document.title,
                kind: documentKindLabel(document.kind),
                issued: document.issuedAt ?? "—",
                expires: document.expiresAt ?? "—",
                file: "Not available (metadata only)",
                createdAt: formatInstant(document.createdAt),
              }))}
              emptyMessage="No personnel documents recorded for this employee yet."
            />
            <EmployeeDocumentForm employeeId={employee.id} kinds={EMPLOYEE_DOCUMENT_KINDS} />
            {canWriteDocuments && documents.length > 0 ? (
              <EditEmployeeDocumentForm
                employeeId={employee.id}
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
            Personnel documents are visible to owner, general manager and admin only (DEC-087) —
            finance and location managers can read the employee record but are deliberately excluded
            from the documents (DEC-099 item 6).
          </Alert>
        )}
      </SectionCard>
    </div>
  );
}
