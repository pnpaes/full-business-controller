import {
  DataTable,
  type DataTableColumn,
  type DataTableRow,
  color,
  typography,
} from "@aquarela/ui";

/**
 * Presentational waste-event ledger for the waste list (08_UI_UX.md §8.3/§8.5).
 * Server component: the page owns the read, the labels and the formatting; this
 * file only renders. The caller renders `EmptyState` instead when there are no
 * rows.
 */

export interface WasteTableRow {
  readonly key: string;
  readonly date: string;
  readonly item: string;
  readonly quantity: string;
  readonly unitCode: string | null;
  readonly stage: string;
  readonly reason: string;
  readonly value: string;
}

const COLUMNS: readonly DataTableColumn[] = [
  { key: "date", header: "Date" },
  { key: "item", header: "Item" },
  { key: "quantity", header: "Quantity", align: "right" },
  { key: "stage", header: "Stage" },
  { key: "reason", header: "Reason" },
  { key: "value", header: "Value", align: "right" },
];

export interface WasteTableProps {
  readonly rows: readonly WasteTableRow[];
  readonly currency: string | null;
}

export function WasteTable({ rows, currency }: WasteTableProps) {
  const tableRows: DataTableRow[] = rows.map((row) => ({
    date: row.date,
    item: row.item,
    quantity: (
      <span style={{ fontWeight: typography.fontWeight.semibold }}>
        {row.quantity}
        {row.unitCode === null ? (
          <span style={{ color: color.status.warning.fg, fontSize: typography.fontSize.xs }}>
            {" "}
            unit not set
          </span>
        ) : (
          ` ${row.unitCode}`
        )}
      </span>
    ),
    stage: row.stage,
    reason: row.reason,
    value: currency === null ? row.value : `${row.value} ${currency}`,
  }));

  return (
    <DataTable
      caption="Recorded waste events, newest first. Quantity pairs with the event's unit; value is the ledger movement's magnitude at the moving weighted average (DEC-008)."
      columns={COLUMNS}
      rows={tableRows}
    />
  );
}
