import {
  Badge,
  EmptyState,
  StatusPill,
  Table,
  Td,
  Th,
  color,
  geometry,
  typography,
} from "@aquarela/ui";

/**
 * Presentational items table for the Products screen (08_UI_UX.md §8.3). Server
 * component: no hooks, no state. The page owns the data read and maps the item
 * read model into `ItemTableRow`; this file only renders, so it never touches
 * the DB or the catalog service.
 */

/** One already-formatted table row. All shaping (money, labels, links) happens in the page. */
export interface ItemTableRow {
  readonly id: string;
  readonly code: string;
  readonly sku: string;
  readonly name: string;
  /** Humanised `item_type`. */
  readonly typeLabel: string;
  /** `DEC-150`: humanised purpose — "For sale" or "For use". */
  readonly purposeLabel: string;
  readonly baseUnitCode: string;
  /** Humanised `inventory_policy`. */
  readonly policyLabel: string;
  readonly lotTracked: boolean;
  /** Formatted amount (2dp) or null when no cost is recorded. */
  readonly currentCost: string | null;
  readonly activeTo: string | null;
}

const numCell = { textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;

function moneyHeader(currency: string | null): string {
  return currency === null ? "Current cost" : `Current cost (${currency})`;
}

export interface ItemsTableProps {
  readonly rows: readonly ItemTableRow[];
  /** Organization currency, or null when it is not set. */
  readonly currency: string | null;
}

export function ItemsTable({ rows, currency }: ItemsTableProps) {
  if (rows.length === 0) {
    return (
      <EmptyState title="No items match">
        Items are the ingredients, packaging and finished goods this organization buys, makes or
        stocks. Register items and their supplier packs, then they appear here. Adjust the search or
        type filter to widen the list.
      </EmptyState>
    );
  }

  return (
    <Table
      caption="Items with their purpose, base unit, inventory policy, current cost, lot tracking and active range. Select a code to open the item."
      columnCount={9}
    >
      <thead>
        <tr>
          <Th>Code</Th>
          <Th>Name</Th>
          <Th>Type</Th>
          <Th>Purpose</Th>
          <Th>Base unit</Th>
          <Th>Policy</Th>
          <Th style={numCell}>{moneyHeader(currency)}</Th>
          <Th>Lot tracked</Th>
          <Th>Active</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <Td>
              <a
                href={`/products/${row.id}`}
                title={row.sku}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  minHeight: geometry.controlHeight.sm,
                  fontFamily: typography.fontFamily.mono,
                  color: color.brand.navy,
                  fontWeight: typography.fontWeight.semibold,
                }}
              >
                {row.code}
              </a>
            </Td>
            <Td>{row.name}</Td>
            <Td>{row.typeLabel}</Td>
            <Td>
              {row.purposeLabel === "For sale" ? (
                <StatusPill tone="success">For sale</StatusPill>
              ) : (
                <StatusPill tone="info">For use</StatusPill>
              )}
            </Td>
            <Td>
              <Badge>{row.baseUnitCode}</Badge>
            </Td>
            <Td>{row.policyLabel}</Td>
            <Td style={numCell}>
              {row.currentCost === null ? (
                <span style={{ color: color.text.muted }}>No cost yet</span>
              ) : (
                row.currentCost
              )}
            </Td>
            <Td>
              {row.lotTracked ? (
                <StatusPill tone="info">Lot-tracked</StatusPill>
              ) : (
                <span style={{ color: color.text.muted }}>—</span>
              )}
            </Td>
            <Td>
              {row.activeTo === null ? (
                <StatusPill tone="success">Active</StatusPill>
              ) : (
                <StatusPill tone="info">Ended {row.activeTo}</StatusPill>
              )}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
