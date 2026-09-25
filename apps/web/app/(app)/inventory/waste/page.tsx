import {
  createPostgresWasteStore,
  listLocations,
  listStockedItems,
  listStorageAreas,
  listWasteEvents,
} from "@aquarela/application";
import { MONEY_SCALE, formatDecimal, parseDecimal, rescale } from "@aquarela/domain";
import { WASTE_STAGE } from "@aquarela/persistence";
import { EmptyState, KpiCard, PageHeader, SectionCard, spacing } from "@aquarela/ui";
import { redirect } from "next/navigation";

import { getDb } from "../../../../lib/db";
import { resolveOrganization } from "../../../../lib/organization";
import { getServerSession } from "../../../../lib/server-session";

import { loadWasteRefs } from "../../../api/v1/waste/refs";
import { toWasteEventRows } from "../../../api/v1/waste/waste-rows";

import {
  RecordWasteForm,
  type WasteAreaOption,
  type WasteItemOption,
  type WasteLocationOption,
} from "./record-waste-form";
import { wasteStageLabel, wasteStageOptions } from "./waste-labels";
import { WasteTable, type WasteTableRow } from "./waste-table";

export const dynamic = "force-dynamic";
export const metadata = { title: "Waste — Aquarela Business Control" };

/** The page size of the waste log shown on the list. */
const WASTE_PAGE_SIZE = 50;

/** ISO instant → "2026-01-02 10:00 UTC". */
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
function formatMoney(value: string): string {
  return formatDecimal(rescale(parseDecimal(value, MONEY_SCALE), MONEY_SCALE, 2), 2);
}

/**
 * Waste log (08_UI_UX.md §8.3) plus the fast entry form (§8.6) — `WASTE-001`.
 * The page reads through the same application service and mapping the read API
 * uses, so the screen and `GET /api/v1/waste` cannot drift. Real data only: when
 * there are no events the log shows an `EmptyState` explaining what is missing.
 */
export default async function WastePage() {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const organizationId = resolveOrganization();
  const store = createPostgresWasteStore(getDb().db);

  const page = await listWasteEvents(store, { organizationId, limit: WASTE_PAGE_SIZE });
  const refs = await loadWasteRefs(store, page.events);
  const rows = toWasteEventRows(organizationId, page.events, refs);
  const currency = (await store.findOrganization(organizationId))?.currency ?? null;

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

  const tableRows: WasteTableRow[] = rows.map((row) => ({
    key: row.id,
    date: formatInstant(row.occurredAt),
    item: row.itemLabel ?? row.variantLabel ?? row.itemId ?? "—",
    quantity: trimDecimal(row.quantity),
    unitCode: row.unitCode,
    stage: wasteStageLabel(row.stage),
    reason: row.reasonCode,
    value: row.value === null ? "—" : formatMoney(row.value),
  }));

  let totalValue = 0n;
  for (const row of rows) {
    if (row.value !== null) {
      totalValue += parseDecimal(row.value, MONEY_SCALE);
    }
  }
  const totalValueLabel = `${formatDecimal(rescale(totalValue, MONEY_SCALE, 2), 2)}${
    currency === null ? "" : ` ${currency}`
  }`;

  const itemOptions: WasteItemOption[] = items.map((item) => ({
    id: item.id,
    code: item.code,
    name: item.name,
    unitCode: unitCodeById.get(item.baseUnitId) ?? null,
  }));
  const locationOptions: WasteLocationOption[] = locations.map((location) => ({
    id: location.id,
    code: location.code,
    name: location.name,
  }));
  const areaOptions: WasteAreaOption[] = areas.map((area) => ({
    id: area.id,
    locationId: area.locationId,
    code: area.code,
    name: area.name,
  }));

  const scopeMeta = `All locations · newest ${WASTE_PAGE_SIZE} · moving weighted average (DEC-008)`;

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
        title="Waste"
        scope="Inventory · waste"
        description="Waste recorded by item or product, stage and reason, valued at the moving weighted average cost (DEC-008)."
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: spacing[4],
        }}
      >
        <KpiCard
          label="Waste events"
          value={String(tableRows.length)}
          meta={`${scopeMeta}${page.hasMore ? " · more exist" : ""}`}
        />
        <KpiCard label="Waste value" value={totalValueLabel} meta={scopeMeta} />
      </div>

      <SectionCard
        title="Waste log"
        meta={
          page.hasMore
            ? `showing the newest ${WASTE_PAGE_SIZE} · more exist`
            : `${tableRows.length} ${tableRows.length === 1 ? "event" : "events"}`
        }
      >
        {tableRows.length === 0 ? (
          <EmptyState title="No waste recorded yet">
            Waste appears here once an event is recorded with the form below. Each event posts a
            negative waste movement to the stock ledger, so the value shown is the ledger's own
            outbound value at the moving weighted average.
          </EmptyState>
        ) : (
          <div style={{ overflowX: "auto", minWidth: 0 }}>
            <WasteTable rows={tableRows} currency={currency} />
          </div>
        )}
      </SectionCard>

      <RecordWasteForm
        items={itemOptions}
        locations={locationOptions}
        areas={areaOptions}
        stages={wasteStageOptions(WASTE_STAGE)}
      />
    </div>
  );
}
