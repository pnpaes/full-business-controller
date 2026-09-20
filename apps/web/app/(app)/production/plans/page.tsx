import { createPostgresProductionStore, listProductionPlans } from "@aquarela/application";
import {
  DataTable,
  EmptyState,
  KpiCard,
  PageHeader,
  SectionCard,
  StatusPill,
  Tabs,
  spacing,
} from "@aquarela/ui";
import type { DataTableColumn, DataTableRow } from "@aquarela/ui";
import { redirect } from "next/navigation";

import { getDb } from "../../../../lib/db";
import { resolveOrganization } from "../../../../lib/organization";
import { getServerSession } from "../../../../lib/server-session";
import {
  parseProductionPlanListQuery,
  toProductionPlanRows,
} from "../../../api/v1/production/production-rows";

import { CreatePlanForm } from "./create-plan-form";
import { formatInstant, orDash, productionStatusView } from "../production-labels";

export const dynamic = "force-dynamic";
export const metadata = { title: "Production plans — Aquarela Business Control" };

const PLANS_LIMIT = 100;

const COLUMNS: readonly DataTableColumn[] = [
  { key: "date", header: "Production date" },
  { key: "location", header: "Location" },
  { key: "status", header: "Status" },
  { key: "created", header: "Created" },
];

const contentColumn = {
  display: "flex",
  flexDirection: "column",
  gap: spacing[6],
  width: "100%",
  maxWidth: 1120,
  margin: "0 auto",
  padding: `${spacing[8]}px ${spacing[4]}px`,
} as const;

/**
 * Production plans (08_UI_UX.md §8.3): the dated containers batches link to,
 * plus the create form. `production_plan` has no line/quantity table and no
 * status vocabulary authority (open points (f)), so a plan is a dated header and
 * its status is shown exactly as stored.
 */
export default async function ProductionPlansPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const rawParams = await searchParams;
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(rawParams)) {
    if (typeof value === "string") {
      sp.set(key, value);
    }
  }
  const parsed = parseProductionPlanListQuery(sp);
  const filter = parsed.ok ? parsed.query : undefined;

  const organizationId = resolveOrganization();
  const store = createPostgresProductionStore(getDb().db);
  const [page, locations] = await Promise.all([
    listProductionPlans(store, {
      organizationId,
      limit: PLANS_LIMIT,
      ...(filter?.locationId === undefined ? {} : { locationId: filter.locationId }),
      ...(filter?.status === undefined ? {} : { status: filter.status }),
    }),
    store.listLocations({ organizationId }),
  ]);

  const locationIds = [...new Set(page.plans.map((plan) => plan.locationId))];
  const found = await Promise.all(locationIds.map((id) => store.findLocation(id)));
  const locationMap = new Map(
    found.flatMap((location) => (location === undefined ? [] : [[location.id, location] as const])),
  );
  const rows = toProductionPlanRows(organizationId, page.plans, locationMap);

  const tableRows: DataTableRow[] = rows.map((row) => ({
    date: row.productionDate,
    location: `${orDash(row.locationCode ?? null)} · ${orDash(row.locationName ?? null)}`,
    status: (
      <StatusPill tone={productionStatusView(row.status).tone}>
        {productionStatusView(row.status).label}
      </StatusPill>
    ),
    created: formatInstant(row.createdAt),
  }));

  return (
    <div style={contentColumn}>
      <PageHeader
        title="Production plans"
        scope="Production"
        description="Dated plan headers a batch can link to. The plan carries no line detail or status vocabulary yet — it is a container, and the batches beneath it do the work."
      />

      <Tabs
        items={[
          { label: "Board", href: "/production" },
          { label: "Plans", href: "/production/plans", active: true },
        ]}
        ariaLabel="Production sections"
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: spacing[4],
        }}
      >
        <KpiCard
          label="Plans shown"
          value={String(tableRows.length)}
          meta={page.hasMore ? "Newest page · more exist" : "Newest production date first"}
        />
      </div>

      <SectionCard
        title="Plans"
        meta={`${tableRows.length} ${tableRows.length === 1 ? "plan" : "plans"}`}
      >
        {tableRows.length === 0 ? (
          <EmptyState title="No production plans yet">
            A plan appears once its date and location are recorded below. A batch links to a plan;
            the plan itself holds no quantities, because production_plan has no line table (open
            point (f)).
          </EmptyState>
        ) : (
          <DataTable
            caption="Production plan headers, newest production date first."
            columns={COLUMNS}
            rows={tableRows}
          />
        )}
      </SectionCard>

      <CreatePlanForm
        locations={locations.map((location) => ({
          id: location.id,
          code: location.code,
          name: location.name,
        }))}
        defaultLocationId={locations[0]?.id ?? ""}
      />
    </div>
  );
}
