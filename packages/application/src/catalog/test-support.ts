import type {
  ConversionEdge,
  MasterDataStore,
  MasterItem,
  MasterSupplier,
  MasterUnit,
  NewSupplierItem,
  SupplierItemRecord,
} from "./types";

/**
 * In-memory `MasterDataStore` for the unit suite. It mirrors the observable
 * contract closely enough to exercise the commands without a database;
 * `catalog.postgres.test.ts` covers the real adapter.
 */
export class FakeMasterDataStore implements MasterDataStore {
  readonly units = new Map<string, MasterUnit>();
  readonly items = new Map<string, MasterItem>();
  readonly suppliers = new Map<string, MasterSupplier>();
  readonly supplierItems: SupplierItemRecord[] = [];
  readonly conversions: ConversionEdge[] = [];

  addConversion(edge: ConversionEdge): void {
    this.conversions.push(edge);
  }

  findUnit(unitId: string): Promise<MasterUnit | undefined> {
    return Promise.resolve(this.units.get(unitId));
  }

  findItem(itemId: string): Promise<MasterItem | undefined> {
    return Promise.resolve(this.items.get(itemId));
  }

  findSupplier(supplierId: string): Promise<MasterSupplier | undefined> {
    return Promise.resolve(this.suppliers.get(supplierId));
  }

  findSupplierItemBySku(
    supplierId: string,
    supplierSku: string,
  ): Promise<SupplierItemRecord | undefined> {
    return Promise.resolve(
      this.supplierItems.find(
        (row) => row.supplierId === supplierId && row.supplierSku === supplierSku,
      ),
    );
  }

  createSupplierItem(input: NewSupplierItem): Promise<SupplierItemRecord> {
    const record: SupplierItemRecord = {
      id: `supplier-item-${this.supplierItems.length + 1}`,
      organizationId: input.organizationId,
      supplierId: input.supplierId,
      itemId: input.itemId,
      supplierSku: input.supplierSku,
      packUnitId: input.packUnitId,
      packToBaseUnitFactor: input.packToBaseUnitFactor,
      minOrderQty: input.minOrderQty ?? null,
      leadTimeDays: input.leadTimeDays ?? null,
      preferred: input.preferred ?? false,
    };
    this.supplierItems.push(record);
    return Promise.resolve(record);
  }

  listEffectiveConversions(
    _organizationId: string,
    asOf: Date,
    itemId: string | null,
  ): Promise<readonly ConversionEdge[]> {
    return Promise.resolve(
      this.conversions.filter((edge) => {
        const effective =
          edge.effectiveFrom.getTime() <= asOf.getTime() &&
          (edge.effectiveTo === null || asOf.getTime() < edge.effectiveTo.getTime());
        if (!effective) {
          return false;
        }
        return itemId === null
          ? edge.itemId === null
          : edge.itemId === null || edge.itemId === itemId;
      }),
    );
  }
}
