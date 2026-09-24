import {
  createPostgresInventoryStore,
  createPostgresMasterDataStore,
  createPostgresReceivingStore,
  getItem,
  getStockBalanceAsOf,
  type ConversionEdge,
  type SupplierItemDetail,
} from "@aquarela/application";
import { DomainError, MONEY_SCALE, formatDecimal, parseDecimal, rescale } from "@aquarela/domain";
import { INVENTORY_POLICY } from "@aquarela/persistence";
import {
  EmptyState,
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
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getDb } from "../../../../lib/db";
import { resolveOrganization } from "../../../../lib/organization";
import { uuidOrNotFound } from "../../../../lib/route-params";
import { getServerSession } from "../../../../lib/server-session";

import { EditItemForm } from "./edit-item-form";
import { RegisterSupplierPackForm } from "./register-supplier-pack-form";

export const dynamic = "force-dynamic";

/* ----------------------------- formatting -------------------------------- */

/** ISO instant → "2026-09-20 12:42 UTC". */
function formatInstant(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

/** Trims trailing zeros from a canonical decimal string without changing its value. */
function trimDecimal(value: string): string {
  if (!value.includes(".")) {
    return value === "-0" ? "0" : value;
  }
  const trimmed = value.replace(/\.?0+$/, "");
  const result = trimmed.length === 0 ? "0" : trimmed;
  return result === "-0" ? "0" : result;
}

/** Monetary numeric(19,4) string → 2dp display string, HALF_UP (DEC-024). */
function formatMoneyAmount(value: string): string {
  return formatDecimal(rescale(parseDecimal(value, MONEY_SCALE), MONEY_SCALE, 2), 2);
}

function humanize(code: string): string {
  return code.replace(/_/g, " ");
}

/* ----------------------------- small views ------------------------------- */

const numCell = { textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;

const definitionList = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: spacing[4],
  margin: 0,
} as const;

function Definition({ term, children }: { readonly term: string; readonly children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[1] }}>
      <dt
        style={{
          margin: 0,
          fontSize: typography.fontSize.xs,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: color.text.muted,
        }}
      >
        {term}
      </dt>
      <dd style={{ margin: 0, fontSize: typography.fontSize.md }}>{children}</dd>
    </div>
  );
}

function SupplierPacksSection({
  packs,
  baseUnitCode,
}: {
  readonly packs: readonly SupplierItemDetail[];
  readonly baseUnitCode: string;
}) {
  if (packs.length === 0) {
    return (
      <SectionCard title="Supplier packs" meta="PROC-001">
        <EmptyState title="No supplier packs registered">
          A supplier pack records one pack of this item bought from a supplier: 1 pack = factor ×
          base unit. Register packs when the item is purchased; until then this item has no supplier
          or pack conversion.
        </EmptyState>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Supplier packs" meta={`${packs.length} registered · PROC-001`}>
      <Table
        caption="Supplier packs for this item. Each pack converts to the item base unit by its factor."
        columnCount={6}
      >
        <thead>
          <tr>
            <Th>Supplier</Th>
            <Th>Supplier SKU</Th>
            <Th>Pack</Th>
            <Th style={numCell}>Min order</Th>
            <Th style={numCell}>Lead time</Th>
            <Th>Preferred</Th>
          </tr>
        </thead>
        <tbody>
          {packs.map((pack) => (
            <tr key={pack.id}>
              <Td>
                <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span>{pack.supplierName}</span>
                  <span
                    style={{
                      fontFamily: typography.fontFamily.mono,
                      fontSize: typography.fontSize.xs,
                      color: color.text.muted,
                    }}
                  >
                    {pack.supplierCode}
                  </span>
                </span>
              </Td>
              <Td>
                <span style={{ fontFamily: typography.fontFamily.mono }}>{pack.supplierSku}</span>
              </Td>
              <Td>
                1 {pack.packUnitCode} = {trimDecimal(pack.packToBaseUnitFactor)} {baseUnitCode}
              </Td>
              <Td style={numCell}>
                {pack.minOrderQty === null ? (
                  <span style={{ color: color.text.muted }}>—</span>
                ) : (
                  trimDecimal(pack.minOrderQty)
                )}
              </Td>
              <Td style={numCell}>
                {pack.leadTimeDays === null ? (
                  <span style={{ color: color.text.muted }}>—</span>
                ) : (
                  `${pack.leadTimeDays} d`
                )}
              </Td>
              <Td>
                {pack.preferred ? (
                  <StatusPill tone="success">Preferred</StatusPill>
                ) : (
                  <span style={{ color: color.text.muted }}>—</span>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </SectionCard>
  );
}

function ConversionsSection({ conversions }: { readonly conversions: readonly ConversionEdge[] }) {
  if (conversions.length === 0) {
    return (
      <SectionCard title="Conversions" meta="FND-003">
        <EmptyState title="No conversions defined for this item">
          Conversions are effective-dated factors between units (1 <em>from</em> = factor ×{" "}
          <em>to</em>). Add one when a quantity needs to move between units without a supplier pack
          covering it.
        </EmptyState>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Conversions" meta={`${conversions.length} effective · FND-003`}>
      <Table
        caption="Effective conversions scoped to this item, resolved at the request time."
        columnCount={5}
      >
        <thead>
          <tr>
            <Th>From</Th>
            <Th>To</Th>
            <Th style={numCell}>Factor</Th>
            <Th>Scope</Th>
            <Th>Effective</Th>
          </tr>
        </thead>
        <tbody>
          {conversions.map((edge) => (
            <tr key={`${edge.fromUnit.id}:${edge.toUnit.id}:${edge.effectiveFrom.toISOString()}`}>
              <Td>{edge.fromUnit.code}</Td>
              <Td>{edge.toUnit.code}</Td>
              <Td style={numCell}>{trimDecimal(edge.factor)}</Td>
              <Td>{edge.itemId === null ? "Global" : "This item"}</Td>
              <Td>
                {edge.effectiveFrom.toISOString().slice(0, 10)}
                {" → "}
                {edge.effectiveTo === null ? "open" : edge.effectiveTo.toISOString().slice(0, 10)}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </SectionCard>
  );
}

interface StockRow {
  readonly key: string;
  readonly locationCode: string;
  readonly storageAreaLabel: string;
  readonly lotNumber: string | null;
  readonly quantity: string;
  readonly value: string;
  readonly avgUnitCost: string | null;
}

/* ---------------------------------- page ----------------------------------- */

/**
 * Item detail (08_UI_UX.md §8.3): identity, base unit, current cost, inventory
 * policy, lot tracking, supplier packs and item-scoped conversions, plus the
 * item's on-hand stock by location from the inventory read service. Price
 * history and affected recipes have no read model yet, so they are honest empty
 * states rather than fabricated figures.
 */
export default async function ItemDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly itemId: string }>;
}) {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const { itemId: rawItemId } = await params;
  const itemId = uuidOrNotFound(rawItemId);
  const organizationId = resolveOrganization();
  const catalogStore = createPostgresMasterDataStore(getDb().db);

  const detail = await getItem(catalogStore, { organizationId, itemId }).catch((error: unknown) => {
    if (error instanceof DomainError) {
      notFound();
    }
    throw error;
  });

  const { item, supplierItems, conversions } = detail;
  const organization = await catalogStore.findOrganization(organizationId);
  const currency = organization?.currency ?? null;
  const suppliers = await createPostgresReceivingStore(getDb().db).listSuppliers(organizationId);

  const inventoryStore = createPostgresInventoryStore(getDb().db);
  const asOf = new Date().toISOString();
  const balances = await getStockBalanceAsOf(inventoryStore, { organizationId, asOf, itemId });

  const stockRows: StockRow[] = [];
  for (const balance of balances) {
    if (balance.organizationId !== organizationId) {
      continue;
    }
    const [location, storageArea, lot] = await Promise.all([
      inventoryStore.findLocation(balance.locationId),
      inventoryStore.findStorageArea(balance.storageAreaId),
      balance.lotId === null
        ? Promise.resolve(undefined)
        : inventoryStore.findStockLot(balance.lotId),
    ]);
    const locationCode =
      location !== undefined && location.organizationId === organizationId ? location.code : "—";
    const storageAreaLabel =
      storageArea !== undefined && storageArea.organizationId === organizationId
        ? `${storageArea.code} · ${storageArea.name}`
        : "—";
    stockRows.push({
      key: [balance.locationId, balance.storageAreaId, balance.lotId ?? "no-lot"].join(":"),
      locationCode,
      storageAreaLabel,
      lotNumber: lot !== undefined && lot.organizationId === organizationId ? lot.lotNumber : null,
      quantity: trimDecimal(balance.quantityOnHand),
      value: formatMoneyAmount(balance.valueOnHand),
      avgUnitCost: balance.avgUnitCost === null ? null : formatMoneyAmount(balance.avgUnitCost),
    });
  }

  const currentCostLabel = item.currentCost === null ? null : formatMoneyAmount(item.currentCost);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: spacing[6],
        width: "100%",
        maxWidth: 1120,
        margin: "0 auto",
        padding: `${spacing[8]}px ${spacing[4]}px`,
      }}
    >
      <div>
        <a
          href="/products"
          style={{
            color: color.brand.navy,
            fontSize: typography.fontSize.sm,
            fontWeight: typography.fontWeight.semibold,
          }}
        >
          ← All products
        </a>
      </div>

      <PageHeader
        title={item.name}
        scope={`${item.code} · ${humanize(item.itemType)}`}
        description={`Base unit ${item.baseUnitCode}. Current cost, supplier packs, conversions and on-hand stock.`}
      />

      <SectionCard title="Identity" meta={`SKU ${item.sku}`}>
        <dl style={definitionList}>
          <Definition term="Code">{item.code}</Definition>
          <Definition term="SKU">{item.sku}</Definition>
          <Definition term="Type">{humanize(item.itemType)}</Definition>
          <Definition term="Base unit">{item.baseUnitCode}</Definition>
          <Definition term="Inventory policy">{humanize(item.inventoryPolicy)}</Definition>
          <Definition term="Lot tracked">
            {item.lotTracked ? (
              <StatusPill tone="info">Lot-tracked</StatusPill>
            ) : (
              <span style={{ color: color.text.muted }}>Not tracked</span>
            )}
          </Definition>
          <Definition term={currency === null ? "Current cost" : `Current cost (${currency})`}>
            {currentCostLabel === null ? (
              <span style={{ color: color.text.muted }}>No cost recorded</span>
            ) : (
              currentCostLabel
            )}
          </Definition>
          <Definition term="Active">
            {item.activeFrom}
            {" → "}
            {item.activeTo ?? "open"}
          </Definition>
        </dl>
      </SectionCard>

      <SectionCard title="Edit item" meta="W2 · edit">
        <details>
          <summary
            style={{
              cursor: "pointer",
              minHeight: 44,
              display: "flex",
              alignItems: "center",
              fontSize: typography.fontSize.md,
              fontWeight: typography.fontWeight.semibold,
              color: color.brand.navy,
            }}
          >
            Edit name, inventory policy and lot tracking
          </summary>
          <div style={{ marginTop: spacing[4] }}>
            <EditItemForm
              itemId={item.id}
              name={item.name}
              inventoryPolicy={item.inventoryPolicy}
              lotTracked={item.lotTracked}
              inventoryPolicies={INVENTORY_POLICY}
            />
          </div>
        </details>
      </SectionCard>

      <SupplierPacksSection packs={supplierItems} baseUnitCode={item.baseUnitCode} />

      <SectionCard title="Register a supplier pack" meta="PROC-001 · create">
        <details>
          <summary
            style={{
              cursor: "pointer",
              minHeight: 44,
              display: "flex",
              alignItems: "center",
              fontSize: typography.fontSize.md,
              fontWeight: typography.fontWeight.semibold,
              color: color.brand.navy,
            }}
          >
            New supplier pack
          </summary>
          <div style={{ marginTop: spacing[4] }}>
            <RegisterSupplierPackForm
              itemId={item.id}
              baseUnitCode={item.baseUnitCode}
              suppliers={suppliers.map((supplier) => ({
                id: supplier.id,
                code: supplier.code,
                name: supplier.name,
              }))}
            />
          </div>
        </details>
      </SectionCard>

      <ConversionsSection conversions={conversions} />

      <SectionCard
        title="Stock"
        meta={`As of ${formatInstant(asOf)} · moving weighted average (DEC-008)`}
      >
        {stockRows.length === 0 ? (
          <EmptyState title="No stock movements for this item">
            On-hand stock appears here once a goods receipt, production output, transfer or stock
            count posts a movement for this item. This view reads the ledger as of{" "}
            {formatInstant(asOf)}.
          </EmptyState>
        ) : (
          <Table
            caption={`On-hand stock for ${item.name} by location, storage area and lot as of ${formatInstant(asOf)}.`}
            columnCount={6}
          >
            <thead>
              <tr>
                <Th>Location</Th>
                <Th>Storage area</Th>
                <Th>Lot</Th>
                <Th style={numCell}>Quantity</Th>
                <Th style={numCell}>{currency === null ? "Value" : `Value (${currency})`}</Th>
                <Th style={numCell}>
                  {currency === null ? "Avg unit cost" : `Avg unit cost (${currency})`}
                </Th>
              </tr>
            </thead>
            <tbody>
              {stockRows.map((row) => (
                <tr key={row.key}>
                  <Td>{row.locationCode}</Td>
                  <Td>{row.storageAreaLabel}</Td>
                  <Td>
                    {row.lotNumber === null ? (
                      <span style={{ color: color.text.muted }}>No lot</span>
                    ) : (
                      row.lotNumber
                    )}
                  </Td>
                  <Td style={numCell}>
                    <span style={{ fontWeight: typography.fontWeight.semibold }}>
                      {row.quantity}
                    </span>{" "}
                    {item.baseUnitCode}
                  </Td>
                  <Td style={numCell}>{row.value}</Td>
                  <Td style={numCell}>
                    {row.avgUnitCost === null ? (
                      <span style={{ color: color.text.muted }}>—</span>
                    ) : (
                      row.avgUnitCost
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </SectionCard>

      <SectionCard title="Price history" meta="08_UI_UX.md §8.3">
        <EmptyState title="Price history is not available yet">
          Supplier price history is recorded by the receiving slice, but no read model exposes it to
          this screen yet. Until then this section stays empty rather than showing a stale figure.
        </EmptyState>
      </SectionCard>

      <SectionCard title="Affected recipes" meta="08_UI_UX.md §8.3">
        <EmptyState title="Affected recipes are not available yet">
          No read model yet links a recipe line back to this item. A reverse lookup from an item to
          the recipes that use it is a later slice.
        </EmptyState>
      </SectionCard>
    </div>
  );
}
