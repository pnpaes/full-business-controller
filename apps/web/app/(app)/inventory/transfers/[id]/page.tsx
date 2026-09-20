import {
  createPostgresTransferStore,
  getStockTransfer,
  listStockedItems,
} from "@aquarela/application";
import { Alert, Badge, KpiCard, PageHeader, SectionCard, StatusPill, spacing } from "@aquarela/ui";
import { notFound, redirect } from "next/navigation";

import { getDb } from "../../../../../lib/db";
import { resolveOrganization } from "../../../../../lib/organization";
import { uuidOrNotFound } from "../../../../../lib/route-params";
import { getServerSession } from "../../../../../lib/server-session";

import { loadTransferRefs } from "../../../../api/v1/transfers/refs";
import { toTransferDetailResponse } from "../../../../api/v1/transfers/transfer-rows";

import { TransferActions, type TransferActionLineOption } from "./transfer-actions";
import { TransferLinesTable, TransferMovementsTable } from "./transfer-detail-tables";

export const dynamic = "force-dynamic";

const statusTone: Record<string, "info" | "success" | "warning" | "danger"> = {
  requested: "info",
  approved: "info",
  dispatched: "warning",
  received: "success",
};

function formatInstant(iso: string | null): string {
  return iso === null ? "—" : `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * Transfer detail (08_UI_UX.md §8.3, §8.6): the endpoints, the movement-derived
 * per-line dispatched/received facts, the paired ledger legs and the workflow
 * actions (approve/dispatch/receive/cancel). The transfer is org-checked before
 * any data is shown; a malformed id 404s.
 */
export default async function TransferDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const { id: rawId } = await params;
  const transferId = uuidOrNotFound(rawId);
  const organizationId = resolveOrganization();
  const store = createPostgresTransferStore(getDb().db);

  const detail = await getStockTransfer(store, { organizationId, transferId });
  if (detail === undefined) {
    notFound();
  }

  const [refs, items] = await Promise.all([
    loadTransferRefs(store, {
      locationIds: [detail.transfer.fromLocationId, detail.transfer.toLocationId],
      storageAreaIds: [detail.transfer.fromStorageAreaId, detail.transfer.toStorageAreaId],
      itemIds: detail.lines.map((line) => line.itemId),
    }),
    listStockedItems(store, { organizationId }),
  ]);
  const units = await Promise.all(
    [...new Set(items.map((item) => item.baseUnitId))].map((unitId) => store.findUnit(unitId)),
  );
  const unitCodeById = new Map(
    units.flatMap((unit) => (unit === undefined ? [] : [[unit.id, unit.code] as const])),
  );

  const response = toTransferDetailResponse(organizationId, detail, refs);
  const { transfer } = response;

  const itemOptions = items.map((item) => ({
    id: item.id,
    code: item.code,
    name: item.name,
    unitCode: unitCodeById.get(item.baseUnitId) ?? null,
  }));
  const dispatchedLines: TransferActionLineOption[] = response.lines.map((line) => ({
    itemId: line.itemId,
    itemCode: line.itemCode,
    itemName: line.itemName,
    unitCode: line.unitCode,
    lotId: line.lotId,
    dispatchedQuantity: line.dispatchedQuantity,
  }));

  const scopeMeta = `Transfer ${transfer.id.slice(0, 8)}… · moving weighted average (DEC-008)`;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: spacing[6],
        width: "100%",
        maxWidth: 1120,
        margin: "0 auto",
        padding: `${spacing[8]}px ${spacing[4]}px`,
      }}
    >
      <PageHeader
        title={`Transfer ${transfer.fromLocationLabel ?? "?"} → ${transfer.toLocationLabel ?? "?"}`}
        scope="Inventory · Transfers"
        description="Stock moves from the source to a virtual in-transit holding point on dispatch, and from there to the destination on receipt. The transit leg is eliminated in a consolidation."
      />

      <div style={{ display: "flex", gap: spacing[3], alignItems: "center", flexWrap: "wrap" }}>
        {statusTone[transfer.status] === undefined ? (
          <Badge>{transfer.status}</Badge>
        ) : (
          <StatusPill tone={statusTone[transfer.status]!}>{transfer.status}</StatusPill>
        )}
        <span>From {transfer.fromStorageAreaLabel ?? transfer.fromLocationLabel ?? "—"}</span>
        <span>To {transfer.toStorageAreaLabel ?? transfer.toLocationLabel ?? "—"}</span>
        <span>Dispatched {formatInstant(transfer.dispatchedAt)}</span>
        <span>Received {formatInstant(transfer.receivedAt)}</span>
      </div>

      {transfer.discrepancyNote === null ? null : (
        <Alert tone={transfer.hasDiscrepancy ? "warning" : "info"} title="Discrepancy note">
          {transfer.discrepancyNote}
        </Alert>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: spacing[4],
        }}
      >
        <KpiCard label="Dispatched" value={transfer.dispatchedQuantity} meta={scopeMeta} />
        <KpiCard label="Received" value={transfer.receivedQuantity} meta={scopeMeta} />
        <KpiCard
          label="Discrepancy"
          value={transfer.hasDiscrepancy ? "Yes" : "No"}
          meta={`${scopeMeta} · received differs from dispatched`}
        />
      </div>

      <SectionCard
        title="Lines"
        meta={`${response.lines.length} ${response.lines.length === 1 ? "line" : "lines"}`}
      >
        <TransferLinesTable rows={response.lines} />
      </SectionCard>

      <TransferActions
        transferId={transfer.id}
        status={transfer.status}
        items={itemOptions}
        dispatchedLines={dispatchedLines}
      />

      <SectionCard
        title="Paired movements"
        meta={`${response.movements.length} ${response.movements.length === 1 ? "leg" : "legs"}`}
      >
        <TransferMovementsTable rows={response.movements} />
      </SectionCard>
    </div>
  );
}
