import {
  createPostgresImportStore,
  createPostgresReconciliationStore,
  listImportRuns,
  listReconciliations,
} from "@aquarela/application";
import { Alert, KpiCard, PageHeader, SectionCard, Tabs, spacing } from "@aquarela/ui";
import { redirect } from "next/navigation";

import { getDb } from "../../../../lib/db";
import { resolveOrganization } from "../../../../lib/organization";
import { getServerSession } from "../../../../lib/server-session";
import { toReconciliationRows } from "../../../api/v1/reconciliations/reconciliation-rows";
import { formatPeriod } from "../import-labels";
import { isOpenReconciliation, TOLERANCE_DECISION_LABEL } from "../sales-labels";

import { ReconcileForm } from "./reconcile-form";
import { ReconciliationTable } from "./reconciliation-table";
import { ResolveForm } from "./resolve-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reconciliation — Aquarela Business Control" };

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
 * Reconciliation (08_UI_UX.md §8.3): the source/posted/settlement totals, the
 * tolerance snapshot, the difference and the resolution trail. Reads the same
 * application service and row mapping as `GET /api/v1/reconciliations`, so the
 * screen and the API cannot drift.
 *
 * Recorded, not resolved: there is no tolerance-configuration table (`DEC-026`'s
 * effective-dated config), so the per-row snapshot is shown and no threshold is
 * re-applied; `reconciliation.scope_type` values are unresolved, so the label is
 * whatever the command wrote; and `settlement.status` has no vocabulary, so a
 * settlement is stored facts only and its reconciliation is the judgement.
 */
export default async function ReconciliationPage() {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const organizationId = resolveOrganization();
  const db = getDb().db;
  const store = createPostgresReconciliationStore(db);
  const page = await listReconciliations(store, { organizationId, limit: 100 });
  const rows = toReconciliationRows(organizationId, page.reconciliations);

  const importStore = createPostgresImportStore(db);
  const runSummaries = await listImportRuns(importStore, { organizationId, limit: 100 });
  const postedRuns = runSummaries
    .filter(
      (summary) => summary.run.status === "posted" || summary.run.status === "partially_posted",
    )
    .map((summary) => ({
      id: summary.run.id,
      source: summary.run.source,
      period: formatPeriod(summary.run.periodStart, summary.run.periodEnd),
    }));
  const settlementRows = await store.listSettlements({ organizationId, limit: 100 });
  const settlements = settlementRows.flatMap((settlement) =>
    settlement.paidAmount === null
      ? []
      : [
          {
            id: settlement.id,
            provider: settlement.provider,
            period: formatPeriod(settlement.periodStart, settlement.periodEnd),
            paidAmount: settlement.paidAmount,
            currency: settlement.currency,
          },
        ],
  );
  const settlementsWithoutPaidAmount = settlementRows.length - settlements.length;

  const exceptions = rows.filter((row) => row.status === "exception").length;
  const withinTolerance = rows.filter((row) => row.status === "within_tolerance").length;
  const open = rows.filter((row) => isOpenReconciliation(row.status));

  return (
    <div style={contentColumn}>
      <PageHeader
        title="Reconciliation"
        scope="Sales"
        description="Source vs posted totals for import runs and channel settlements, with the tolerance snapshot, the difference and the resolution trail."
      />

      <Tabs
        items={[
          { label: "Sales", href: "/sales" },
          { label: "Sales import", href: "/sales/import" },
          { label: "Transactions", href: "/sales/transactions" },
          { label: "Reconciliation", href: "/sales/reconciliation", active: true },
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
        <KpiCard
          label="Reconciliations"
          value={String(rows.length)}
          meta={page.hasMore ? "Newest 100 (more exist)" : "All reconciliations"}
        />
        <KpiCard
          label="Within tolerance"
          value={String(withinTolerance)}
          meta="Difference within the snapshot"
        />
        <KpiCard
          label="Exceptions"
          value={String(exceptions)}
          meta="Difference outside the tolerance"
        />
        <KpiCard
          label="Open"
          value={String(open.length)}
          meta="Pending, exception or within tolerance"
        />
      </div>

      <Alert tone="info" title="Tolerance">
        The tolerance is {TOLERANCE_DECISION_LABEL}. A reconciliation is created with the caller's
        explicit tolerance or an explicit opt-in to the published <strong>DEC-026</strong> default
        (max of 0.5% and 5 NOK); a missing tolerance blocks close rather than defaulting silently.
      </Alert>

      {postedRuns.length > 0 || settlements.length > 0 ? (
        <ReconcileForm runs={postedRuns} settlements={settlements} />
      ) : (
        <Alert tone="info" title="Nothing to reconcile yet">
          Post a validated import run under <strong>Sales import</strong>, or record a channel
          settlement, then reconcile it here.
        </Alert>
      )}

      {settlementsWithoutPaidAmount > 0 ? (
        <Alert tone="info" title="Settlements without a paid amount">
          {settlementsWithoutPaidAmount} settlement
          {settlementsWithoutPaidAmount === 1 ? "" : "s"} without a paid amount{" "}
          {settlementsWithoutPaidAmount === 1 ? "is" : "are"} not offered for reconciliation: a
          settlement with no paid amount cannot be reconciled.
        </Alert>
      ) : null}

      <SectionCard
        title="Reconciliations"
        meta={`${rows.length} ${rows.length === 1 ? "row" : "rows"}`}
      >
        <ReconciliationTable rows={rows} />
      </SectionCard>

      {open.length > 0 ? (
        <ResolveForm
          rows={open.map((row) => ({
            id: row.id,
            scopeType: row.scopeType,
            scopeId: row.scopeId,
            status: row.status,
            difference: row.difference,
          }))}
        />
      ) : null}

      <Alert tone="info" title="Settlements">
        A settlement's <code>paid_amount</code> is the provider's own source total;{" "}
        <code>settlement.status</code> has no vocabulary yet (recorded open point), so a settlement
        is stored facts only and its reconciliation is the judgement.
      </Alert>
    </div>
  );
}
