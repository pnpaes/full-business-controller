import { Badge, EmptyState, Table, Td, Th, color, spacing, typography } from "@aquarela/ui";

import { ReverseMovement } from "./reverse-movement";

/**
 * Presentational movement ledger for the item drill-down (08_UI_UX.md §8.3
 * movement drill-down). Server component: the page owns the read and the
 * formatting; this file only renders, and delegates the reverse action to the
 * client component.
 */

export interface MovementTableRow {
  readonly id: string;
  readonly occurredLabel: string;
  readonly movementType: string;
  readonly itemLabel: string;
  readonly locationLabel: string;
  readonly storageAreaLabel: string;
  readonly lotLabel: string | null;
  readonly quantity: string;
  readonly unitCode: string | null;
  readonly unitCost: string | null;
  readonly value: string | null;
  readonly reasonCode: string | null;
  readonly reversed: boolean;
  readonly isReversal: boolean;
}

const numCell = { textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;

function humanize(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export interface MovementsTableProps {
  readonly rows: readonly MovementTableRow[];
  readonly emptyMessage?: string;
}

export function MovementsTable({ rows, emptyMessage }: MovementsTableProps) {
  if (rows.length === 0) {
    return (
      <EmptyState title="No movements yet">
        {emptyMessage ??
          "Movements appear here once a receipt, production, count, transfer, waste or adjustment posts to the ledger. A reversal also appears as its own row."}
      </EmptyState>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[3] }}>
      <Table
        caption="Stock movements in ledger order. Quantity pairs with the movement's unit; value is signed at cost. A reversal is an exact offset and cannot itself be reversed."
        columnCount={11}
      >
        <thead>
          <tr>
            <Th>Date</Th>
            <Th>Type</Th>
            <Th>Item</Th>
            <Th>Location</Th>
            <Th>Storage area</Th>
            <Th>Lot</Th>
            <Th style={numCell}>Quantity</Th>
            <Th style={numCell}>Unit cost</Th>
            <Th style={numCell}>Value</Th>
            <Th>Reason</Th>
            <Th>Action</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <Td>{row.occurredLabel}</Td>
              <Td>
                {humanize(row.movementType)}
                {row.isReversal ? (
                  <span style={{ marginLeft: spacing[2] }}>
                    <Badge>Reversal</Badge>
                  </span>
                ) : null}
              </Td>
              <Td>{row.itemLabel}</Td>
              <Td>{row.locationLabel}</Td>
              <Td>{row.storageAreaLabel}</Td>
              <Td>
                {row.lotLabel === null ? (
                  <span style={{ color: color.text.muted }}>No lot</span>
                ) : (
                  row.lotLabel
                )}
              </Td>
              <Td style={numCell}>
                <span style={{ fontWeight: typography.fontWeight.semibold }}>{row.quantity}</span>{" "}
                {row.unitCode === null ? (
                  <span
                    style={{ color: color.status.warning.fg, fontSize: typography.fontSize.xs }}
                  >
                    unit not set
                  </span>
                ) : (
                  <Badge>{row.unitCode}</Badge>
                )}
              </Td>
              <Td style={numCell}>
                {row.unitCost ?? <span style={{ color: color.text.muted }}>—</span>}
              </Td>
              <Td style={numCell}>
                {row.value ?? <span style={{ color: color.text.muted }}>—</span>}
              </Td>
              <Td>{row.reasonCode ?? <span style={{ color: color.text.muted }}>—</span>}</Td>
              <Td>
                {row.isReversal ? (
                  <span style={{ color: color.text.muted }}>—</span>
                ) : (
                  <ReverseMovement movementId={row.id} reversed={row.reversed} />
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p
        style={{
          margin: 0,
          fontSize: typography.fontSize.xs,
          color: color.text.muted,
          fontFamily: typography.fontFamily.sans,
        }}
      >
        The ledger is append-only: a mistake is corrected by reversing the original movement, never
        by editing its row. A reversal posts the exact opposite quantity and value.
      </p>
    </div>
  );
}
