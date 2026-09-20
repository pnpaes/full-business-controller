import { createPostgresCountStore, listStockCounts } from "@aquarela/application";
import type { InventoryLocationRecord } from "@aquarela/application";
import { KpiCard, PageHeader, SectionCard, spacing } from "@aquarela/ui";
import { redirect } from "next/navigation";

import { getDb } from "../../../../lib/db";
import { resolveOrganization } from "../../../../lib/organization";
import { getServerSession } from "../../../../lib/server-session";

import { toCountRows } from "../../../api/v1/counts/count-rows";

import { CountsTable, type CountTableRow } from "./counts-table";
import { OpenCountForm } from "./open-count-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Stock counts — Aquarela Business Control" };

/** ISO instant → "2026-02-01 00:00 UTC". */
function formatInstant(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * Counts list and open form (08_UI_UX.md §8.3). Reads the same application
 * service and row mapping as `GET /api/v1/counts`, so the screen and the API
 * cannot drift. A blind, unapproved count shows its variance count as hidden.
 */
export default async function CountsPage() {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const organizationId = resolveOrganization();
  const store = createPostgresCountStore(getDb().db);
  const summaries = await listStockCounts(store, { organizationId });

  const locationIds = [...new Set(summaries.map((summary) => summary.count.locationId))];
  const [foundLocations, allLocations] = await Promise.all([
    Promise.all(locationIds.map((id) => store.findLocation(id))),
    store.listLocations({ organizationId }),
  ]);
  const locations = new Map<string, InventoryLocationRecord>();
  for (const location of foundLocations) {
    if (location !== undefined) {
      locations.set(location.id, location);
    }
  }

  const rows: CountTableRow[] = toCountRows(organizationId, summaries, locations).map((row) => ({
    id: row.id,
    locationLabel: row.locationCode ?? row.locationId,
    cutoffLabel: formatInstant(row.cutoff),
    status: row.status,
    blind: row.blind,
    lineCount: row.lineCount,
    countedCount: row.countedCount,
    varianceCount: row.varianceCount,
  }));

  const openCount = rows.filter(
    (row) => row.status === "counting" || row.status === "draft",
  ).length;
  const approvedCount = rows.filter((row) => row.status === "approved").length;

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
        title="Stock counts"
        scope="Inventory"
        description="Risk-based cycle counts: snapshot the expected quantities, record what is on the shelf, then approve the variances."
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: spacing[4],
        }}
      >
        <KpiCard
          label="Open counts"
          value={String(openCount)}
          meta="Draft or counting · not yet approved"
        />
        <KpiCard label="Approved counts" value={String(approvedCount)} meta="Variances posted" />
        <KpiCard label="Total counts" value={String(rows.length)} meta="Newest cutoff first" />
      </div>

      <SectionCard title="Counts" meta={`${rows.length} ${rows.length === 1 ? "count" : "counts"}`}>
        <CountsTable rows={rows} />
      </SectionCard>

      <OpenCountForm
        locations={allLocations.map((location) => ({
          id: location.id,
          code: location.code,
          name: location.name,
        }))}
      />
    </div>
  );
}
