import { EmptyState, StatusPill, Table, Td, Th, typography } from "@aquarela/ui";
import Link from "next/link";

/**
 * Presentational counts list for the Inventory screen (08_UI_UX.md §8.3). Server
 * component: no hooks, no state. The page owns the read and maps each count into
 * a `CountTableRow`; this file only renders.
 */

export type CountStatus = "draft" | "counting" | "submitted" | "approved" | "cancelled";

export type CountStatusTone = "info" | "success" | "warning" | "danger";

/** Status → pill tone/label; `submitted` exists in the vocabulary but is unused here. */
export const COUNT_STATUS_VIEW: Record<CountStatus, { tone: CountStatusTone; label: string }> = {
  draft: { tone: "info", label: "Draft" },
  counting: { tone: "warning", label: "Counting" },
  submitted: { tone: "info", label: "Submitted" },
  approved: { tone: "success", label: "Approved" },
  cancelled: { tone: "danger", label: "Cancelled" },
};

export function countStatusView(status: string): { tone: CountStatusTone; label: string } {
  return COUNT_STATUS_VIEW[status as CountStatus] ?? { tone: "info", label: status };
}

export interface CountTableRow {
  readonly id: string;
  readonly locationLabel: string;
  readonly cutoffLabel: string;
  readonly status: string;
  readonly blind: boolean;
  readonly lineCount: number;
  readonly countedCount: number;
  /** null while a blind, unapproved count withholds it. */
  readonly varianceCount: number | null;
}

const numCell = { textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;

export function CountsTable({ rows }: { readonly rows: readonly CountTableRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState title="No counts yet">
        A count appears once one is opened for a location. Opening a count snapshots the projected
        quantity of every stocked item at the cutoff, then you record what you actually see and
        approve the variances.
      </EmptyState>
    );
  }
  return (
    <Table caption="Stock counts, newest cutoff first." columnCount={6}>
      <thead>
        <tr>
          <Th>Location</Th>
          <Th>Cutoff</Th>
          <Th>Status</Th>
          <Th>Blind</Th>
          <Th style={numCell}>Lines / counted</Th>
          <Th style={numCell}>Variances</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const status = countStatusView(row.status);
          return (
            <tr key={row.id}>
              <Td>
                <Link
                  href={`/inventory/counts/${row.id}`}
                  style={{ fontWeight: typography.fontWeight.semibold }}
                >
                  {row.locationLabel}
                </Link>
              </Td>
              <Td style={{ whiteSpace: "nowrap" }}>{row.cutoffLabel}</Td>
              <Td>
                <StatusPill tone={status.tone}>{status.label}</StatusPill>
              </Td>
              <Td>{row.blind ? "Blind" : "Sighted"}</Td>
              <Td style={numCell}>
                {row.lineCount} / {row.countedCount}
              </Td>
              <Td style={numCell}>{row.varianceCount === null ? "hidden" : row.varianceCount}</Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
