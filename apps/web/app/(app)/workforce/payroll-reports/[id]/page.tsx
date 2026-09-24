import { createPostgresSchedulingStore, findPayrollReport } from "@aquarela/application";
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
} from "@aquarela/ui";
import { notFound, redirect } from "next/navigation";

import { getDb } from "../../../../../lib/db";
import { resolveOrganization } from "../../../../../lib/organization";
import { uuidOrNotFound } from "../../../../../lib/route-params";
import { getServerSession } from "../../../../../lib/server-session";
import {
  isWorkforceAuthorized,
  loadWorkforceAccess,
  PAYROLL_REPORT_READ_ROLES,
  PAYROLL_REPORT_WRITE_ROLES,
} from "../../../../api/v1/workforce/access";
import { formatInstant, parsePayrollSnapshot, payrollStatusView } from "../../workforce-labels";
import { MarkExportedButton } from "../mark-exported-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payroll report — Aquarela Business Control" };

const contentColumn = {
  display: "flex",
  flexDirection: "column",
  gap: spacing[6],
  width: "100%",
  maxWidth: 1120,
  margin: "0 auto",
  padding: `${spacing[8]}px ${spacing[4]}px`,
} as const;

/**
 * One payroll-input report (`WF-005`, `DEC-104`): the frozen snapshot lines
 * (per-employee hours, base rate, expected pay), the generation facts and the
 * mark-exported action for a `generated` report.
 *
 * The DEC-104 projection caveat and the deferred export bytes (`DEC-085`) are
 * stated on the page. Access is the `Payroll-input reports` matrix row
 * (owner, general_manager, finance, admin); anything else fails closed.
 */
export default async function PayrollReportDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const access = await loadWorkforceAccess(session.userId);
  if (!isWorkforceAuthorized(access, PAYROLL_REPORT_READ_ROLES)) {
    return (
      <div style={contentColumn}>
        <PageHeader title="Payroll report" scope="Workforce" description="One frozen report." />
        <EmptyState title="Not available for your role">
          Payroll-input reports are limited to owner, general manager, finance and admin (DEC-104).
        </EmptyState>
      </div>
    );
  }

  const { id: rawId } = await params;
  const reportId = uuidOrNotFound(rawId);
  const organizationId = resolveOrganization();
  const report = await findPayrollReport(createPostgresSchedulingStore(getDb().db), {
    organizationId,
    payrollReportId: reportId,
  });
  if (report === undefined) {
    notFound();
  }

  const snapshot = parsePayrollSnapshot(report.snapshot);
  const status = payrollStatusView(report.status);
  const canWrite = isWorkforceAuthorized(access, PAYROLL_REPORT_WRITE_ROLES);

  const columns: readonly DataTableColumn[] = [
    { key: "employee", header: "Employee" },
    { key: "role", header: "Role" },
    { key: "hours", header: "Hours" },
    { key: "rate", header: `Base rate (${snapshot?.currency ?? "NOK"}/h)` },
    { key: "expectedPay", header: "Expected pay" },
  ];

  return (
    <div style={contentColumn}>
      <PageHeader
        title={`Payroll report ${report.periodStart} → ${report.periodEnd}`}
        scope="Workforce · Payroll reports"
        description="The frozen monthly payroll-input report: per-employee hours × base hourly rate = expected pay (WF-005, DEC-104)."
      />

      <div style={{ display: "flex", gap: spacing[3], alignItems: "center", flexWrap: "wrap" }}>
        <StatusPill tone={status.tone}>{status.label}</StatusPill>
        <span>Generated {formatInstant(report.generatedAt)}</span>
        <span>Snapshot schema v{snapshot?.schemaVersion ?? "?"}</span>
      </div>

      <Alert tone="warning" title="A pre-month-end report under-counts (DEC-104)">
        Only shifts in state assigned or completed count — the &ldquo;remaining planned shifts run
        as scheduled&rdquo; assumption is not implemented — so a report generated before month-end
        under-counts. Regenerate after the remaining shifts complete; the regeneration supersedes
        this report (this row is retained as superseded, never deleted).
      </Alert>

      {snapshot === null ? (
        <Alert tone="danger" title="Snapshot unreadable">
          The frozen snapshot does not match the DEC-104 shape this screen expects, so no figures
          are shown rather than inventing numbers. The raw snapshot is preserved in the record.
        </Alert>
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: spacing[4],
            }}
          >
            <KpiCard
              label="Total hours"
              value={snapshot.totalHours}
              meta={`${snapshot.periodStart} → ${snapshot.periodEnd} · ${snapshot.currency}`}
            />
            <KpiCard
              label="Total expected pay"
              value={`${snapshot.totalExpectedPay} ${snapshot.currency}`}
              meta="Hours × base hourly rate, decimal only (HALF_UP at money scale)"
            />
            <KpiCard
              label="Lines"
              value={String(snapshot.lines.length)}
              meta="One frozen line per employee, ordered by name"
            />
          </div>

          <SectionCard title="Snapshot lines" meta="frozen at generation time">
            <DataTable
              caption="Frozen per-employee payroll lines with hours, base rate and expected pay"
              columns={columns}
              rows={snapshot.lines.map((line) => ({
                id: line.employeeId,
                employee: line.employeeName,
                role: line.roleCode,
                hours: line.hours,
                rate: line.hourlyRate,
                expectedPay: line.expectedPay,
              }))}
              emptyMessage="The snapshot has no lines — no approved worked hours existed in the period."
            />
          </SectionCard>
        </>
      )}

      {canWrite && report.status === "generated" ? (
        <SectionCard title="Export" meta="status only — no file">
          <MarkExportedButton reportId={report.id} />
        </SectionCard>
      ) : null}
    </div>
  );
}
