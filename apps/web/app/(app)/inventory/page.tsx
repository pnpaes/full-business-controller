import {
  createPostgresInventoryStore,
  getStockBalanceAsOf,
  listLocations,
  listStockedItems,
  listStorageAreas,
} from "@aquarela/application";
import {
  MONEY_SCALE,
  QUANTITY_SCALE,
  formatDecimal,
  parseDecimal,
  rescale,
} from "@aquarela/domain";
import { STORAGE_AREA_KIND } from "@aquarela/persistence";
import { Alert, KpiCard, PageHeader, SectionCard, spacing } from "@aquarela/ui";
import { redirect } from "next/navigation";

import { getDb } from "../../../lib/db";
import { resolveOrganization } from "../../../lib/organization";
import { getServerSession } from "../../../lib/server-session";

import { toBalanceRows } from "../../api/v1/inventory/balances/balance-rows";
import { loadBalanceRefs } from "../../api/v1/inventory/refs";

import {
  BalancesTable,
  EXPIRING_SOON_DAYS,
  type BalanceTableRow,
  type ExpiryStatus,
} from "./balances-table";
import {
  PostMovementForm,
  type MovementAreaOption,
  type MovementItemOption,
} from "./post-movement-form";
import { RegisterStorageAreaForm } from "./register-storage-area-form";
import { StorageAreasTable, type StorageAreaTableRow } from "./storage-areas-table";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inventory — Aquarela Business Control" };

/* ----------------------------- formatting / view --------------------------- */

/** ISO instant → "2026-09-20 12:42 UTC" (the read is always at the request time). */
function formatInstant(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

/** Trims trailing zeros from a canonical decimal string without changing its value. */
function trimDecimal(value: string): string {
  if (!value.includes(".")) {
    return value === "-0" ? "0" : value;
  }
  const trimmed = value.replace(/\.?0+$/, "");
  const result = trimmed.length === 0 ? "0" : trimmed;
  return result === "-0" ? "0" : result;
}

/** Monetary numeric(19,4) string → 2dp display string, HALF_UP (DEC-024). */
function formatMoneyAmount(value: string): string {
  return formatDecimal(rescale(parseDecimal(value, MONEY_SCALE), MONEY_SCALE, 2), 2);
}

function hasStock(quantityOnHand: string): boolean {
  return parseDecimal(quantityOnHand, QUANTITY_SCALE) !== 0n;
}

/** Lot-expiry status for a `date` column, relative to the as-of day. */
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

/* ---------------------------------- page ----------------------------------- */

/**
 * Inventory: as-of balances (08_UI_UX.md §8.3) by location, storage area and lot
 * at moving weighted average cost (DEC-008), plus the two write surfaces this
 * slice exposes — a manual adjustment/waste form and storage-area registration.
 * The balances read directly through the same application service the read API
 * uses and reuses the route's `toBalanceRows` mapping, so the page and
 * `GET /api/v1/inventory/balances` cannot drift. Item names link to the
 * per-item drill-down.
 */
export default async function InventoryPage() {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const organizationId = resolveOrganization();
  const store = createPostgresInventoryStore(getDb().db);
  const asOf = new Date().toISOString();

  const balances = await getStockBalanceAsOf(store, { organizationId, asOf });
  const refs = await loadBalanceRefs(store, balances);
  const rows = toBalanceRows(organizationId, balances, refs);
  const organization = await store.findOrganization(organizationId);
  const currency = organization?.currency ?? null;

  const [items, locations, areas] = await Promise.all([
    listStockedItems(store, { organizationId }),
    listLocations(store, { organizationId }),
    listStorageAreas(store, { organizationId }),
  ]);
  const units = await Promise.all(
    [...new Set(items.map((item) => item.baseUnitId))].map((id) => store.findUnit(id)),
  );
  const unitCodeById = new Map(
    units.flatMap((unit) => (unit === undefined ? [] : [[unit.id, unit.code] as const])),
  );
  const locationCodeById = new Map(locations.map((location) => [location.id, location.code]));

  const asOfLabel = formatInstant(asOf);
  const asOfDay = asOf.slice(0, 10);

  const tableRows: BalanceTableRow[] = rows.map((row) => {
    const lot = row.lotId === null ? undefined : refs.lots.get(row.lotId);
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

  const stockedRows = tableRows.filter((row) => hasStock(row.quantity));
  const itemCount = new Set(stockedRows.map((row) => row.itemId)).size;
  const expiredCount = stockedRows.filter((row) => row.expiryStatus === "expired").length;
  const expiringCount = stockedRows.filter((row) => row.expiryStatus === "expiring").length;

  let totalValue = 0n;
  for (const row of rows) {
    totalValue += parseDecimal(row.valueOnHand, MONEY_SCALE);
  }
  const totalValueLabel = `${formatDecimal(rescale(totalValue, MONEY_SCALE, 2), 2)}${
    currency === null ? " (currency not set)" : ` ${currency}`
  }`;

  const scopeMeta = `As of ${asOfLabel} · all locations · moving weighted average (DEC-008)`;

  const itemOptions: MovementItemOption[] = items.map((item) => ({
    id: item.id,
    code: item.code,
    name: item.name,
    unitCode: unitCodeById.get(item.baseUnitId) ?? null,
  }));
  const locationOptions = locations.map((location) => ({
    id: location.id,
    code: location.code,
    name: location.name,
    kind: location.kind,
  }));
  const areaOptions: MovementAreaOption[] = areas.map((area) => ({
    id: area.id,
    locationId: area.locationId,
    code: area.code,
    name: area.name,
  }));

  const storageAreaRows: StorageAreaTableRow[] = areas.map((area) => ({
    id: area.id,
    code: area.code,
    name: area.name,
    kind: area.kind,
    locationLabel: locationCodeById.get(area.locationId) ?? "—",
    isTransit: area.isTransit,
  }));

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
        title="Inventory"
        scope="Aquarela Business Control"
        description="On-hand stock by location, storage area and lot, valued at moving weighted average cost."
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: spacing[4],
        }}
      >
        <KpiCard label="Stock value" value={totalValueLabel} meta={scopeMeta} />
        <KpiCard
          label="Items with stock"
          value={String(itemCount)}
          meta={`${scopeMeta} · rows with a non-zero balance`}
        />
        <KpiCard
          label={`Lots expiring ≤${EXPIRING_SOON_DAYS} days`}
          value={String(expiringCount)}
          meta={`${scopeMeta} · lots with stock and a recorded expiry date`}
        />
      </div>

      {expiredCount + expiringCount > 0 ? (
        <Alert tone={expiredCount > 0 ? "danger" : "warning"} title="Expiry attention">
          {expiredCount} {expiredCount === 1 ? "lot has" : "lots have"} already expired and{" "}
          {expiringCount} {expiringCount === 1 ? "lapses" : "lapse"} within {EXPIRING_SOON_DAYS}{" "}
          days (lots with stock and a recorded expiry date). Review these lots for use, transfer or
          waste before they lapse.
        </Alert>
      ) : null}

      <SectionCard
        title="Balances"
        meta={`${tableRows.length} ${tableRows.length === 1 ? "row" : "rows"}`}
      >
        <BalancesTable rows={tableRows} currency={currency} asOfLabel={asOfLabel} />
      </SectionCard>

      <PostMovementForm items={itemOptions} locations={locationOptions} areas={areaOptions} />

      <SectionCard
        title="Storage areas"
        meta={`${storageAreaRows.length} ${storageAreaRows.length === 1 ? "area" : "areas"}`}
      >
        <StorageAreasTable rows={storageAreaRows} />
        <div style={{ marginTop: spacing[6] }}>
          <h3 style={{ margin: `0 0 ${spacing[3]}px`, fontSize: 18 }}>Register a storage area</h3>
          <RegisterStorageAreaForm locations={locationOptions} kinds={STORAGE_AREA_KIND} />
        </div>
      </SectionCard>
    </div>
  );
}
