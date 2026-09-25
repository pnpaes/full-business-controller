import type { UnitDimension } from "@aquarela/domain";

import type { AuditInput } from "../auth";
import type { TaxReadStore } from "../tax/read-types";

/**
 * Application-level ports and DTOs for slice-4 receiving. The store is a narrow
 * port over `@aquarela/persistence` so `recordGoodsReceipt` can be unit-tested
 * against an in-memory fake; `createPostgresReceivingStore` is the real adapter.
 * The record types are structural subsets of the persistence rows.
 */

export interface ReceivingUnit {
  readonly id: string;
  readonly organizationId: string;
  readonly code: string;
  readonly dimension: UnitDimension;
  readonly isBase: boolean;
}

export interface ReceivingItem {
  readonly id: string;
  readonly organizationId: string;
  readonly code: string;
  readonly name: string;
  readonly baseUnitId: string;
}

export interface ReceivingSupplier {
  readonly id: string;
  readonly organizationId: string;
}

export interface ReceivingSupplierItem {
  readonly id: string;
  readonly organizationId: string;
  readonly supplierId: string;
  readonly itemId: string;
  readonly packUnitId: string;
  readonly packToBaseUnitFactor: string;
}

export interface NewReceiptRecord {
  readonly organizationId: string;
  readonly supplierId: string | null;
  readonly storeName: string | null;
  readonly locationId: string;
  readonly purchaseOrderId: string | null;
  readonly deliveryRef: string | null;
  readonly receivedAt: Date;
  readonly status: string;
  readonly acceptedBy: string;
  readonly acceptedAt: Date;
  readonly evidenceFileId: string | null;
}

export interface NewReceiptLineRecord {
  readonly goodsReceiptId: string;
  readonly supplierItemId: string | null;
  readonly itemId: string;
  readonly receivedPackQty: string;
  readonly acceptedPackQty: string;
  readonly rejectedPackQty: string;
  readonly unitId: string;
  readonly packToBaseFactor: string;
  readonly price: string;
  readonly discount: string;
  readonly taxBasis: string;
  readonly taxCodeId: string | null;
  /** The resolved rate that produced the recoverable tax, or null (DEC-075). */
  readonly appliedTaxRate: string | null;
  readonly allocatedFreight: string;
  readonly importFee: string;
  readonly lotNumber: string | null;
  readonly expiryDate: string | null;
  readonly baseQtyAccepted: string;
  readonly landedBaseUnitCost: string;
}

/** A new effective-dated `supplier_price` row (real, known supplier). */
export interface NewSupplierPriceRecord {
  readonly organizationId: string;
  readonly supplierItemId: string;
  readonly grossPackPrice: string;
  readonly discount: string;
  readonly taxBasis: string;
  readonly taxRuleId: string | null;
  readonly allocatedFreight: string;
  readonly importFee: string;
  readonly otherCost: string;
  readonly netPackPrice: string;
  readonly landedPackCost: string;
  readonly landedBaseUnitCost: string;
  readonly currency: string;
  readonly sourceReceiptId: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
}

/** A new `cost_observation` row (ad-hoc grocery purchase, no supplier price). */
export interface NewCostObservationRecord {
  readonly organizationId: string;
  readonly itemId: string;
  readonly storeName: string | null;
  readonly observedAt: string;
  readonly packSize: string;
  readonly packUnitId: string;
  readonly packPrice: string;
  readonly currency: string;
  readonly source: string;
  readonly receiptFileId: string | null;
  readonly notes: string | null;
}

/* ------------------------------ read records ------------------------------- */

/** A location option for the receiving form/detail (`code`/`name` display). */
export interface ReceivingLocationRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly code: string;
  readonly name: string;
}

/** A supplier option with display fields; `findSupplier` stays the write-path read. */
export interface ReceivingSupplierOption {
  readonly id: string;
  readonly organizationId: string;
  readonly code: string;
  readonly name: string;
  readonly currency: string;
}

/**
 * A receivable pack: a `supplier_item` plus its item (code/name/base unit) and
 * pack unit code, so the form derives item, pack unit and factor from one choice.
 */
export interface ReceivingSupplierItemOption {
  readonly id: string;
  readonly organizationId: string;
  readonly supplierId: string;
  readonly itemId: string;
  readonly itemCode: string;
  readonly itemName: string;
  readonly baseUnitId: string;
  readonly packUnitId: string;
  readonly packUnitCode: string;
  /** numeric(19,6). */
  readonly packToBaseUnitFactor: string;
}

/**
 * One receipt plus its derived gross total (Σ `price × received_pack_qty`, each
 * product rounded HALF_UP to money scale). `timestamptz` columns are ISO strings
 * and `date` columns stay `yyyy-mm-dd`, as in the inventory port.
 */
export interface GoodsReceiptSummaryRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly supplierId: string | null;
  readonly storeName: string | null;
  readonly locationId: string;
  readonly purchaseOrderId: string | null;
  readonly deliveryRef: string | null;
  /** ISO timestamp. */
  readonly receivedAt: string;
  readonly status: string;
  readonly acceptedBy: string | null;
  /** ISO timestamp, or null. */
  readonly acceptedAt: string | null;
  readonly reversalOfId: string | null;
  readonly evidenceFileId: string | null;
  /** numeric(19,4). */
  readonly grossTotal: string;
}

/** A `goods_receipt_line` row (structural subset of the persistence row). */
export interface GoodsReceiptLineRecord {
  readonly id: string;
  readonly goodsReceiptId: string;
  readonly supplierItemId: string | null;
  readonly itemId: string;
  readonly receivedPackQty: string;
  readonly acceptedPackQty: string;
  readonly rejectedPackQty: string;
  readonly unitId: string;
  readonly packToBaseFactor: string;
  readonly price: string;
  readonly discount: string;
  readonly taxBasis: string;
  readonly taxCodeId: string | null;
  /**
   * The resolved rate captured on the rule-derived path, or null (migration
   * `0068`, `DEC-075`). Optional so the additive column does not force existing
   * consumers of this read DTO to populate it; the adapter always supplies it
   * (null when no rate applied).
   */
  readonly appliedTaxRate?: string | null;
  readonly allocatedFreight: string;
  readonly importFee: string;
  readonly lotNumber: string | null;
  /** `date`, `yyyy-mm-dd`. */
  readonly expiryDate: string | null;
  readonly baseQtyAccepted: string;
  readonly landedBaseUnitCost: string;
}

export interface ListGoodsReceiptsQuery {
  readonly organizationId: string;
  readonly locationId?: string;
  readonly supplierId?: string;
  readonly limit: number;
  readonly offset: number;
}

/**
 * Extends the tax read port because `recordGoodsReceipt` resolves an inclusive
 * line's recoverable tax from its linked rule (`PRICE-006`) inside the same
 * transaction, reading `tax_rule` through `listEffectiveTaxRules`.
 */
export interface ReceivingStore extends TaxReadStore {
  /** Binds `fn` to one transaction so the receipt, its price history and the audit row commit together. */
  withTransaction<T>(fn: (store: ReceivingStore) => Promise<T>): Promise<T>;
  findItem(itemId: string): Promise<ReceivingItem | undefined>;
  findUnit(unitId: string): Promise<ReceivingUnit | undefined>;
  findSupplier(supplierId: string): Promise<ReceivingSupplier | undefined>;
  findSupplierItem(supplierItemId: string): Promise<ReceivingSupplierItem | undefined>;
  /** The currently-open effective `supplier_price`, for the prior-cost variance. */
  findOpenSupplierPrice(
    supplierItemId: string,
  ): Promise<{ readonly grossPackPrice: string; readonly landedBaseUnitCost: string } | undefined>;
  /** Closes the currently-effective `supplier_price` window(s) for a supplier item. */
  closeOpenSupplierPrices(supplierItemId: string, at: Date): Promise<number>;
  createSupplierPrice(input: NewSupplierPriceRecord): Promise<{ id: string }>;
  createCostObservation(input: NewCostObservationRecord): Promise<{ id: string }>;
  createGoodsReceipt(input: NewReceiptRecord): Promise<{ id: string }>;
  createGoodsReceiptLine(input: NewReceiptLineRecord): Promise<{ id: string }>;
  /** Org-scoped receipts, newest first, with the derived gross total. */
  listGoodsReceipts(query: ListGoodsReceiptsQuery): Promise<readonly GoodsReceiptSummaryRecord[]>;
  /** One receipt by id (org checked by the caller against the record). */
  findGoodsReceipt(receiptId: string): Promise<GoodsReceiptSummaryRecord | undefined>;
  /** All lines of one receipt (unordered; the dictionary has no sequence column). */
  listGoodsReceiptLines(receiptId: string): Promise<readonly GoodsReceiptLineRecord[]>;
  findLocation(locationId: string): Promise<ReceivingLocationRecord | undefined>;
  listLocations(organizationId: string): Promise<readonly ReceivingLocationRecord[]>;
  listSuppliers(organizationId: string): Promise<readonly ReceivingSupplierOption[]>;
  listSupplierItemOptions(organizationId: string): Promise<readonly ReceivingSupplierItemOption[]>;
  /** Append-only audit fact; the caller must not pass secrets (ADR-0003 convention). */
  writeAudit(input: AuditInput): Promise<void>;
}
