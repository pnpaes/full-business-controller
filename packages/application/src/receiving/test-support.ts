import {
  MONEY_SCALE,
  QUANTITY_SCALE,
  formatDecimal,
  parseDecimal,
  rescale,
} from "@aquarela/domain";

import type { AuditInput } from "../auth";
import { FakeInventoryStore } from "../inventory/test-support";
import type { TaxRuleRecord, TaxRuleSummaryRecord } from "../tax/read-types";
import type {
  GoodsReceiptLineRecord,
  GoodsReceiptSummaryRecord,
  NewCostObservationRecord,
  NewReceiptLineRecord,
  NewReceiptRecord,
  NewSupplierPriceRecord,
  ReceivingItem,
  ReceivingLocationRecord,
  ReceivingStore,
  ReceivingSupplier,
  ReceivingSupplierItem,
  ReceivingSupplierItemOption,
  ReceivingSupplierOption,
  ReceivingUnit,
} from "./types";

/** One line's gross (price × received packs) rounded HALF_UP at money scale. */
function lineGross(line: NewReceiptLineRecord): bigint {
  const product =
    parseDecimal(line.price, MONEY_SCALE) * parseDecimal(line.receivedPackQty, QUANTITY_SCALE);
  return rescale(product, MONEY_SCALE + QUANTITY_SCALE, MONEY_SCALE);
}

/** The picker projection drops the scope and effective-window columns. */
function toTaxRuleSummary(rule: TaxRuleRecord): TaxRuleSummaryRecord {
  return {
    id: rule.id,
    organizationId: rule.organizationId,
    code: rule.code,
    name: rule.name,
    ratePct: rule.ratePct,
    taxBasis: rule.taxBasis,
    taxTreatment: rule.taxTreatment,
    recoverable: rule.recoverable,
    appliesTo: rule.appliesTo,
    scopeType: rule.scopeType,
  };
}

/**
 * In-memory `ReceivingStore` for the unit suite. It mirrors the observable
 * contract closely enough to exercise `recordGoodsReceipt` without a database;
 * `receiving.postgres.test.ts` covers the real adapter.
 */
export class FakeReceivingStore implements ReceivingStore {
  /**
   * The slice-8 ledger port (`DEC-145`): the receipt posts its stock movements
   * here, so the unit suite exercises the real `postStockMovement` path. Seed
   * it with the organization/location/storage-area/item/unit fixture the
   * posting validates against.
   */
  readonly inventory = new FakeInventoryStore();
  readonly units = new Map<string, ReceivingUnit>();
  readonly items = new Map<string, ReceivingItem>();
  readonly suppliers = new Map<string, ReceivingSupplier>();
  readonly supplierItems = new Map<string, ReceivingSupplierItem>();
  readonly receipts: ({ id: string } & NewReceiptRecord)[] = [];
  readonly lines: ({ id: string; goodsReceiptId: string } & NewReceiptLineRecord)[] = [];
  readonly supplierPrices: ({ id: string } & NewSupplierPriceRecord)[] = [];
  readonly costObservations: ({ id: string } & NewCostObservationRecord)[] = [];
  readonly audits: AuditInput[] = [];
  readonly locations = new Map<string, ReceivingLocationRecord>();
  readonly supplierOptions: ReceivingSupplierOption[] = [];
  readonly supplierItemOptions: ReceivingSupplierItemOption[] = [];
  readonly taxRules = new Map<string, TaxRuleRecord>();

  async withTransaction<T>(fn: (store: ReceivingStore) => Promise<T>): Promise<T> {
    return fn(this);
  }

  /** Projects a stored receipt to the read record, deriving the gross total. */
  #toSummary(receipt: { id: string } & NewReceiptRecord): GoodsReceiptSummaryRecord {
    const gross = this.lines
      .filter((line) => line.goodsReceiptId === receipt.id)
      .reduce((total, line) => total + lineGross(line), 0n);
    return {
      id: receipt.id,
      organizationId: receipt.organizationId,
      supplierId: receipt.supplierId,
      storeName: receipt.storeName,
      locationId: receipt.locationId,
      purchaseOrderId: receipt.purchaseOrderId,
      deliveryRef: receipt.deliveryRef,
      receivedAt: receipt.receivedAt.toISOString(),
      status: receipt.status,
      acceptedBy: receipt.acceptedBy,
      acceptedAt: receipt.acceptedAt.toISOString(),
      reversalOfId: null,
      evidenceFileId: receipt.evidenceFileId,
      grossTotal: formatDecimal(gross, MONEY_SCALE),
    };
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

  findOpenSupplierPrice(
    supplierItemId: string,
  ): Promise<{ grossPackPrice: string; landedBaseUnitCost: string } | undefined> {
    const open = this.supplierPrices.find(
      (price) => price.supplierItemId === supplierItemId && price.effectiveTo === null,
    );
    return Promise.resolve(
      open === undefined
        ? undefined
        : { grossPackPrice: open.grossPackPrice, landedBaseUnitCost: open.landedBaseUnitCost },
    );
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

  listGoodsReceipts(query: {
    readonly organizationId: string;
    readonly locationId?: string;
    readonly supplierId?: string;
    readonly limit: number;
    readonly offset: number;
  }): Promise<readonly GoodsReceiptSummaryRecord[]> {
    const filtered = this.receipts
      .filter((receipt) => receipt.organizationId === query.organizationId)
      .filter(
        (receipt) => query.locationId === undefined || receipt.locationId === query.locationId,
      )
      .filter(
        (receipt) => query.supplierId === undefined || receipt.supplierId === query.supplierId,
      )
      .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime() || (a.id < b.id ? 1 : -1));
    return Promise.resolve(
      filtered
        .slice(query.offset, query.offset + query.limit)
        .map((receipt) => this.#toSummary(receipt)),
    );
  }

  findGoodsReceipt(receiptId: string): Promise<GoodsReceiptSummaryRecord | undefined> {
    const receipt = this.receipts.find((row) => row.id === receiptId);
    return Promise.resolve(receipt === undefined ? undefined : this.#toSummary(receipt));
  }

  listGoodsReceiptLines(receiptId: string): Promise<readonly GoodsReceiptLineRecord[]> {
    return Promise.resolve(
      this.lines.filter((line) => line.goodsReceiptId === receiptId).map((line) => ({ ...line })),
    );
  }

  findLocation(locationId: string): Promise<ReceivingLocationRecord | undefined> {
    return Promise.resolve(this.locations.get(locationId));
  }

  listLocations(organizationId: string): Promise<readonly ReceivingLocationRecord[]> {
    return Promise.resolve(
      [...this.locations.values()].filter((row) => row.organizationId === organizationId),
    );
  }

  listSuppliers(organizationId: string): Promise<readonly ReceivingSupplierOption[]> {
    return Promise.resolve(
      this.supplierOptions.filter((row) => row.organizationId === organizationId),
    );
  }

  listSupplierItemOptions(organizationId: string): Promise<readonly ReceivingSupplierItemOption[]> {
    return Promise.resolve(
      this.supplierItemOptions.filter((row) => row.organizationId === organizationId),
    );
  }

  #taxRulesByCode(): TaxRuleRecord[] {
    return [...this.taxRules.values()].sort((a, b) =>
      a.code < b.code ? -1 : a.code > b.code ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
  }

  listTaxRules(query: {
    readonly organizationId: string;
    readonly appliesTo?: string;
    readonly scopeType?: string;
    readonly limit: number;
    readonly offset: number;
  }): Promise<readonly TaxRuleSummaryRecord[]> {
    const rows = this.#taxRulesByCode()
      .filter(
        (rule) =>
          rule.organizationId === query.organizationId &&
          (query.appliesTo === undefined || rule.appliesTo === query.appliesTo) &&
          (query.scopeType === undefined || rule.scopeType === query.scopeType),
      )
      .slice(query.offset, query.offset + query.limit);
    return Promise.resolve(rows.map(toTaxRuleSummary));
  }

  listEffectiveTaxRules(query: {
    readonly organizationId: string;
    readonly asOf: Date;
    readonly appliesTo?: string;
  }): Promise<readonly TaxRuleRecord[]> {
    const at = query.asOf.getTime();
    const rows = this.#taxRulesByCode().filter(
      (rule) =>
        rule.organizationId === query.organizationId &&
        (query.appliesTo === undefined || rule.appliesTo === query.appliesTo) &&
        rule.effectiveFrom.getTime() <= at &&
        (rule.effectiveTo === null || rule.effectiveTo.getTime() > at),
    );
    return Promise.resolve(rows);
  }

  writeAudit(input: AuditInput): Promise<void> {
    this.audits.push(input);
    return Promise.resolve();
  }
}
