import {
  createPostgresTransferStore,
  listLocations,
  listStockTransfers,
  listStorageAreas,
} from "@aquarela/application";
import { Alert, KpiCard, PageHeader, SectionCard, spacing } from "@aquarela/ui";
import { redirect } from "next/navigation";

import { getDb } from "../../../../lib/db";
import { resolveOrganization } from "../../../../lib/organization";
import { getServerSession } from "../../../../lib/server-session";

import { loadTransferRefs } from "../../../api/v1/transfers/refs";
import { toTransferRows } from "../../../api/v1/transfers/transfer-rows";

import { NewTransferForm } from "./new-transfer-form";
import { TransfersTable } from "./transfers-table";

export const dynamic = "force-dynamic";
export const metadata = { title: "Transfers — Aquarela Business Control" };

/**
 * Transfers between locations (08_UI_UX.md §8.3): the list with the
 * movement-derived dispatched/received totals and discrepancy flag, plus the
 * request form. The read is the same application service the API uses, so the
 * page and `GET /api/v1/transfers` cannot drift.
 */
export default async function TransfersPage() {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const organizationId = resolveOrganization();
  const store = createPostgresTransferStore(getDb().db);

  const [page, locations, areas] = await Promise.all([
    listStockTransfers(store, { organizationId }),
    listLocations(store, { organizationId }),
    listStorageAreas(store, { organizationId }),
  ]);

  const refs = await loadTransferRefs(store, {
    locationIds: page.transfers.flatMap((row) => [
      row.transfer.fromLocationId,
      row.transfer.toLocationId,
    ]),
    storageAreaIds: page.transfers.flatMap((row) => [
      row.transfer.fromStorageAreaId,
      row.transfer.toStorageAreaId,
    ]),
    itemIds: [],
  });
  const rows = toTransferRows(organizationId, page.transfers, refs);

  const inTransitCount = rows.filter((row) => row.status === "dispatched").length;
  const discrepancyCount = rows.filter((row) => row.hasDiscrepancy).length;

  // The transit location and its in-transit area are internal legs, never a
  // transfer endpoint, so the form offers only physical locations/areas.
  const physicalLocations = locations
    .filter((location) => location.kind !== "virtual_transit")
    .map((location) => ({ id: location.id, code: location.code, name: location.name }));
  const physicalAreas = areas
    .filter((area) => !area.isTransit)
    .map((area) => ({
      id: area.id,
      locationId: area.locationId,
      code: area.code,
      name: area.name,
    }));

  const scopeMeta = `${rows.length} ${rows.length === 1 ? "transfer" : "transfers"} · all locations`;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: spacing[6],
        maxWidth: 1120,
        margin: "0 auto",
        padding: `${spacing[8]}px ${spacing[4]}px`,
      }}
    >
      <PageHeader
        title="Transfers"
        scope="Inventory"
        description="Two-sided stock transfers between locations. Stock is held in a virtual in-transit point between dispatch and receipt, and any difference is recorded as a discrepancy."
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: spacing[4],
        }}
      >
        <KpiCard label="Transfers" value={String(rows.length)} meta={scopeMeta} />
        <KpiCard
          label="In transit"
          value={String(inTransitCount)}
          meta={`${scopeMeta} · dispatched, not yet received`}
        />
        <KpiCard
          label="Discrepancies"
          value={String(discrepancyCount)}
          meta={`${scopeMeta} · received differs from dispatched`}
        />
      </div>

      {discrepancyCount > 0 ? (
        <Alert tone="warning" title="Discrepancy attention">
          {discrepancyCount} {discrepancyCount === 1 ? "transfer has" : "transfers have"} a received
          quantity that differs from what was dispatched. The difference stays in transit and the
          header records a note; there is no exception queue yet.
        </Alert>
      ) : null}

      <SectionCard title="Transfers" meta={`${rows.length} ${rows.length === 1 ? "row" : "rows"}`}>
        <div style={{ overflowX: "auto", minWidth: 0 }}>
          <TransfersTable rows={rows} />
        </div>
      </SectionCard>

      <NewTransferForm locations={physicalLocations} areas={physicalAreas} />
    </div>
  );
}
