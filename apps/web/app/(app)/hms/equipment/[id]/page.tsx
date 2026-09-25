import { createPostgresHmsStore, findEquipment, listMaintenanceLogs } from "@aquarela/application";
import {
  DataTable,
  type DataTableColumn,
  DescriptionList,
  type DescriptionListItem,
  EmptyState,
  PageHeader,
  SectionCard,
  StatusPill,
  color,
  spacing,
  typography,
} from "@aquarela/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getDb } from "../../../../../lib/db";
import { resolveOrganization } from "../../../../../lib/organization";
import { getServerSession } from "../../../../../lib/server-session";

import {
  HMS_EQUIPMENT_WRITE_ROLES,
  HMS_MAINTENANCE_READ_ROLES,
  HMS_MAINTENANCE_RECORD_ROLES,
  isHmsAuthorized,
  loadHmsAccess,
} from "../../../../api/v1/hms/access";
import { formatHmsDay, formatHmsInstant, maintenanceKindLabel } from "../../hms-labels";
import { AmendEquipmentForm } from "./amend-equipment-form";
import { LogMaintenanceForm } from "./log-maintenance-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Equipment detail — Aquarela Business Control" };

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
 * One equipment row (`HMS-006`, `DEC-092`, `DEC-097`): the register record, its
 * append-only maintenance-log history and the log-entry form for the record
 * roles. Access follows the recorded `DEC-097` sets; a caller outside the
 * maintenance read set gets the honest "not available" state.
 */
export default async function EquipmentDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const access = await loadHmsAccess(session.userId);
  if (!isHmsAuthorized(access, HMS_MAINTENANCE_READ_ROLES)) {
    return (
      <div style={contentColumn}>
        <PageHeader title="Equipment" scope="HMS" />
        <EmptyState title="Not available for your role">
          Purchasing and finance have no access to equipment and maintenance logs (DEC-097).
        </EmptyState>
      </div>
    );
  }

  const { id } = await params;
  const organizationId = resolveOrganization();
  const store = createPostgresHmsStore(getDb().db);
  const equipment = await findEquipment(store, { organizationId, equipmentId: id });

  if (equipment === undefined || equipment.organizationId !== organizationId) {
    return (
      <div style={contentColumn}>
        <PageHeader title="Equipment" scope="HMS" />
        <EmptyState title="Equipment not found">
          No equipment with this code exists in your organization, or the link is stale.
        </EmptyState>
      </div>
    );
  }

  if (access.locationIds.length > 0 && !access.locationIds.includes(equipment.locationId)) {
    return (
      <div style={contentColumn}>
        <PageHeader title="Equipment" scope="HMS" />
        <EmptyState title="Outside your location scope">
          This equipment belongs to a location your role does not cover.
        </EmptyState>
      </div>
    );
  }

  const logs = await listMaintenanceLogs(store, {
    organizationId,
    equipmentId: equipment.id,
    limit: 200,
  });

  const facts: readonly DescriptionListItem[] = [
    { term: "Code", description: equipment.code },
    { term: "Name", description: equipment.name },
    { term: "Kind", description: equipment.kind },
    { term: "Serial no.", description: equipment.serialNo ?? "—" },
    { term: "Installed", description: formatHmsDay(equipment.installedAt) },
    { term: "Warranty until", description: formatHmsDay(equipment.warrantyUntil) },
    {
      term: "Status",
      description: equipment.active ? (
        <StatusPill tone="success">Active</StatusPill>
      ) : (
        <StatusPill tone="info">Inactive</StatusPill>
      ),
    },
  ];

  const columns: readonly DataTableColumn[] = [
    { key: "kind", header: "Kind" },
    { key: "performedAt", header: "Performed at" },
    { key: "performedBy", header: "Performed by" },
    { key: "notes", header: "Notes" },
    { key: "evidence", header: "Evidence" },
  ];

  const canRecord = isHmsAuthorized(access, HMS_MAINTENANCE_RECORD_ROLES, equipment.locationId);
  const canAmend = isHmsAuthorized(access, HMS_EQUIPMENT_WRITE_ROLES, equipment.locationId);

  return (
    <div style={contentColumn}>
      <PageHeader
        title={equipment.name}
        scope="HMS · Equipment"
        description={`Register code ${equipment.code}`}
      />

      <SectionCard title="Register record" meta={<Link href="/hms/equipment">All equipment</Link>}>
        <DescriptionList items={facts} />
      </SectionCard>

      <SectionCard
        title="Maintenance log"
        meta={`${logs.length} ${logs.length === 1 ? "entry" : "entries"} · newest first · append-only`}
      >
        <div style={tableWrap}>
          <DataTable
            caption="Maintenance-log history for this equipment, newest first"
            columns={columns}
            rows={logs.map((log) => ({
              kind: maintenanceKindLabel(log.kind),
              performedAt: formatHmsInstant(log.performedAt),
              performedBy: log.performedBy,
              notes: log.notes ?? "—",
              evidence:
                log.fileObjectId === null ? (
                  "—"
                ) : (
                  <a href={`/api/v1/hms/maintenance-logs/${log.id}/file`} style={linkStyle}>
                    Download evidence
                  </a>
                ),
            }))}
            emptyMessage="No maintenance logged yet. Log the first service, repair or inspection below."
          />
        </div>
      </SectionCard>

      {canRecord ? (
        <LogMaintenanceForm equipmentId={equipment.id} />
      ) : (
        <SectionCard title="Log maintenance" meta="record roles only">
          <EmptyState title="Recording is not available for your role">
            Analyst can read the log but not record; recording needs owner, general manager,
            location manager, kitchen, front of house or admin (DEC-097).
          </EmptyState>
        </SectionCard>
      )}

      {canAmend ? (
        <AmendEquipmentForm
          equipmentId={equipment.id}
          name={equipment.name}
          kind={equipment.kind}
          serialNo={equipment.serialNo}
          installedAt={equipment.installedAt}
          warrantyUntil={equipment.warrantyUntil}
          active={equipment.active}
        />
      ) : null}
    </div>
  );
}
