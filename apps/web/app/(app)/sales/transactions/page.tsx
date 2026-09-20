import { createPostgresSalesStore, listSalesTransactions } from "@aquarela/application";
import { KpiCard, PageHeader, SectionCard, Tabs, spacing } from "@aquarela/ui";
import { redirect } from "next/navigation";

import { getDb } from "../../../../lib/db";
import { resolveOrganization } from "../../../../lib/organization";
import { getServerSession } from "../../../../lib/server-session";
import { loadSalesRefs } from "../../../api/v1/sales/sales-refs";
import { toSalesTransactionRows } from "../../../api/v1/sales/sales-rows";

import { TransactionsTable } from "./transactions-table";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sales transactions — Aquarela Business Control" };

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
 * Posted sales transactions (08_UI_UX.md §8.3). Reads the same application
 * service and row mapping as `GET /api/v1/sales/transactions`, so the screen and
 * the API cannot drift. Figures are the stored header totals; nothing is
 * computed for display beyond the line count the query itself returns.
 */
export default async function SalesTransactionsPage() {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const organizationId = resolveOrganization();
  const db = getDb().db;
  const store = createPostgresSalesStore(db);
  const page = await listSalesTransactions(store, { organizationId, limit: 100 });

  const lineCounts = new Map<string, number>();
  for (const transaction of page.transactions) {
    const lines = await store.listSalesLines({
      organizationId,
      salesTransactionId: transaction.id,
    });
    lineCounts.set(transaction.id, lines.length);
  }

  const refs = await loadSalesRefs(db, organizationId, page.transactions);
  const rows = toSalesTransactionRows(organizationId, page.transactions, refs, lineCounts);

  const lineItems = rows.reduce((sum, row) => sum + row.lineCount, 0);
  const currencies = [...new Set(rows.map((row) => row.currency))].sort();

  return (
    <div style={contentColumn}>
      <PageHeader
        title="Sales transactions"
        scope="Sales"
        description="Posted POS/food-app transactions, newest first, with their location, channel and header totals. Open one to see its lines."
      />

      <Tabs
        items={[
          { label: "Sales", href: "/sales" },
          { label: "Sales import", href: "/sales/import" },
          { label: "Transactions", href: "/sales/transactions", active: true },
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
        <KpiCard
          label="Transactions"
          value={String(rows.length)}
          meta={page.hasMore ? "Newest 100 (more exist)" : "All posted transactions"}
        />
        <KpiCard
          label="Line items"
          value={String(lineItems)}
          meta="Across the listed transactions"
        />
        <KpiCard
          label="Currencies"
          value={currencies.length === 0 ? "—" : currencies.join(", ")}
          meta="No conversion is applied"
        />
      </div>

      <SectionCard
        title="Transactions"
        meta={`${rows.length} ${rows.length === 1 ? "row" : "rows"}`}
      >
        <TransactionsTable rows={rows} />
      </SectionCard>
    </div>
  );
}
