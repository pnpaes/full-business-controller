import {
  createPostgresDataQualityReadStore,
  listDataQualityExceptions,
  loadUserAccess,
} from "@aquarela/application";
import { Badge, DataTable, EmptyState, StatusPill, color, radius, spacing } from "@aquarela/ui";
import { redirect } from "next/navigation";

import { getAuthStore } from "../../../../lib/auth";
import { getDb } from "../../../../lib/db";
import { resolveOrganization } from "../../../../lib/organization";
import { getServerSession } from "../../../../lib/server-session";

import {
  ADMIN_DATA_QUALITY_READ_ROLES,
  isAdministrationAuthorized,
} from "../../../api/v1/administration/access";

export const dynamic = "force-dynamic";
export const metadata = { title: "Data quality — Administration" };

type PillTone = "success" | "warning" | "danger" | "info";

/** Exception severity → status tone (`low`/`medium`/`high`/`critical`). */
function severityTone(severity: string): PillTone {
  switch (severity) {
    case "critical":
    case "high":
      return "danger";
    case "medium":
      return "warning";
    default:
      return "info";
  }
}

/** Exception status → status tone (`open`/`acknowledged`/`resolved`/`dismissed`). */
function exceptionStatusTone(status: string): PillTone {
  switch (status) {
    case "open":
      return "warning";
    case "resolved":
      return "success";
    default:
      return "info";
  }
}

const norwegianDate = new Intl.DateTimeFormat("nb-NO", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/** ISO instant or `yyyy-mm-dd` day → `dd.MM.yyyy`; `null`/unparseable → an em dash. */
function formatNorwegianDate(value: string | null): string {
  if (value === null) {
    return "—";
  }
  const date = value.length === 10 ? new Date(`${value}T00:00:00Z`) : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : norwegianDate.format(date);
}

/**
 * The data-quality exception register: what the completeness, freshness,
 * reconciliation and variance rules have recorded for this organization,
 * newest first. Gated on the caller's live roles (ADR-0003).
 */
export default async function AdministrationDataQualityPage() {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const organizationId = resolveOrganization();
  const access = await loadUserAccess(getAuthStore(), session.userId);
  const canReadDataQuality = isAdministrationAuthorized(access, ADMIN_DATA_QUALITY_READ_ROLES);
  if (!canReadDataQuality) {
    redirect("/administration");
  }

  const exceptions = await listDataQualityExceptions(
    createPostgresDataQualityReadStore(getDb().db),
    { organizationId },
  );

  return (
    <section
      style={{
        backgroundColor: color.background.surface,
        border: `1px solid ${color.border.subtle}`,
        borderRadius: radius["2xl"],
        padding: spacing[5],
      }}
    >
      {exceptions.length === 0 ? (
        <EmptyState variant="plain" title="No exceptions recorded yet">
          The data-quality rules — completeness, freshness, reconciliation and variance — have not
          recorded an exception for this organization yet. Exceptions appear here when an import or
          a reconciliation breaks one of those rules.
        </EmptyState>
      ) : (
        <div style={{ overflowX: "auto", minWidth: 0 }}>
          <DataTable
            caption="Data-quality exceptions for this organization, newest first."
            columns={[
              { key: "rule", header: "Rule" },
              { key: "entity", header: "Entity" },
              { key: "severity", header: "Severity" },
              { key: "status", header: "Status" },
              { key: "detected", header: "Detected" },
              { key: "due", header: "Due" },
            ]}
            rows={exceptions.map((row) => ({
              rule: <Badge>{row.ruleCode}</Badge>,
              entity: `${row.entityType} · ${row.entityId.slice(0, 8)}`,
              severity: <StatusPill tone={severityTone(row.severity)}>{row.severity}</StatusPill>,
              status: <StatusPill tone={exceptionStatusTone(row.status)}>{row.status}</StatusPill>,
              detected: formatNorwegianDate(row.detectedAt),
              due: formatNorwegianDate(row.dueDate),
            }))}
            emptyMessage="No exceptions recorded yet."
          />
        </div>
      )}
    </section>
  );
}
