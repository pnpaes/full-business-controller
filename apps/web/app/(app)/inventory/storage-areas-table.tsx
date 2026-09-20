import { Badge, EmptyState, Table, Td, Th, color, typography } from "@aquarela/ui";

/**
 * Presentational storage-areas list for the Inventory screen (DATA_DICTIONARY
 * §4). Server component: the page owns the read; this file only renders.
 */

export interface StorageAreaTableRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly kind: string;
  readonly locationLabel: string;
  readonly isTransit: boolean;
}

export interface StorageAreasTableProps {
  readonly rows: readonly StorageAreaTableRow[];
}

export function StorageAreasTable({ rows }: StorageAreasTableProps) {
  if (rows.length === 0) {
    return (
      <EmptyState title="No storage areas yet">
        A storage area is where stock physically sits inside a location (dry store, refrigerator,
        freezer, …). Register one below before posting a movement, because every ledger row names
        the area it affects.
      </EmptyState>
    );
  }

  return (
    <Table
      caption="Storage areas by location. Every stock movement names the storage area it affects."
      columnCount={5}
    >
      <thead>
        <tr>
          <Th>Code</Th>
          <Th>Name</Th>
          <Th>Kind</Th>
          <Th>Location</Th>
          <Th>Transit</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <Td>
              <span
                style={{ fontFamily: typography.fontFamily.mono, fontSize: typography.fontSize.sm }}
              >
                {row.code}
              </span>
            </Td>
            <Td>{row.name}</Td>
            <Td>{row.kind.replace(/_/g, " ")}</Td>
            <Td>{row.locationLabel}</Td>
            <Td>
              {row.isTransit ? (
                <Badge>Transit</Badge>
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
