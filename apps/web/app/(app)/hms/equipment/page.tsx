import {
  createPostgresHmsStore,
  createPostgresInventoryStore,
  listEquipment,
  listLocations,
} from "@aquarela/application";
import {
  DataTable,
  type DataTableColumn,
  EmptyState,
  PageHeader,
  SectionCard,
  StatusPill,
  color,
  spacing,
} from "@aquarela/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getDb } from "../../../../lib/db";
import { resolveOrganization } from "../../../../lib/organization";
import { getServerSession } from "../../../../lib/server-session";

import {
  HMS_EQUIPMENT_READ_ROLES,
  HMS_EQUIPMENT_WRITE_ROLES,
  isHmsAuthorized,
  loadHmsAccess,
} from "../../../api/v1/hms/access";
import { formatHmsDay } from "../hms-labels";
import { RegisterEquipmentForm } from "./register-equipment-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Equipment — Aquarela Business Control" };

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

/**
 * The equipment register (`HMS-006`, `DEC-092`, `DEC-097`): the list with its
 * maintenance-log history one click away and the registration form for the
 * write roles. Access follows the recorded `DEC-097` role sets in
 * `api/v1/hms/access.ts` — the access matrix itself has no equipment row, so
 * the recorded `DEC-097` clarification is the authority and the UI fails closed
 * on exactly those sets (no invented access).
 */
export default async function HmsEquipmentPage() {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const access = await loadHmsAccess(session.userId);
  if (!isHmsAuthorized(access, HMS_EQUIPMENT_READ_ROLES)) {
    return (
      <div style={contentColumn}>
        <PageHeader title="Equipment" scope="HMS" />
        <EmptyState title="Not available for your role">
          Purchasing and finance have no access to the equipment register (DEC-097). Ask an owner or
          administrator if you need access.
        </EmptyState>
      </div>
    );
  }

  const organizationId = resolveOrganization();
  const store = createPostgresHmsStore(getDb().db);
  const equipment = await listEquipment(store, { organizationId, limit: PAGE_LIMIT });
  const visible =
    access.locationIds.length > 0
      ? equipment.filter((item) => access.locationIds.includes(item.locationId))
      : equipment;

  const allLocations = await listLocations(createPostgresInventoryStore(getDb().db), {
    organizationId,
  });
  const locationLabelById = new Map(
    allLocations.map((location) => [location.id, `${location.code} · ${location.name}`]),
  );

  const columns: readonly DataTableColumn[] = [
    { key: "code", header: "Code" },
    { key: "name", header: "Name" },
    { key: "kind", header: "Kind" },
    { key: "serial", header: "Serial no." },
    { key: "location", header: "Location" },
    { key: "installed", header: "Installed" },
    { key: "warranty", header: "Warranty until" },
    { key: "status", header: "Status" },
  ];

  const canWrite = isHmsAuthorized(access, HMS_EQUIPMENT_WRITE_ROLES);

  return (
    <div style={contentColumn}>
      <PageHeader
        title="Equipment"
        scope="HMS"
        description="The equipment register with its maintenance-log history per machine (DEC-092, DEC-097)."
      />

      <SectionCard
        title="Equipment"
        meta={`${visible.length} ${visible.length === 1 ? "item" : "items"}`}
      >
        <div style={tableWrap}>
          <DataTable
            caption="Equipment register with kind, serial number, location and warranty"
            columns={columns}
            rowHref={(row) => `/hms/equipment/${String(row.id)}`}
            rows={visible.map((item) => ({
              id: item.id,
              code: item.code,
              name: item.name,
              kind: item.kind,
              serial: item.serialNo ?? "—",
              location: locationLabelById.get(item.locationId) ?? item.locationId,
              installed: formatHmsDay(item.installedAt),
              warranty: formatHmsDay(item.warrantyUntil),
              status: item.active ? (
                <StatusPill tone="success">Active</StatusPill>
              ) : (
                <StatusPill tone="info">Inactive</StatusPill>
              ),
            }))}
            emptyMessage="No equipment registered yet. Add the first machine with the form below."
          />
        </div>
      </SectionCard>

      {canWrite ? (
        <RegisterEquipmentForm
          locations={allLocations
            .filter((location) =>
              access.locationIds.length > 0 ? access.locationIds.includes(location.id) : true,
            )
            .map((location) => ({ id: location.id, label: `${location.code} · ${location.name}` }))}
        />
      ) : (
        <SectionCard title="Register equipment" meta="write roles only">
          <EmptyState title="Registering is not available for your role">
            Kitchen and front of house can read the register and log maintenance, but registering or
            amending equipment needs owner, general manager, location manager or admin (DEC-097).
          </EmptyState>
        </SectionCard>
      )}

      <p style={{ margin: 0, color: color.ink.tertiary }}>
        Maintenance evidence (photos, service reports) is stored privately: a file chosen when
        recording a log is uploaded through the file-storage port and downloadable from the log
        (DEC-133); a log recorded without a file stays metadata-only. Retention is not enforced and
        file contents are not scanned for malware.{" "}
        <Link href="/hms/compliance-export">Compliance export</Link> pulls the logs into the
        evidence bundle.
      </p>
    </div>
  );
}
