import { createPostgresReceivingStore, getGoodsReceipt } from "@aquarela/application";
import { findOrganizationById } from "@aquarela/persistence";
import {
  DataTable,
  DescriptionList,
  EmptyState,
  KpiCard,
  PageHeader,
  SectionCard,
  StatusPill,
  spacing,
} from "@aquarela/ui";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getDb } from "../../../../../lib/db";
import { resolveOrganization } from "../../../../../lib/organization";
import { uuidOrNotFound } from "../../../../../lib/route-params";
import { getServerSession } from "../../../../../lib/server-session";

import {
  toReceiptLineRows,
  toReceiptRows,
  type ReceiptLineRow,
} from "../../../../api/v1/receiving/receipts/receipt-http";
import { loadReceiptRefs } from "../../../../api/v1/receiving/receipts/receipt-refs";

import {
  formatDate,
  formatInstant,
  formatMoneyAmount,
  statusView,
  trimDecimal,
} from "../../receipt-format";

export const dynamic = "force-dynamic";

const primaryLink = { color: "inherit", textDecoration: "none" } as const;

/** `code · name`, or the plain name/code, or the raw id when nothing resolved. */
function itemLabel(row: ReceiptLineRow): string {
  if (row.itemCode !== null && row.itemName !== null) {
    return `${row.itemCode} · ${row.itemName}`;
  }
  return row.itemName ?? row.itemCode ?? row.itemId;
}

/**
 * Receipt detail (08_UI_UX.md §8.3): the receipt header plus its lines, with the
 * pack, quantity, price, lot and expiry that were recorded. The receipt is
 * org-checked by `getGoodsReceipt`, so another tenant's id resolves to 404. The
 * line mapping is shared with `GET /api/v1/receiving/receipts/[id]` so the page
 * and the API cannot drift.
 */
export default async function ReceiptDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const { id: rawId } = await params;
  const id = uuidOrNotFound(rawId);
  const organizationId = resolveOrganization();
  const db = getDb().db;
  const store = createPostgresReceivingStore(db);

  const detail = await getGoodsReceipt(store, { organizationId, receiptId: id });
  if (detail === undefined) {
    notFound();
  }

  const organization = await findOrganizationById(db, organizationId);
  const currency = organization?.currency ?? null;
  const refs = await loadReceiptRefs(store, organizationId, detail.lines);
  const header = toReceiptRows(organizationId, [detail.receipt], refs)[0];
  const lines = toReceiptLineRows(organizationId, detail.lines, refs);
  if (header === undefined) {
    notFound();
  }

  const status = statusView(header.status);
  const supplierLabel = header.supplierName ?? header.storeName ?? "—";
  const locationLabel =
    header.locationCode !== null && header.locationName !== null
      ? `${header.locationCode} · ${header.locationName}`
      : (header.locationCode ?? header.locationName ?? "—");

  const rows = lines.map((line) => ({
    item: itemLabel(line),
    received: `${trimDecimal(line.receivedPackQty)} ${line.unitCode ?? ""}`.trim(),
    accepted: `${trimDecimal(line.acceptedPackQty)} ${line.unitCode ?? ""}`.trim(),
    rejected: trimDecimal(line.rejectedPackQty),
    factor: trimDecimal(line.packToBaseFactor),
    price: formatMoneyAmount(line.price),
    discount: formatMoneyAmount(line.discount),
    lot: line.lotNumber ?? "—",
    expiry: formatDate(line.expiryDate),
    baseQty: trimDecimal(line.baseQtyAccepted),
    landed: formatMoneyAmount(line.landedBaseUnitCost),
  }));

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
        title={`Receipt ${header.id.slice(0, 8)}`}
        scope="Purchasing"
        description="What this delivery contained, with the landed cost appended to price history at record time."
        actions={
          <Link href="/purchasing" style={primaryLink}>
            Back to receipts
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
          label="Gross total"
          value={`${formatMoneyAmount(header.grossTotal)}${currency === null ? "" : ` ${currency}`}`}
          meta="Σ price × received packs"
        />
        <KpiCard
          label="Lines"
          value={String(lines.length)}
          meta={`${lines.length === 1 ? "one received line" : "received lines"}`}
        />
      </div>

      <SectionCard title="Receipt" meta={formatInstant(header.receivedAt)}>
        <DescriptionList
          items={[
            { term: "Supplier", description: supplierLabel },
            { term: "Location", description: locationLabel },
            {
              term: "Status",
              description: <StatusPill tone={status.tone}>{status.label}</StatusPill>,
            },
            { term: "Received", description: formatInstant(header.receivedAt) },
            { term: "Delivery reference", description: header.deliveryRef ?? "—" },
            { term: "Accepted by", description: header.acceptedBy ?? "—" },
            {
              term: "Accepted at",
              description: header.acceptedAt === null ? "—" : formatInstant(header.acceptedAt),
            },
          ]}
        />
      </SectionCard>

      <SectionCard title="Lines" meta={`${lines.length} ${lines.length === 1 ? "line" : "lines"}`}>
        {lines.length === 0 ? (
          <EmptyState title="No lines on this receipt">
            This receipt has no recorded lines, so no landed cost was appended to price history.
          </EmptyState>
        ) : (
          <div style={{ overflowX: "auto", minWidth: 0 }}>
            <DataTable
              caption="Receipt lines with pack, quantity, price, lot and expiry, and the landed base-unit cost."
              columns={[
                { key: "item", header: "Item" },
                { key: "received", header: "Received", align: "right" },
                { key: "accepted", header: "Accepted", align: "right" },
                { key: "rejected", header: "Rejected", align: "right" },
                { key: "factor", header: "Pack → base", align: "right" },
                { key: "price", header: "Pack price", align: "right" },
                { key: "discount", header: "Discount", align: "right" },
                { key: "lot", header: "Lot" },
                { key: "expiry", header: "Expiry" },
                { key: "baseQty", header: "Base qty", align: "right" },
                { key: "landed", header: "Landed / base", align: "right" },
              ]}
              rows={rows}
            />
          </div>
        )}
      </SectionCard>
    </div>
  );
}
