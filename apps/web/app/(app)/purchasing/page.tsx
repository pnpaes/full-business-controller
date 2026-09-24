import { createPostgresReceivingStore, listGoodsReceipts } from "@aquarela/application";
import { MONEY_SCALE, formatDecimal, parseDecimal } from "@aquarela/domain";
import { findOrganizationById } from "@aquarela/persistence";
import {
  EmptyState,
  KpiCard,
  PageHeader,
  SectionCard,
  StatusPill,
  Table,
  Td,
  Th,
  color,
  spacing,
  typography,
} from "@aquarela/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getDb } from "../../../lib/db";
import { resolveOrganization } from "../../../lib/organization";
import { getServerSession } from "../../../lib/server-session";

import { toReceiptRows } from "../../api/v1/receiving/receipts/receipt-http";
import { loadReceiptRefs } from "../../api/v1/receiving/receipts/receipt-refs";

import { CreateSupplierForm } from "./create-supplier-form";
import { formatInstant, formatMoneyAmount, statusView } from "./receipt-format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Purchasing — Aquarela Business Control" };

const numCell = { textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;

const primaryLink = {
  color: "inherit",
  textDecoration: "none",
  fontWeight: typography.fontWeight.semibold,
} as const;

/**
 * Purchasing: recorded goods receipts (08_UI_UX.md §8.3 "Receiving" — supplier,
 * pack, quantity, price, lot, expiry, variance). Read-only list; the record form
 * lives at `/purchasing/new` and the detail at `/purchasing/receipts/[id]`.
 */
export default async function PurchasingPage() {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const organizationId = resolveOrganization();
  const store = createPostgresReceivingStore(getDb().db);
  const receipts = await listGoodsReceipts(store, { organizationId, limit: 50 });
  const refs = await loadReceiptRefs(store, organizationId, []);
  const rows = toReceiptRows(organizationId, receipts, refs);
  const suppliers = await store.listSuppliers(organizationId);
  const organization = await findOrganizationById(getDb().db, organizationId);
  const currency = organization?.currency ?? null;

  let totalValue = 0n;
  for (const row of rows) {
    totalValue += parseDecimal(row.grossTotal, MONEY_SCALE);
  }
  const totalValueLabel = `${formatMoneyAmount(formatDecimal(totalValue, MONEY_SCALE))}${
    currency === null ? " (currency not set)" : ` ${currency}`
  }`;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: spacing[6],
        width: "100%",
        maxWidth: 1120,
        margin: "0 auto",
      }}
    >
      <PageHeader
        title="Purchasing"
        scope="Aquarela Business Control"
        description="Receive supplier deliveries with pack, quantity, price, lot and expiry, flagging variance."
        actions={
          <Link href="/purchasing/new" style={primaryLink}>
            Record a receipt
          </Link>
        }
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: spacing[4],
        }}
      >
        <KpiCard
          label="Receipts recorded"
          value={String(rows.length)}
          meta="Most recent first · all locations"
        />
        <KpiCard
          label="Recorded value"
          value={totalValueLabel}
          meta="Σ price × received packs on this page"
        />
      </div>

      <SectionCard
        title="Goods receipts"
        meta={`${rows.length} ${rows.length === 1 ? "receipt" : "receipts"} · newest first`}
      >
        {rows.length === 0 ? (
          <EmptyState
            title="No goods receipts yet"
            action={
              <Link href="/purchasing/new" style={primaryLink}>
                Record the first receipt
              </Link>
            }
          >
            A receipt records what a delivery actually contained — supplier, pack, quantity, price,
            lot and expiry — and appends the landed cost to price history. Nothing has been recorded
            for this organization yet.
          </EmptyState>
        ) : (
          <Table
            caption="Recorded goods receipts, newest first, with their gross total (price × received packs)."
            columnCount={5}
          >
            <thead>
              <tr>
                <Th>Received</Th>
                <Th>Supplier / store</Th>
                <Th>Location</Th>
                <Th>Status</Th>
                <Th style={numCell}>Total</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const status = statusView(row.status);
                return (
                  <tr key={row.id}>
                    <Td>
                      <Link href={`/purchasing/receipts/${row.id}`} style={primaryLink}>
                        {formatInstant(row.receivedAt)}
                      </Link>
                      {row.deliveryRef === null ? null : (
                        <span
                          style={{
                            color: color.text.muted,
                            fontSize: typography.fontSize.xs,
                          }}
                        >
                          {" "}
                          · {row.deliveryRef}
                        </span>
                      )}
                    </Td>
                    <Td>{row.supplierName ?? row.storeName ?? "—"}</Td>
                    <Td>{row.locationCode ?? "—"}</Td>
                    <Td>
                      <StatusPill tone={status.tone}>{status.label}</StatusPill>
                    </Td>
                    <Td style={numCell}>
                      {formatMoneyAmount(row.grossTotal)}
                      {currency === null ? "" : ` ${currency}`}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </SectionCard>

      <SectionCard title="Suppliers" meta={`${suppliers.length} registered · DEC-047`}>
        {suppliers.length === 0 ? (
          <EmptyState title="No suppliers yet">
            Register a supplier before recording a goods receipt from it. An ad-hoc grocery purchase
            is recorded as a cost observation, not a supplier.
          </EmptyState>
        ) : (
          <Table caption="Known suppliers for this organization." columnCount={3}>
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Name</Th>
                <Th>Currency</Th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((supplier) => (
                <tr key={supplier.id}>
                  <Td>{supplier.code}</Td>
                  <Td>{supplier.name}</Td>
                  <Td>{supplier.currency}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <details style={{ marginTop: spacing[4] }}>
          <summary
            style={{
              cursor: "pointer",
              minHeight: 44,
              display: "flex",
              alignItems: "center",
              fontWeight: typography.fontWeight.semibold,
            }}
          >
            New supplier
          </summary>
          <div style={{ marginTop: spacing[4] }}>
            <CreateSupplierForm defaultCurrency={currency} />
          </div>
        </details>
      </SectionCard>
    </div>
  );
}
