import { DataTable, StatusPill, color, typography } from "@aquarela/ui";
import type { DataTableColumn, DataTableRow } from "@aquarela/ui";

import type { ProductionBatchRow } from "../../api/v1/production/production-rows";

import {
  formatInstant,
  hasYieldVariance,
  quantityLabel,
  yieldVarianceLabel,
} from "./production-labels";

/**
 * Presentational production board table (08_UI_UX.md §8.3): one row per batch
 * with its location, recipe version, planned vs actual output and yield
 * variance. Server component — the page owns the read; this file only renders.
 */

const COLUMNS: readonly DataTableColumn[] = [
  { key: "recipe", header: "Recipe · batch" },
  { key: "location", header: "Location" },
  { key: "output", header: "Planned → actual output", align: "right" },
  { key: "yield", header: "Yield variance", align: "right" },
  { key: "start", header: "Planned start" },
];

function batchLabel(row: ProductionBatchRow): string {
  const recipe = row.recipeName ?? row.recipeCode ?? "Recipe not found in organization";
  const version = row.recipeVersionNo === null ? "" : ` v${row.recipeVersionNo}`;
  return `${recipe}${version}`;
}

export function ProductionBoardTable({ rows }: { readonly rows: readonly ProductionBatchRow[] }) {
  const tableRows: DataTableRow[] = rows.map((row) => ({
    recipe: (
      <span>
        <span style={{ fontWeight: typography.fontWeight.semibold }}>{batchLabel(row)}</span>
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
    location: row.locationCode ?? row.locationId,
    output: `${quantityLabel(row.plannedOutputQty, row.outputUnitCode)} → ${quantityLabel(
      row.actualOutputQty,
      row.outputUnitCode,
    )}`,
    yield:
      row.actualOutputQty === null ? (
        "—"
      ) : (
        <StatusPill tone={hasYieldVariance(row.yieldVariancePct) ? "warning" : "success"}>
          {yieldVarianceLabel(row.yieldVariancePct)}
        </StatusPill>
      ),
    start: row.plannedStart === null ? "—" : formatInstant(row.plannedStart),
  }));

  return (
    <DataTable
      caption="Production batches grouped by status, newest first. Yield variance is stored as a fact."
      columns={COLUMNS}
      rows={tableRows}
      rowHref={(_row, index) => {
        const batch = rows[index];
        return batch === undefined ? "/production" : `/production/batches/${batch.id}`;
      }}
    />
  );
}
