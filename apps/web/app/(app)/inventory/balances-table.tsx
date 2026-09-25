import {
  Badge,
  EmptyState,
  StatusPill,
  Table,
  Td,
  Th,
  color,
  geometry,
  spacing,
  typography,
} from "@aquarela/ui";
import Link from "next/link";

/**
 * Presentational balances table for the Inventory screen (08_UI_UX.md §8.3,
 * §8.4, §8.5). Server component: no hooks, no state. The page owns the data
 * read and maps the balances read model into `BalanceTableRow`; this file only
 * renders, so it never touches the DB or the inventory service.
 */

/** Expiry window used for the "expiring" status and the KPI/alert threshold. */
export const EXPIRING_SOON_DAYS = 30;

/**
 * The only stock status determinable from the balances read model: lot expiry.
 * Low-stock is intentionally absent — `reorder_policy` (the threshold source)
 * is deferred to a later slice, so a low status would be fabricated.
 */
export type ExpiryStatus = "expired" | "expiring" | "ok" | "none";

/** One already-formatted table row. All shaping (units, money, status) happens in the page. */
export interface BalanceTableRow {
  /** Stable React key: item/location/storage-area/lot identity. */
  readonly key: string;
  readonly itemId: string;
  readonly itemCode: string | null;
  readonly itemName: string | null;
  readonly locationLabel: string;
  readonly storageAreaLabel: string;
  readonly lotLabel: string | null;
  /** Quantity at display precision (trailing zeros trimmed). */
  readonly quantity: string;
  /** The item's base unit code, paired with the quantity (§8.5). */
  readonly unitCode: string | null;
  /** Value at cost, in the page-supplied currency. */
  readonly value: string;
  /** Average unit cost, or null at zero quantity. */
  readonly avgUnitCost: string | null;
  readonly expiryStatus: ExpiryStatus;
}

const statusView: Record<
  ExpiryStatus,
  { readonly tone: "success" | "warning" | "danger"; readonly label: string } | null
> = {
  expired: { tone: "danger", label: "Expired" },
  expiring: { tone: "warning", label: `Expiring ≤${EXPIRING_SOON_DAYS}d` },
  ok: { tone: "success", label: "In date" },
  none: null,
};

const numCell = { textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;

function moneyHeader(label: string, currency: string | null): string {
  return currency === null ? label : `${label} (${currency})`;
}

export interface BalancesTableProps {
  readonly rows: readonly BalanceTableRow[];
  /** Organization currency, or null when it is not set. */
  readonly currency: string | null;
  /** Rendered as-of instant, already formatted. */
  readonly asOfLabel: string;
}

export function BalancesTable({ rows, currency, asOfLabel }: BalancesTableProps) {
  if (rows.length === 0) {
    return (
      <EmptyState title="No stock balances yet">
        Stock balances appear here once a goods receipt, production output, transfer or stock count
        posts movements to the ledger. This view reads the ledger as of {asOfLabel} for the served
        organization.
      </EmptyState>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[3] }}>
      <Table
        caption={`Balances by item, location, storage area and lot as of ${asOfLabel}. Quantity pairs with the item's base unit; value and average unit cost are at moving weighted average cost.`}
        columnCount={8}
      >
        <thead>
          <tr>
            <Th>Item</Th>
            <Th>Location</Th>
            <Th>Storage area</Th>
            <Th>Lot</Th>
            <Th style={numCell}>Quantity</Th>
            <Th style={numCell}>{moneyHeader("Value", currency)}</Th>
            <Th style={numCell}>{moneyHeader("Avg unit cost", currency)}</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const status = statusView[row.expiryStatus];
            return (
              <tr key={row.key}>
                <Td>
                  <span
                    title={row.itemId}
                    style={{ display: "flex", flexDirection: "column", gap: 2 }}
                  >
                    <Link
                      href={`/inventory/${row.itemId}`}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        minHeight: geometry.controlHeight.sm,
                      }}
                    >
                      {row.itemName ?? row.itemId}
                    </Link>
                    {row.itemCode === null ? null : (
                      <span
                        style={{
                          fontFamily: typography.fontFamily.mono,
                          fontSize: typography.fontSize.xs,
                          color: color.text.muted,
                        }}
                      >
                        {row.itemCode}
                      </span>
                    )}
                  </span>
                </Td>
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
                <Td style={numCell}>{row.value}</Td>
                <Td style={numCell}>
                  {row.avgUnitCost === null ? (
                    <span style={{ color: color.text.muted }}>—</span>
                  ) : (
                    row.avgUnitCost
                  )}
                </Td>
                <Td>
                  {status === null ? (
                    <span style={{ color: color.text.muted }}>—</span>
                  ) : (
                    <StatusPill tone={status.tone}>{status.label}</StatusPill>
                  )}
                </Td>
              </tr>
            );
          })}
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
        Status reflects lot expiry only (threshold: {EXPIRING_SOON_DAYS} days). Low-stock status is
        not shown: the per-item reorder threshold is not part of this read model yet. Select an item
        to open its balances, valuation and full movement history.
      </p>
    </div>
  );
}
