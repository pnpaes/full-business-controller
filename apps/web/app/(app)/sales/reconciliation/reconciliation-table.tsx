import { DataTable, EmptyState, StatusPill, color, typography } from "@aquarela/ui";
import type { DataTableColumn, DataTableRow } from "@aquarela/ui";
import Link from "next/link";

import type { ReconciliationRow } from "../../../api/v1/reconciliations/reconciliation-rows";
import { formatPeriod, orDash } from "../import-labels";
import { reconciliationStatusView } from "../sales-labels";

/**
 * Presentational reconciliation table (08_UI_UX.md §8.3). Server component: the
 * page owns the read and maps each row; this file only renders. The tolerance is
 * shown as the per-row snapshot — there is no tolerance-configuration table, so
 * nothing is re-derived (recorded open point).
 */

const COLUMNS: readonly DataTableColumn[] = [
  { key: "scope", header: "Scope" },
  { key: "period", header: "Period" },
  { key: "expected", header: "Expected", align: "right" },
  { key: "actual", header: "Actual", align: "right" },
  { key: "tolerance", header: "Tolerance", align: "right" },
  { key: "difference", header: "Difference", align: "right" },
  { key: "status", header: "Status" },
  { key: "resolution", header: "Resolution" },
];

const numCell = { fontVariantNumeric: "tabular-nums" } as const;

function scopeCell(row: ReconciliationRow): React.ReactNode {
  const href = row.scopeType === "import_run" ? `/sales/import/${row.scopeId}` : null;
  return (
    <span>
      <span style={{ fontWeight: typography.fontWeight.semibold }}>{row.scopeType}</span>
      <span
        style={{
          display: "block",
          fontFamily: typography.fontFamily.mono,
          fontSize: typography.fontSize.xs,
          color: color.text.muted,
        }}
      >
        {href === null ? row.scopeId : <Link href={href}>{row.scopeId}</Link>}
      </span>
    </span>
  );
}

export function ReconciliationTable({ rows }: { readonly rows: readonly ReconciliationRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState title="No reconciliations yet">
        A reconciliation row appears once a posted import run or a channel settlement is reconciled.
        Post a validated import run under <strong>Sales import</strong>, then reconcile it here.
      </EmptyState>
    );
  }

  const tableRows: DataTableRow[] = rows.map((row) => {
    const status = reconciliationStatusView(row.status);
    return {
      scope: scopeCell(row),
      period: formatPeriod(row.periodStart, row.periodEnd),
      expected: <span style={numCell}>{row.expectedAmount}</span>,
      actual: <span style={numCell}>{row.actualAmount}</span>,
      tolerance: <span style={numCell}>{row.tolerance}</span>,
      difference: <span style={numCell}>{row.difference}</span>,
      status: <StatusPill tone={status.tone}>{status.label}</StatusPill>,
      resolution: orDash(row.resolutionNote),
    };
  });

  return (
    <div style={{ overflowX: "auto", minWidth: 0 }}>
      <DataTable
        caption="Reconciliations, newest period first. Expected is the source total, actual is posted plus approved dispositions (import run) or posted sales (settlement); the tolerance is the per-row snapshot applied at reconciliation time (DEC-026, DEC-035)."
        columns={COLUMNS}
        rows={tableRows}
      />
    </div>
  );
}
