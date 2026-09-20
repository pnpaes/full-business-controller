import { Badge, EmptyState, Table, Td, Th, color, spacing } from "@aquarela/ui";

import type {
  TransferLineRow,
  TransferMovementRow,
} from "../../../../api/v1/transfers/transfer-rows";

/**
 * Presentational transfer detail tables (08_UI_UX.md §8.3). Server components:
 * the page owns the read and the formatting; these files only render.
 */

const numCell = { textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;

function humanize(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatInstant(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

export interface TransferLinesTableProps {
  readonly rows: readonly TransferLineRow[];
}

export function TransferLinesTable({ rows }: TransferLinesTableProps) {
  if (rows.length === 0) {
    return (
      <EmptyState title="No lines yet">
        Lines appear once the transfer is dispatched: the dispatched quantities are read back from
        the paired ledger movements.
      </EmptyState>
    );
  }
  return (
    <Table
      caption="Per item/lot dispatched and received quantities, derived from the paired movements. A difference is a discrepancy."
      columnCount={6}
    >
      <thead>
        <tr>
          <Th>Item</Th>
          <Th>Lot</Th>
          <Th style={numCell}>Dispatched</Th>
          <Th style={numCell}>Received</Th>
          <Th style={numCell}>Unit cost</Th>
          <Th>Discrepancy</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.itemId}:${row.lotId ?? "no-lot"}`}>
            <Td>
              {row.itemName ?? row.itemId}
              {row.itemCode === null ? null : (
                <span style={{ marginLeft: spacing[2] }}>
                  <Badge>{row.itemCode}</Badge>
                </span>
              )}
            </Td>
            <Td>
              {row.lotId === null ? (
                <span style={{ color: color.text.muted }}>No lot</span>
              ) : (
                row.lotId
              )}
            </Td>
            <Td style={numCell}>
              {row.dispatchedQuantity}
              {row.unitCode === null ? null : ` ${row.unitCode}`}
            </Td>
            <Td style={numCell}>
              {row.receivedQuantity}
              {row.unitCode === null ? null : ` ${row.unitCode}`}
            </Td>
            <Td style={numCell}>
              {row.unitCost ?? <span style={{ color: color.text.muted }}>—</span>}
            </Td>
            <Td>
              {row.hasDiscrepancy ? (
                <Badge>Discrepancy</Badge>
              ) : (
                <span style={{ color: color.text.muted }}>—</span>
              )}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export interface TransferMovementsTableProps {
  readonly rows: readonly TransferMovementRow[];
}

export function TransferMovementsTable({ rows }: TransferMovementsTableProps) {
  if (rows.length === 0) {
    return (
      <EmptyState title="No movements yet">
        The dispatch and receipt legs appear here, paired by the transfer id. The transit leg is
        eliminated in a consolidation, so the goods are never double-counted.
      </EmptyState>
    );
  }
  return (
    <Table
      caption="The transfer's paired ledger legs in ledger order. The transit legs carry the in-transit holding point."
      columnCount={8}
    >
      <thead>
        <tr>
          <Th>Date</Th>
          <Th>Type</Th>
          <Th>Location</Th>
          <Th>Storage area</Th>
          <Th>Item</Th>
          <Th style={numCell}>Quantity</Th>
          <Th style={numCell}>Unit cost</Th>
          <Th style={numCell}>Value</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <Td>{formatInstant(row.occurredAt)}</Td>
            <Td>{humanize(row.movementType)}</Td>
            <Td>{row.locationCode ?? "—"}</Td>
            <Td>{row.storageAreaCode ?? "—"}</Td>
            <Td>{row.itemCode ?? "—"}</Td>
            <Td style={numCell}>{row.quantityDelta}</Td>
            <Td style={numCell}>
              {row.unitCost ?? <span style={{ color: color.text.muted }}>—</span>}
            </Td>
            <Td style={numCell}>
              {row.valueDelta ?? <span style={{ color: color.text.muted }}>—</span>}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
