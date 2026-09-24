import {
  Badge,
  EmptyState,
  StatusPill,
  Table,
  Td,
  Th,
  color,
  spacing,
  typography,
} from "@aquarela/ui";
import Link from "next/link";

import type { TransferRow } from "../../../api/v1/transfers/transfer-rows";

/**
 * Presentational transfer list (08_UI_UX.md §8.3, §8.4). Server component: the
 * page owns the read and the formatting; this file only renders.
 */

const numCell = { textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;

const statusTone: Record<string, "info" | "success" | "warning" | "danger"> = {
  requested: "info",
  approved: "info",
  dispatched: "warning",
  received: "success",
};

function endpoint(locationLabel: string | null, areaLabel: string | null): string {
  if (locationLabel === null && areaLabel === null) {
    return "—";
  }
  return [locationLabel ?? "—", areaLabel].filter((part) => part !== null).join(" · ");
}

export interface TransfersTableProps {
  readonly rows: readonly TransferRow[];
}

export function TransfersTable({ rows }: TransfersTableProps) {
  if (rows.length === 0) {
    return (
      <EmptyState title="No transfers yet">
        A transfer moves stock between two locations through a virtual in-transit holding point.
        Request one below, approve it, then dispatch and receive it.
      </EmptyState>
    );
  }

  return (
    <Table
      caption="Stock transfers. Dispatched and received are the movement-derived totals; a difference is a discrepancy."
      columnCount={7}
    >
      <thead>
        <tr>
          <Th>From</Th>
          <Th>To</Th>
          <Th>Status</Th>
          <Th style={numCell}>Dispatched</Th>
          <Th style={numCell}>Received</Th>
          <Th>Discrepancy</Th>
          <Th>Action</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <Td>{endpoint(row.fromLocationLabel, row.fromStorageAreaLabel)}</Td>
            <Td>{endpoint(row.toLocationLabel, row.toStorageAreaLabel)}</Td>
            <Td>
              {statusTone[row.status] === undefined ? (
                <Badge>{row.status}</Badge>
              ) : (
                <StatusPill tone={statusTone[row.status]!}>{row.status}</StatusPill>
              )}
            </Td>
            <Td style={numCell}>{row.dispatchedQuantity}</Td>
            <Td style={numCell}>{row.receivedQuantity}</Td>
            <Td>
              {row.hasDiscrepancy ? (
                <span
                  title={row.discrepancyNote ?? undefined}
                  style={{ display: "flex", flexDirection: "column", gap: spacing[1] }}
                >
                  <StatusPill tone="warning">Discrepancy</StatusPill>
                  {row.discrepancyNote === null ? null : (
                    <span style={{ color: color.text.muted, fontSize: typography.fontSize.xs }}>
                      {row.discrepancyNote}
                    </span>
                  )}
                </span>
              ) : (
                <span style={{ color: color.text.muted }}>—</span>
              )}
            </Td>
            <Td>
              <Link href={`/inventory/transfers/${row.id}`}>Open</Link>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
