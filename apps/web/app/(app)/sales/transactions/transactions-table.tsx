import { DataTable, EmptyState, color, typography } from "@aquarela/ui";
import type { DataTableColumn, DataTableRow } from "@aquarela/ui";

import type { SalesTransactionRow } from "../../../api/v1/sales/sales-rows";
import { formatInstant, orDash } from "../import-labels";

/**
 * Presentational posted-sales table (08_UI_UX.md §8.3). Server component: the
 * page owns the read and maps each transaction into an HTTP row; this file only
 * renders. Amounts are shown exactly as stored (`numeric(19,4)`) — no figure is
 * derived or rounded here.
 */

const COLUMNS: readonly DataTableColumn[] = [
  { key: "date", header: "Date" },
  { key: "location", header: "Location" },
  { key: "channel", header: "Channel" },
  { key: "gross", header: "Gross", align: "right" },
  { key: "net", header: "Net", align: "right" },
  { key: "tax", header: "Tax", align: "right" },
  { key: "lines", header: "Lines", align: "right" },
];

function refLabel(code: string | null, name: string | null): string {
  if (code === null && name === null) {
    return "—";
  }
  return code !== null && name !== null && code !== name ? `${code} · ${name}` : (code ?? name)!;
}

const numCell = { fontVariantNumeric: "tabular-nums" } as const;

export function TransactionsTable({ rows }: { readonly rows: readonly SalesTransactionRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState title="No posted sales transactions yet">
        A transaction appears once a validated import run is posted. Register and validate an export
        under <strong>Sales import</strong>, record a disposition for every row that will not post,
        then post the run.
      </EmptyState>
    );
  }

  const tableRows: DataTableRow[] = rows.map((row) => ({
    date: (
      <span>
        {formatInstant(row.occurredAt)}
        <span
          style={{
            display: "block",
            fontFamily: typography.fontFamily.mono,
            fontSize: typography.fontSize.xs,
            color: color.text.muted,
          }}
        >
          {row.externalTransactionId}
        </span>
      </span>
    ),
    location: refLabel(row.locationCode, row.locationName),
    channel: refLabel(row.channelCode, row.channelName),
    gross: <span style={numCell}>{orDash(row.grossAmount)}</span>,
    net: <span style={numCell}>{orDash(row.netAmount)}</span>,
    tax: <span style={numCell}>{orDash(row.taxAmount)}</span>,
    lines: String(row.lineCount),
  }));

  return (
    <div style={{ overflowX: "auto", minWidth: 0 }}>
      <DataTable
        caption="Posted sales transactions, newest first. Amounts are the header totals: an included zero-price option line is retained for consumption but excluded from these totals (DEC-043)."
        columns={COLUMNS}
        rows={tableRows}
        rowHref={(_row, index) => {
          const transaction = rows[index];
          return transaction === undefined
            ? "/sales/transactions"
            : `/sales/transactions/${transaction.id}`;
        }}
      />
    </div>
  );
}
