import { DataTable, EmptyState, StatusPill, color, typography } from "@aquarela/ui";
import type { DataTableColumn, DataTableRow } from "@aquarela/ui";

import type { ImportRunRow } from "../../../api/v1/imports/import-rows";
import { formatInstant, formatPeriod, importStatusView } from "../import-labels";

/**
 * Presentational import-run history table (08_UI_UX.md §8.3). Server component:
 * the page owns the read and maps each run into an HTTP row; this file only
 * renders. Posting lives on the run detail screen, not in this table.
 */

const COLUMNS: readonly DataTableColumn[] = [
  { key: "run", header: "Run · source" },
  { key: "period", header: "Period" },
  { key: "status", header: "Status" },
  { key: "rows", header: "Staged / mapped / unmapped", align: "right" },
  { key: "errors", header: "Errors", align: "right" },
  { key: "dispositions", header: "Dispositions", align: "right" },
  { key: "created", header: "Created" },
];

export function RunsTable({ rows }: { readonly rows: readonly ImportRunRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState title="No import runs yet">
        A run appears once a sales export is registered. Registering hashes the file so the same
        content cannot be imported twice; staging, validation and mapping then run through the
        application commands.
      </EmptyState>
    );
  }

  const tableRows: DataTableRow[] = rows.map((row) => ({
    run: (
      <span>
        <span style={{ fontWeight: typography.fontWeight.semibold }}>{row.source}</span>
        <span
          style={{
            display: "block",
            fontFamily: typography.fontFamily.mono,
            fontSize: typography.fontSize.xs,
            color: color.text.muted,
          }}
        >
          {row.id}
        </span>
      </span>
    ),
    period: formatPeriod(row.periodStart, row.periodEnd),
    status: (
      <StatusPill tone={importStatusView(row.status).tone}>
        {importStatusView(row.status).label}
      </StatusPill>
    ),
    rows: `${row.stagedCount} / ${row.mappedCount} / ${row.unmappedCount}`,
    errors: String(row.errorCount),
    dispositions: String(row.dispositionCount),
    created: formatInstant(row.createdAt),
  }));

  return (
    <div style={{ overflowX: "auto", minWidth: 0 }}>
      <DataTable
        caption="Sales import runs, newest first. Open a run to validate, map, disposition and post it."
        columns={COLUMNS}
        rows={tableRows}
        rowHref={(_row, index) => {
          const run = rows[index];
          return run === undefined ? "/sales/import" : `/sales/import/${run.id}`;
        }}
      />
    </div>
  );
}
