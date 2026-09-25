import { createPostgresImportStore, listImportRuns } from "@aquarela/application";
import { KpiCard, PageHeader, SectionCard, Tabs, spacing } from "@aquarela/ui";
import { redirect } from "next/navigation";

import { getDb } from "../../../../lib/db";
import { resolveOrganization } from "../../../../lib/organization";
import { getServerSession } from "../../../../lib/server-session";

import { toImportRunRows } from "../../../api/v1/imports/import-rows";

import { NewRunForm } from "./new-run-form";
import { RunsTable } from "./runs-table";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sales import — Aquarela Business Control" };

const contentColumn = {
  display: "flex",
  flexDirection: "column",
  gap: spacing[6],
  maxWidth: 1120,
  margin: "0 auto",
  padding: `${spacing[8]}px ${spacing[4]}px`,
} as const;

/**
 * Sales import history (08_UI_UX.md §8.3: upload/history). Reads the same
 * application service and row mapping as `GET /api/v1/imports/runs`, so the
 * screen and the API cannot drift. Posting happens on the run detail screen
 * once the run is validated/needs-review (row 12, owner-gated on `ADR-0008`).
 */
export default async function SalesImportPage() {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const organizationId = resolveOrganization();
  const store = createPostgresImportStore(getDb().db);
  const summaries = await listImportRuns(store, { organizationId, limit: 100 });
  const rows = toImportRunRows(organizationId, summaries);

  const needsReview = rows.filter((row) => row.status === "needs_review").length;
  const validated = rows.filter(
    (row) => row.status === "validated" || row.status === "posted",
  ).length;
  const totalStaged = rows.reduce((sum, row) => sum + row.stagedCount, 0);

  return (
    <div style={contentColumn}>
      <PageHeader
        title="Sales import"
        scope="Sales"
        description="Register a sales export, stage, validate and map its rows, then post the validated run into sales and preview the source/posted totals."
      />

      <Tabs
        items={[
          { label: "Sales", href: "/sales" },
          { label: "Sales import", href: "/sales/import", active: true },
          { label: "Transactions", href: "/sales/transactions" },
          { label: "Reconciliation", href: "/sales/reconciliation" },
        ]}
        ariaLabel="Sales sections"
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: spacing[4],
        }}
      >
        <KpiCard label="Import runs" value={String(rows.length)} meta="Newest first" />
        <KpiCard
          label="Needs review"
          value={String(needsReview)}
          meta="Unmapped, conflicted or invalid rows"
        />
        <KpiCard label="Validated" value={String(validated)} meta="Ready for posting into sales" />
        <KpiCard label="Staged rows" value={String(totalStaged)} meta="Across all runs" />
      </div>

      <SectionCard
        title="Import history"
        meta={`${rows.length} ${rows.length === 1 ? "run" : "runs"}`}
      >
        <RunsTable rows={rows} />
      </SectionCard>

      <NewRunForm />
    </div>
  );
}
