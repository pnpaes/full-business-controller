import { listAuditEvents, loadUserAccess } from "@aquarela/application";
import { DataTable, EmptyState, color, radius, spacing } from "@aquarela/ui";
import { redirect } from "next/navigation";

import { getAuthStore } from "../../../../lib/auth";
import { resolveOrganization } from "../../../../lib/organization";
import { getServerSession } from "../../../../lib/server-session";

import {
  ADMIN_AUDIT_READ_ROLES,
  isAdministrationAuthorized,
} from "../../../api/v1/administration/access";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit log — Administration" };

const norwegianDateTime = new Intl.DateTimeFormat("nb-NO", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** ISO instant → `dd.MM.yyyy HH:mm`; unparseable → an em dash. */
function formatNorwegianDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : norwegianDateTime.format(date);
}

/**
 * The audit register: every create, update, retire, post, approve, reject,
 * reverse, close, export and security change, newest first. Oversight, not
 * configuration — it lives on its own screen, off the hub. Gated on the
 * caller's live roles (ADR-0003).
 */
export default async function AdministrationAuditPage() {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const organizationId = resolveOrganization();
  const access = await loadUserAccess(getAuthStore(), session.userId);
  const canReadAudit = isAdministrationAuthorized(access, ADMIN_AUDIT_READ_ROLES);
  if (!canReadAudit) {
    redirect("/administration");
  }

  const auditEvents = await listAuditEvents(getAuthStore(), { organizationId });

  return (
    <section
      style={{
        backgroundColor: color.background.surface,
        border: `1px solid ${color.border.subtle}`,
        borderRadius: radius["2xl"],
        padding: spacing[5],
      }}
    >
      {auditEvents.length === 0 ? (
        <EmptyState variant="plain" title="No audit events recorded yet">
          Audit events are appended by every create, update, retire, post, approve, reject, reverse,
          close, export and security change. None exist for this organization yet.
        </EmptyState>
      ) : (
        <div style={{ overflowX: "auto", minWidth: 0 }}>
          <DataTable
            caption="Audit events for this organization, newest first."
            columns={[
              { key: "time", header: "Time" },
              { key: "action", header: "Action" },
              { key: "entity", header: "Entity" },
              { key: "actor", header: "Actor" },
              { key: "reason", header: "Reason" },
            ]}
            rows={auditEvents.map((row) => ({
              time: formatNorwegianDateTime(row.occurredAt),
              action: row.action,
              entity:
                row.entityId === null
                  ? row.entityType
                  : `${row.entityType} · ${row.entityId.slice(0, 8)}`,
              actor: row.actorId === null ? "—" : row.actorId.slice(0, 8),
              reason: row.reason ?? "—",
            }))}
            emptyMessage="No audit events recorded yet."
          />
        </div>
      )}
    </section>
  );
}
