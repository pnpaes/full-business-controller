import type { UnitDimension } from "@aquarela/domain";

/**
 * Application-level ports and DTOs for slice-3 catalog / procurement master
 * data. The store is a narrow port over persistence so the commands can be
 * unit-tested against an in-memory fake; `createPostgresMasterDataStore` is the
 * real adapter.
 */

export interface MasterUnit {
  readonly id: string;
  readonly code: string;
  readonly dimension: UnitDimension;
  readonly isBase: boolean;
}

export interface MasterItem {
  readonly id: string;
  readonly organizationId: string;
  readonly baseUnitId: string;
}

export interface MasterSupplier {
  readonly id: string;
  readonly organizationId: string;
}

export interface SupplierItemRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly supplierId: string;
  readonly itemId: string;
  readonly supplierSku: string;
  readonly packUnitId: string;
  readonly packToBaseUnitFactor: string;
  readonly minOrderQty: string | null;
  readonly leadTimeDays: number | null;
  readonly preferred: boolean;
}

export interface NewSupplierItem {
  readonly organizationId: string;
  readonly supplierId: string;
  readonly itemId: string;
  readonly supplierSku: string;
  readonly packUnitId: string;
  readonly packToBaseUnitFactor: string;
  readonly minOrderQty?: string;
  readonly leadTimeDays?: number;
  readonly preferred?: boolean;
}

/** One effective `unit_conversion` row with both units resolved. */
export interface ConversionEdge {
  readonly fromUnit: MasterUnit;
  readonly toUnit: MasterUnit;
  readonly factor: string;
  readonly itemId: string | null;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
}

export interface MasterDataStore {
  /**
   * Runs `fn` with a store bound to one database transaction, so the duplicate
   * check and the insert in `registerSupplierItem` commit (or roll back)
   * together. When the store is already bound to a transaction it runs inline.
   */
  withTransaction<T>(fn: (store: MasterDataStore) => Promise<T>): Promise<T>;
  findUnit(unitId: string): Promise<MasterUnit | undefined>;
  findItem(itemId: string): Promise<MasterItem | undefined>;
  findSupplier(supplierId: string): Promise<MasterSupplier | undefined>;
  findSupplierItemBySku(
    supplierId: string,
    supplierSku: string,
  ): Promise<SupplierItemRecord | undefined>;
  createSupplierItem(input: NewSupplierItem): Promise<SupplierItemRecord>;
  /**
   * Effective conversions for the organization at `asOf`. A non-null `itemId`
   * includes global edges and edges scoped to that item; null/absent returns
   * global edges only.
   */
  listEffectiveConversions(
    organizationId: string,
    asOf: Date,
    itemId: string | null,
  ): Promise<readonly ConversionEdge[]>;
}
