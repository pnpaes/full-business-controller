import { EmptyState, PageHeader, SectionCard, spacing } from "@aquarela/ui";
import { redirect } from "next/navigation";

import { getServerSession } from "../../../../lib/server-session";

import {
  HMS_COMPLIANCE_EXPORT_ROLES,
  isHmsAuthorized,
  loadHmsAccess,
} from "../../../api/v1/hms/access";
import { ComplianceExportForm } from "./export-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "HMS compliance export — Aquarela Business Control" };

const contentColumn = {
  display: "flex",
  flexDirection: "column",
  gap: spacing[6],
  maxWidth: 1120,
  margin: "0 auto",
  padding: `${spacing[8]}px ${spacing[4]}px`,
} as const;

/**
 * The HMS compliance/evidence export (`DEC-093`, `DEC-098`): the period
 * selection and the evidence bundle for Mattilsynet/IK-mat and Arbeidstilsynet.
 * Granted only to owner, general manager, location manager and admin
 * (`DEC-098`) — analyst, kitchen, FOH, purchasing and finance are denied, so
 * the page fails closed on exactly the recorded export set. The bundle itself
 * is built by `GET /api/v1/hms/compliance-export`, which also writes the
 * `hms.compliance_export.generated` audit fact per build.
 */
export default async function ComplianceExportPage() {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const access = await loadHmsAccess(session.userId);
  if (!isHmsAuthorized(access, HMS_COMPLIANCE_EXPORT_ROLES)) {
    return (
      <div style={contentColumn}>
        <PageHeader
          title="Compliance export"
          scope="HMS"
          description="The evidence bundle for the food-safety and working-environment authorities."
        />
        <EmptyState title="Not available for your role">
          The compliance export is granted only to owner, general manager, location manager and
          admin (DEC-098): it is a sensitive bulk read that requires read access to every source it
          includes. Ask an owner or administrator if you need it.
        </EmptyState>
      </div>
    );
  }

  return (
    <div style={contentColumn}>
      <PageHeader
        title="Compliance export"
        scope="HMS"
        description="Select a period and build the evidence bundle: monitoring readings, incidents, corrective actions, checklist runs and maintenance logs in one JSON object (DEC-093, DEC-098)."
      />

      <ComplianceExportForm />

      <SectionCard title="What the bundle covers" meta="DEC-098">
        <ul style={{ margin: 0, paddingLeft: spacing[5] }}>
          <li>
            <strong>Scope:</strong> the whole organization for owner/GM/admin; exactly your own
            location scope for a location manager. There is no per-location filter — the export is
            either organization-wide or your own scope, never a hand-picked subset.
          </li>
          <li>
            <strong>Corrective actions and maintenance logs</strong> carry no location of their own;
            they are scoped through their incident and equipment parents.
          </li>
          <li>
            <strong>Maintenance evidence bytes are stored</strong> (DEC-133): a photo or service
            report attached to a maintenance log is downloadable from that log.{" "}
            <strong>Incident evidence is not wired yet</strong> (DEC-133 keeps it deferred), so the
            bundle carries incident records and references, not incident photos or files.
          </li>
          <li>
            Every build writes an audit fact (<code>hms.compliance_export.generated</code>) —
            exports themselves are traceable.
          </li>
        </ul>
      </SectionCard>
    </div>
  );
}
