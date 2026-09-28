import {
  createPostgresProductionStore,
  createPostgresRecipeStore,
  listProductionBatches,
  listProductionPlans,
  listRecipes,
} from "@aquarela/application";
import { Alert, EmptyState, KpiCard, PageHeader, SectionCard, Tabs, spacing } from "@aquarela/ui";
import { redirect } from "next/navigation";

import { getDb } from "../../../lib/db";
import { resolveOrganization } from "../../../lib/organization";
import { getServerSession } from "../../../lib/server-session";
import {
  loadProductionRefs,
  parseProductionBatchListQuery,
  toProductionBatchRows,
} from "../../api/v1/production/production-rows";

import { ProductionBoardTable } from "./board-table";
import {
  CreateBatchForm,
  type BatchPlanLineOption,
  type RecipeVersionOption,
} from "./create-batch-form";
import { hasYieldVariance, productionStatusView, trimDecimal } from "./production-labels";

export const dynamic = "force-dynamic";
export const metadata = { title: "Production board — Aquarela Business Control" };

/** The board shows a bounded working set; the read API pages beyond it. */
const BOARD_LIMIT = 100;

/** Board grouping order, the batch workflow (`PRODUCTION_STATUS`). */
const STATUS_ORDER = ["planned", "released", "in_progress", "completed", "cancelled"] as const;

const contentColumn = {
  display: "flex",
  flexDirection: "column",
  gap: spacing[6],
  maxWidth: 1120,
  margin: "0 auto",
  padding: `${spacing[8]}px ${spacing[4]}px`,
} as const;

/**
 * Production board (08_UI_UX.md §8.3): every batch grouped and filtered by
 * status, with location, recipe version, planned vs actual output and the stored
 * yield variance. Reads the same application service and row mapping as
 * `GET /api/v1/production/batches`, so the screen and the API cannot drift.
 *
 * Yield variance is shown as a fact: `PROD-003` has no tolerance or exception
 * store, so this screen does not invent a threshold — it flags any non-zero
 * variance and says so.
 */
export default async function ProductionPage({
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
  const parsed = parseProductionBatchListQuery(sp);
  const filter = parsed.ok ? parsed.query : undefined;

  const organizationId = resolveOrganization();
  const store = createPostgresProductionStore(getDb().db);
  const page = await listProductionBatches(store, {
    organizationId,
    limit: BOARD_LIMIT,
    ...(filter?.locationId === undefined ? {} : { locationId: filter.locationId }),
    ...(filter?.status === undefined ? {} : { status: filter.status }),
  });
  const refs = await loadProductionRefs(store, organizationId, page.batches);
  const rows = toProductionBatchRows(organizationId, page.batches, refs);

  // The plan-a-batch form needs the approved recipe versions and the location's
  // storage areas; only the latest approved version of each recipe is offered.
  const [locations, areas, listed, planPage] = await Promise.all([
    store.listLocations({ organizationId }),
    store.listStorageAreas({ organizationId }),
    listRecipes(createPostgresRecipeStore(getDb().db), { organizationId }),
    listProductionPlans(store, { organizationId, limit: 200 }),
  ]);
  const recipeVersions: RecipeVersionOption[] = listed.flatMap((entry) => {
    const version = entry.latestVersion;
    if (version === null || version.state !== "approved") {
      return [];
    }
    return [
      {
        id: version.id,
        recipeCode: entry.recipe.code,
        recipeName: entry.recipe.name,
        versionNo: version.versionNo,
      },
    ];
  });
  const versionLabel = new Map(
    recipeVersions.map((option) => [
      option.id,
      `${option.recipeCode} · ${option.recipeName} v${option.versionNo}`,
    ]),
  );
  // `DEC-125`: a batch may be created from any plan line.
  const planLines: BatchPlanLineOption[] = planPage.plans.flatMap((plan) =>
    plan.lines.map((line) => ({
      id: line.id,
      planId: plan.id,
      recipeVersionId: line.recipeVersionId,
      label: `${versionLabel.get(line.recipeVersionId) ?? line.recipeVersionId} · ${plan.productionDate} × ${trimDecimal(line.plannedQty)}`,
      plannedQty: line.plannedQty,
    })),
  );

  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
  }
  const completedWithVariance = rows.filter(
    (row) => row.status === "completed" && hasYieldVariance(row.yieldVariancePct),
  ).length;

  const groups = STATUS_ORDER.map((status) => ({
    status,
    rows: rows.filter((row) => row.status === status),
  })).filter((group) => group.rows.length > 0);

  const tabItems = [
    { label: "All", href: "/production", active: filter?.status === undefined },
    ...STATUS_ORDER.map((status) => ({
      label: productionStatusView(status).label,
      href: `/production?status=${status}`,
      active: filter?.status === status,
    })),
  ];

  return (
    <div style={contentColumn}>
      <PageHeader
        title="Production board"
        scope="Production"
        description="Plan and complete batches against an approved recipe version. Yield variance is stored per batch and shown as a fact; no alert threshold is applied."
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: spacing[4],
        }}
      >
        <KpiCard
          label="Planned"
          value={String(counts.get("planned") ?? 0)}
          meta="Waiting to be released"
        />
        <KpiCard
          label="Released"
          value={String(counts.get("released") ?? 0)}
          meta="Queued for production"
        />
        <KpiCard
          label="In progress"
          value={String(counts.get("in_progress") ?? 0)}
          meta="Started, not yet completed"
        />
        <KpiCard
          label="Completed"
          value={String(counts.get("completed") ?? 0)}
          meta="Movements posted to the ledger"
        />
      </div>

      <Tabs items={tabItems} ariaLabel="Filter batches by status" />

      {completedWithVariance > 0 ? (
        <Alert tone="warning" title="Yield variance">
          {completedWithVariance}{" "}
          {completedWithVariance === 1 ? "completed batch differs" : "completed batches differ"}{" "}
          from its planned output. Yield variance is stored as a fact; no alert threshold is
          applied, so this is shown for review only.
        </Alert>
      ) : null}

      {rows.length === 0 ? (
        <SectionCard title="Batches" meta="nothing yet">
          <EmptyState title="No production batches yet">
            A batch appears once one is planned against an approved recipe version. Planning
            snapshots the recipe's planned inputs and output onto the batch; the ledger is untouched
            until the batch is completed.
          </EmptyState>
        </SectionCard>
      ) : (
        groups.map((group) => {
          const view = productionStatusView(group.status);
          return (
            <SectionCard
              key={group.status}
              title={view.label}
              meta={`${group.rows.length} ${group.rows.length === 1 ? "batch" : "batches"}`}
            >
              <div style={{ overflowX: "auto", minWidth: 0 }}>
                <ProductionBoardTable rows={group.rows} />
              </div>
            </SectionCard>
          );
        })
      )}

      <CreateBatchForm
        recipeVersions={recipeVersions}
        locations={locations.map((location) => ({
          id: location.id,
          code: location.code,
          name: location.name,
        }))}
        areas={areas.map((area) => ({
          id: area.id,
          locationId: area.locationId,
          code: area.code,
          name: area.name,
        }))}
        planLines={planLines}
        defaultLocationId={locations[0]?.id ?? ""}
      />
    </div>
  );
}
