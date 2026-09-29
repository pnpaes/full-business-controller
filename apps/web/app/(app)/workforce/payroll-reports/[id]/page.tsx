import { createPostgresSchedulingStore, findPayrollReport } from "@aquarela/application";
import {
  Alert,
  Collapsible,
  DataTable,
  type DataTableColumn,
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

/**
 * One payroll-input report (`WF-005`, `DEC-104`): the frozen snapshot lines
 * (per-employee hours, base rate, expected pay), the generation facts and the
 * mark-exported action for a `generated` report.
 *
 * The headline is one ranked `MetricBand` (total expected pay hero, hours and
 * lines secondary) rather than a wall of equal cards. The DEC-104 projection
 * caveat, the supersede rule and the HALF_UP money basis are `InfoTip`s. The
 * export consumer is wired to the `DEC-132` file-storage port (`DEC-133`):
 * marking the report exported uploads the CSV/PDF artefact, and a link
 * downloads it. Access is the `Payroll-input reports` matrix row (owner,
 * general_manager, finance, admin); anything else fails closed.
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
          Payroll-input reports are limited to owner, general manager, finance and admin.
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
  const currency = snapshot?.currency ?? "NOK";

  const columns: readonly DataTableColumn[] = [
    { key: "employee", header: "Employee" },
    { key: "role", header: "Role" },
    { key: "hours", header: "Hours", align: "right" },
    { key: "rate", header: `Base rate (${currency}/h)`, align: "right" },
    { key: "expectedPay", header: "Expected pay", align: "right" },
  ];

  return (
    <div style={contentColumn}>
      <PageHeader
        title={`Payroll report ${report.periodStart} → ${report.periodEnd}`}
        scope="Workforce · Payroll reports"
        description="The frozen monthly payroll-input report: per-employee hours × base hourly rate = expected pay."
      />

      <div style={{ display: "flex", gap: spacing[3], alignItems: "center", flexWrap: "wrap" }}>
        <StatusPill tone={status.tone}>{status.label}</StatusPill>
      </div>

      {/* The snapshot metadata is secondary to the figures, so it is collapsed
          by default; the status pill stays visible above it. */}
      <Collapsible
        summary="Snapshot metadata"
        badge={<span>schema v{snapshot?.schemaVersion ?? "?"}</span>}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}>
          <span style={{ fontSize: typography.fontSize.sm, color: color.ink.secondary }}>
            Generated {formatInstant(report.generatedAt)}
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              fontSize: typography.fontSize.sm,
              color: color.ink.tertiary,
            }}
          >
            Snapshot schema v{snapshot?.schemaVersion ?? "?"}
            <InfoTip
              content="The report is a frozen JSON snapshot at a versioned schema. The screen reads only the version it understands and shows an explicit error rather than inventing figures for anything newer."
              label="About the snapshot schema"
            />
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: spacing[1],
              fontSize: typography.fontSize.sm,
              color: color.ink.secondary,
            }}
          >
            A pre-month-end run under-counts: only assigned or completed shifts count.
            <InfoTip
              content="Regenerating for the same period supersedes this report — this row is retained as superseded, never deleted. Generate after the remaining shifts complete."
              label="About superseding this report"
            />
          </span>
        </div>
      </Collapsible>

      {snapshot === null ? (
        <Alert tone="danger" title="Snapshot unreadable">
          The frozen snapshot does not match the shape this screen expects, so no figures are shown
          rather than inventing numbers. The raw snapshot is preserved in the record.
        </Alert>
      ) : (
        <MetricBand
          hero={
            <MetricHero
              label="Total expected pay"
              value={formatMoney(snapshot.totalExpectedPay, { currency })}
              meta={`${snapshot.periodStart} → ${snapshot.periodEnd} · ${currency} · frozen at generation`}
              info={
                <InfoTip
                  content="Hours × base hourly rate, decimal only and never floating point. Money is rounded HALF_UP to 2 decimals."
                  label="How expected pay is calculated"
                />
              }
            />
          }
          metrics={[
            <MetricSecondary
              key="hours"
              label="Total hours"
              value={formatNumber(snapshot.totalHours)}
              meta="assigned or completed shifts only"
            />,
            <MetricSecondary
              key="lines"
              label="Lines"
              value={formatNumber(String(snapshot.lines.length), { decimals: 0 })}
              meta="one frozen line per employee, ordered by name"
            />,
          ]}
        />
      )}

      {/* The export action sits directly under the hero, above the detail table. */}
      {canWrite && report.status === "generated" ? (
        <SectionCard title="Export" meta="uploads the CSV/PDF artefact">
          <MarkExportedButton reportId={report.id} />
        </SectionCard>
      ) : null}

      {report.exportFileId !== null ? (
        <SectionCard title="Export file" meta="stored privately">
          <a href={`/api/v1/workforce/payroll-reports/${report.id}/export/file`} style={linkStyle}>
            Download the exported file
          </a>
        </SectionCard>
      ) : null}

      {snapshot !== null ? (
        <SectionCard title="Snapshot lines" meta="frozen at generation time">
          <div style={tableWrap}>
            <DataTable
              caption="Frozen per-employee payroll lines with hours, base rate and expected pay"
              columns={columns}
              rows={snapshot.lines.map((line) => ({
                id: line.employeeId,
                employee: line.employeeName,
                role: line.roleCode,
                hours: formatNumber(line.hours),
                rate: formatMoney(line.hourlyRate, { currency }),
                expectedPay: formatMoney(line.expectedPay, { currency }),
              }))}
              emptyMessage="The snapshot has no lines — no approved worked hours existed in the period."
            />
          </div>
        </SectionCard>
      ) : null}
    </div>
  );
}
