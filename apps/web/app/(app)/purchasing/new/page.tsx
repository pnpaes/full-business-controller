import { createPostgresReceivingStore, listGoodsReceipts } from "@aquarela/application";
import { findOrganizationById } from "@aquarela/persistence";
import { EmptyState, PageHeader, spacing } from "@aquarela/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getDb } from "../../../../lib/db";
import { resolveOrganization } from "../../../../lib/organization";
import { getServerSession } from "../../../../lib/server-session";

import {
  RecordReceiptForm,
  type ReceiptLocationOption,
  type ReceiptPackOption,
  type ReceiptSupplierOption,
} from "../record-receipt-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Record a receipt — Aquarela Business Control" };

/**
 * Record a goods receipt (08_UI_UX.md §8.3, §8.6). The pickers and the default
 * location are loaded server-side from the receiving port; the client form only
 * shapes the request and shows the server-computed variance warnings. When the
 * master data a receipt needs is absent, an `EmptyState` explains what is
 * missing instead of showing a form that cannot submit (§8.4).
 */
export default async function NewReceiptPage() {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const organizationId = resolveOrganization();
  const db = getDb().db;
  const store = createPostgresReceivingStore(db);
  const organization = await findOrganizationById(db, organizationId);
  const currency = organization?.currency ?? null;

  const [locations, suppliers, packs, recent] = await Promise.all([
    store.listLocations(organizationId),
    store.listSuppliers(organizationId),
    store.listSupplierItemOptions(organizationId),
    listGoodsReceipts(store, { organizationId, limit: 1 }),
  ]);

  const locationOptions: ReceiptLocationOption[] = locations.map((location) => ({
    id: location.id,
    code: location.code,
    name: location.name,
  }));
  const supplierOptions: ReceiptSupplierOption[] = suppliers.map((supplier) => ({
    id: supplier.id,
    code: supplier.code,
    name: supplier.name,
    currency: supplier.currency,
  }));
  const packOptions: ReceiptPackOption[] = packs.map((pack) => ({
    id: pack.id,
    supplierId: pack.supplierId,
    itemId: pack.itemId,
    itemCode: pack.itemCode,
    itemName: pack.itemName,
    packUnitId: pack.packUnitId,
    packUnitCode: pack.packUnitCode,
    packToBaseUnitFactor: pack.packToBaseUnitFactor,
  }));

  const recentLocationId = recent[0]?.locationId;
  const defaultLocationId =
    (recentLocationId !== undefined &&
    locationOptions.some((location) => location.id === recentLocationId)
      ? recentLocationId
      : locationOptions[0]?.id) ?? "";

  const missing: string[] = [];
  if (locationOptions.length === 0) {
    missing.push("a location");
  }
  if (supplierOptions.length === 0) {
    missing.push("a supplier");
  }
  if (packOptions.length === 0) {
    missing.push("a supplier pack (supplier item)");
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: spacing[6],
        maxWidth: 1120,
        margin: "0 auto",
      }}
    >
      <PageHeader
        title="Record a receipt"
        scope="Purchasing"
        description="Record what a delivery contained — supplier pack, quantity, price, lot and expiry — and append the landed cost to price history."
      />

      {missing.length > 0 ? (
        <EmptyState
          title="Receiving master data is missing"
          action={
            <Link href="/purchasing" style={{ color: "inherit" }}>
              Back to receipts
            </Link>
          }
        >
          A receipt needs {missing.join(", ")}. Seed a supplier and its pack, then return to record
          the delivery.
        </EmptyState>
      ) : (
        <RecordReceiptForm
          locations={locationOptions}
          suppliers={supplierOptions}
          packs={packOptions}
          defaultLocationId={defaultLocationId}
          currency={currency}
          today={new Date().toISOString().slice(0, 10)}
        />
      )}
    </div>
  );
}
