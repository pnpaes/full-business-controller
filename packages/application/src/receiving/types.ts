import type { UnitDimension } from "@aquarela/domain";

import type { AuditInput } from "../auth";

/**
 * Application-level ports and DTOs for slice-4 receiving. The store is a narrow
 * port over `@aquarela/persistence` so `recordGoodsReceipt` can be unit-tested
 * against an in-memory fake; `createPostgresReceivingStore` is the real adapter.
 * The record types are structural subsets of the persistence rows.
 */

export interface ReceivingUnit {
  readonly id: string;
  readonly code: string;
  readonly dimension: UnitDimension;
  readonly isBase: boolean;
}

export interface ReceivingItem {
  readonly id: string;
  readonly organizationId: string;
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

export interface ReceivingStore {
  /** Binds `fn` to one transaction so the receipt, its price history and the audit row commit together. */
  withTransaction<T>(fn: (store: ReceivingStore) => Promise<T>): Promise<T>;
  findItem(itemId: string): Promise<ReceivingItem | undefined>;
  findUnit(unitId: string): Promise<ReceivingUnit | undefined>;
  findSupplier(supplierId: string): Promise<ReceivingSupplier | undefined>;
  findSupplierItem(supplierItemId: string): Promise<ReceivingSupplierItem | undefined>;
  /** Closes the currently-effective `supplier_price` window(s) for a supplier item. */
  closeOpenSupplierPrices(supplierItemId: string, at: Date): Promise<number>;
  createSupplierPrice(input: NewSupplierPriceRecord): Promise<{ id: string }>;
  createCostObservation(input: NewCostObservationRecord): Promise<{ id: string }>;
  createGoodsReceipt(input: NewReceiptRecord): Promise<{ id: string }>;
  createGoodsReceiptLine(input: NewReceiptLineRecord): Promise<{ id: string }>;
  /** Append-only audit fact; the caller must not pass secrets (ADR-0003 convention). */
  writeAudit(input: AuditInput): Promise<void>;
}
