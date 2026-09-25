import {
  createPostgresInventoryStore,
  getStockBalanceAsOf,
  listStockMovements,
} from "@aquarela/application";
import {
  MONEY_SCALE,
  QUANTITY_SCALE,
  deriveAverageUnitCost,
  formatDecimal,
  parseDecimal,
  rescale,
} from "@aquarela/domain";
import { KpiCard, PageHeader, SectionCard, spacing } from "@aquarela/ui";
import { notFound, redirect } from "next/navigation";

import { getDb } from "../../../../lib/db";
import { resolveOrganization } from "../../../../lib/organization";
import { uuidOrNotFound } from "../../../../lib/route-params";
import { getServerSession } from "../../../../lib/server-session";

import { toBalanceRows } from "../../../api/v1/inventory/balances/balance-rows";
import { toMovementRows, type MovementRow } from "../../../api/v1/inventory/movement-rows";
import { loadBalanceRefs, loadMovementRefs, loadReversedIds } from "../../../api/v1/inventory/refs";

import {
  BalancesTable,
  EXPIRING_SOON_DAYS,
  type BalanceTableRow,
  type ExpiryStatus,
} from "../balances-table";
import { MovementsTable, type MovementTableRow } from "../movements-table";

export const dynamic = "force-dynamic";

/** The page size of the movement history shown on the drill-down. */
const MOVEMENT_PAGE_SIZE = 50;

function formatInstant(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

function trimDecimal(value: string): string {
  if (!value.includes(".")) {
    return value === "-0" ? "0" : value;
  }
  const trimmed = value.replace(/\.?0+$/, "");
  const result = trimmed.length === 0 ? "0" : trimmed;
  return result === "-0" ? "0" : result;
}

function formatMoneyAmount(value: string): string {
  return formatDecimal(rescale(parseDecimal(value, MONEY_SCALE), MONEY_SCALE, 2), 2);
}

function expiryStatusFor(expiryDate: string | null, asOfDay: string): ExpiryStatus {
  if (expiryDate === null) {
    return "none";
  }
  const days = Math.round(
    (Date.parse(`${expiryDate}T00:00:00Z`) - Date.parse(`${asOfDay}T00:00:00Z`)) / 86_400_000,
  );
  if (days < 0) {
    return "expired";
  }
  return days <= EXPIRING_SOON_DAYS ? "expiring" : "ok";
}

function storageAreaLabel(row: {
  readonly storageAreaCode: string | null;
  readonly storageAreaName: string | null;
}): string {
  if (row.storageAreaCode !== null && row.storageAreaName !== null) {
    return `${row.storageAreaCode} · ${row.storageAreaName}`;
  }
  return row.storageAreaCode ?? row.storageAreaName ?? "—";
}

/**
 * Item drill-down (08_UI_UX.md §8.3): the item's balances by location, storage
 * area and lot, its valuation at moving weighted average, and its full movement
 * history with a reverse action per row. Empty states explain the missing source
 * (§8.4). The item is org-checked before any data is shown.
 */
export default async function InventoryItemPage({
  params,
}: {
  readonly params: Promise<{ readonly itemId: string }>;
}) {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const { itemId: rawItemId } = await params;
  const itemId = uuidOrNotFound(rawItemId);
  const organizationId = resolveOrganization();
  const store = createPostgresInventoryStore(getDb().db);

  const item = await store.findItem(itemId);
  if (item === undefined || item.organizationId !== organizationId) {
    notFound();
  }

  const asOf = new Date().toISOString();
  const balances = await getStockBalanceAsOf(store, { organizationId, asOf, itemId });
  const balanceRefs = await loadBalanceRefs(store, balances);
  const balanceRows = toBalanceRows(organizationId, balances, balanceRefs);

  const page = await listStockMovements(store, {
    organizationId,
    itemId,
    limit: MOVEMENT_PAGE_SIZE,
  });
  const [movementRefs, reversedIds] = await Promise.all([
    loadMovementRefs(store, page.movements),
    loadReversedIds(store, page.movements),
  ]);
  const movements = toMovementRows(organizationId, page.movements, movementRefs, reversedIds);

  const asOfLabel = formatInstant(asOf);
  const asOfDay = asOf.slice(0, 10);

  const tableRows: BalanceTableRow[] = balanceRows.map((row) => {
    const lot = row.lotId === null ? undefined : balanceRefs.lots.get(row.lotId);
    return {
      key: [row.itemId, row.locationId, row.storageAreaId, row.lotId ?? "no-lot"].join(":"),
      itemId: row.itemId,
      itemCode: row.itemCode,
      itemName: row.itemName,
      locationLabel: row.locationCode ?? "—",
      storageAreaLabel: storageAreaLabel(row),
      lotLabel: row.lotNumber,
      quantity: trimDecimal(row.quantityOnHand),
      unitCode: row.itemBaseUnitCode,
      value: formatMoneyAmount(row.valueOnHand),
      avgUnitCost: row.avgUnitCost === null ? null : formatMoneyAmount(row.avgUnitCost),
      expiryStatus: expiryStatusFor(lot?.expiryDate ?? null, asOfDay),
    };
  });

  let totalQuantity = 0n;
  let totalValue = 0n;
  for (const row of balanceRows) {
    totalQuantity += parseDecimal(row.quantityOnHand, QUANTITY_SCALE);
    totalValue += parseDecimal(row.valueOnHand, MONEY_SCALE);
  }
  const averageUnitCost = deriveAverageUnitCost(
    formatDecimal(totalQuantity, QUANTITY_SCALE),
    formatDecimal(totalValue, MONEY_SCALE),
  );
  const unitCode = balanceRows[0]?.itemBaseUnitCode ?? null;
  const currency = (await store.findOrganization(organizationId))?.currency ?? null;

  const movementRows: MovementTableRow[] = movements.map((row: MovementRow) => ({
    id: row.id,
    occurredLabel: formatInstant(row.occurredAt),
    movementType: row.movementType,
    itemLabel: row.itemName ?? row.itemId,
    locationLabel: row.locationCode ?? "—",
    storageAreaLabel:
      row.storageAreaCode !== null && row.storageAreaName !== null
        ? `${row.storageAreaCode} · ${row.storageAreaName}`
        : (row.storageAreaCode ?? row.storageAreaName ?? "—"),
    lotLabel: row.lotNumber,
    quantity: trimDecimal(row.quantityDelta),
    unitCode: row.unitCode,
    unitCost: row.unitCost === null ? null : formatMoneyAmount(row.unitCost),
    value: row.valueDelta === null ? null : formatMoneyAmount(row.valueDelta),
    reasonCode: row.reasonCode,
    reversed: row.reversed,
    isReversal: row.reversalOfId !== null,
  }));

  const scopeMeta = `As of ${asOfLabel} · all locations · moving weighted average (DEC-008)`;
  const valueLabel = `${formatDecimal(rescale(totalValue, MONEY_SCALE, 2), 2)}${
    currency === null ? "" : ` ${currency}`
  }`;
  const avgLabel =
    averageUnitCost === null
      ? "—"
      : `${formatDecimal(rescale(parseDecimal(averageUnitCost, MONEY_SCALE), MONEY_SCALE, 2), 2)}${
          currency === null ? "" : ` ${currency}`
        }`;

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
        title={item.name}
        scope={`Inventory · ${item.code}`}
        description={`Stock position and movement history for ${item.code}. Valuations use the moving weighted average (DEC-008).`}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: spacing[4],
        }}
      >
        <KpiCard label="Stock value" value={valueLabel} meta={scopeMeta} />
        <KpiCard
          label="Quantity on hand"
          value={`${trimDecimal(formatDecimal(totalQuantity, QUANTITY_SCALE))}${
            unitCode === null ? "" : ` ${unitCode}`
          }`}
          meta={`${scopeMeta} · across ${balanceRows.length} ${
            balanceRows.length === 1 ? "group" : "groups"
          }`}
        />
        <KpiCard label="Average unit cost" value={avgLabel} meta={scopeMeta} />
      </div>

      <SectionCard
        title="Balances"
        meta={`${tableRows.length} ${tableRows.length === 1 ? "row" : "rows"}`}
      >
        <div style={{ overflowX: "auto", minWidth: 0 }}>
          <BalancesTable rows={tableRows} currency={currency} asOfLabel={asOfLabel} />
        </div>
      </SectionCard>

      <SectionCard
        title="Movement history"
        meta={
          page.hasMore
            ? `showing the first ${MOVEMENT_PAGE_SIZE} · more exist`
            : `${movementRows.length} ${movementRows.length === 1 ? "movement" : "movements"}`
        }
      >
        <div style={{ overflowX: "auto", minWidth: 0 }}>
          <MovementsTable
            rows={movementRows}
            emptyMessage={`No movements for ${item.code} yet. A receipt, count, transfer, waste or adjustment will appear here, and every reversal is shown as its own row.`}
          />
        </div>
      </SectionCard>
    </div>
  );
}
