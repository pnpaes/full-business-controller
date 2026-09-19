import type { AuditInput } from "../auth";
import type {
  NewCostObservationRecord,
  NewReceiptLineRecord,
  NewReceiptRecord,
  NewSupplierPriceRecord,
  ReceivingItem,
  ReceivingStore,
  ReceivingSupplier,
  ReceivingSupplierItem,
  ReceivingUnit,
} from "./types";

/**
 * In-memory `ReceivingStore` for the unit suite. It mirrors the observable
 * contract closely enough to exercise `recordGoodsReceipt` without a database;
 * `receiving.postgres.test.ts` covers the real adapter.
 */
export class FakeReceivingStore implements ReceivingStore {
  readonly units = new Map<string, ReceivingUnit>();
  readonly items = new Map<string, ReceivingItem>();
  readonly suppliers = new Map<string, ReceivingSupplier>();
  readonly supplierItems = new Map<string, ReceivingSupplierItem>();
  readonly receipts: ({ id: string } & NewReceiptRecord)[] = [];
  readonly lines: ({ id: string; goodsReceiptId: string } & NewReceiptLineRecord)[] = [];
  readonly supplierPrices: ({ id: string } & NewSupplierPriceRecord)[] = [];
  readonly costObservations: ({ id: string } & NewCostObservationRecord)[] = [];
  readonly audits: AuditInput[] = [];

  async withTransaction<T>(fn: (store: ReceivingStore) => Promise<T>): Promise<T> {
    return fn(this);
  }

  findUnit(unitId: string): Promise<ReceivingUnit | undefined> {
    return Promise.resolve(this.units.get(unitId));
  }

  findItem(itemId: string): Promise<ReceivingItem | undefined> {
    return Promise.resolve(this.items.get(itemId));
  }

  findSupplier(supplierId: string): Promise<ReceivingSupplier | undefined> {
    return Promise.resolve(this.suppliers.get(supplierId));
  }

  findSupplierItem(supplierItemId: string): Promise<ReceivingSupplierItem | undefined> {
    return Promise.resolve(this.supplierItems.get(supplierItemId));
  }

  closeOpenSupplierPrices(supplierItemId: string, at: Date): Promise<number> {
    let closed = 0;
    for (const price of this.supplierPrices) {
      if (
        price.supplierItemId === supplierItemId &&
        price.effectiveFrom.getTime() <= at.getTime() &&
        (price.effectiveTo === null || price.effectiveTo.getTime() > at.getTime())
      ) {
        this.supplierPrices[this.supplierPrices.indexOf(price)] = { ...price, effectiveTo: at };
        closed += 1;
      }
    }
    return Promise.resolve(closed);
  }

  createSupplierPrice(input: NewSupplierPriceRecord): Promise<{ id: string }> {
    const id = `supplier-price-${this.supplierPrices.length + 1}`;
    this.supplierPrices.push({ id, ...input });
    return Promise.resolve({ id });
  }

  createCostObservation(input: NewCostObservationRecord): Promise<{ id: string }> {
    const id = `cost-observation-${this.costObservations.length + 1}`;
    this.costObservations.push({ id, ...input });
    return Promise.resolve({ id });
  }

  createGoodsReceipt(input: NewReceiptRecord): Promise<{ id: string }> {
    const id = `receipt-${this.receipts.length + 1}`;
    this.receipts.push({ id, ...input });
    return Promise.resolve({ id });
  }

  createGoodsReceiptLine(input: NewReceiptLineRecord): Promise<{ id: string }> {
    const id = `receipt-line-${this.lines.length + 1}`;
    this.lines.push({ id, ...input });
    return Promise.resolve({ id });
  }

  writeAudit(input: AuditInput): Promise<void> {
    this.audits.push(input);
    return Promise.resolve();
  }
}
