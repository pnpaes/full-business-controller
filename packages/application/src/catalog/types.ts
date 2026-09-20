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

export interface NewMasterUnit {
  readonly organizationId: string;
  readonly code: string;
  readonly dimension: UnitDimension;
  readonly isBase?: boolean;
}

export interface MasterItem {
  readonly id: string;
  readonly organizationId: string;
  readonly code: string;
  readonly sku: string;
  readonly baseUnitId: string;
}

export interface NewMasterItem {
  readonly organizationId: string;
  readonly code: string;
  readonly sku: string;
  readonly name: string;
  readonly itemType: string;
  readonly baseUnitId: string;
  readonly inventoryPolicy: string;
  readonly lotTracked: boolean;
}

/**
 * The item read projection for the Products screens: the identity fields plus the
 * base unit code, inventory policy, lot tracking, current cost and active range.
 * Record types are structural subsets of the persistence rows; `date` columns
 * stay `yyyy-mm-dd` strings and money stays a numeric(19,4) string (see the
 * adapter's mappers).
 */
export interface CatalogItemRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly code: string;
  readonly sku: string;
  readonly name: string;
  readonly itemType: string;
  readonly baseUnitId: string;
  readonly baseUnitCode: string;
  readonly inventoryPolicy: string;
  readonly lotTracked: boolean;
  /** numeric(19,4); null when no cost has been recorded. */
  readonly currentCost: string | null;
  /** `date` (`yyyy-mm-dd`). */
  readonly activeFrom: string;
  /** `date` (`yyyy-mm-dd`), null while active. */
  readonly activeTo: string | null;
}

export interface ListItemsQuery {
  readonly organizationId: string;
  readonly search?: string;
  readonly itemType?: string;
  readonly limit: number;
  readonly offset: number;
}

export interface CatalogItemPage {
  readonly items: readonly CatalogItemRecord[];
  readonly total: number;
}

/** A supplier pack enriched with its supplier and pack-unit codes for display. */
export interface SupplierItemDetail extends SupplierItemRecord {
  readonly supplierCode: string;
  readonly supplierName: string;
  readonly packUnitCode: string;
}

export interface MasterSupplier {
  readonly id: string;
  readonly organizationId: string;
}

/** The served organization's display currency for monetary reads. */
export interface CatalogOrganizationRecord {
  readonly id: string;
  readonly currency: string;
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
  /** `unit.code` is unique per organization. */
  findUnitByCode(organizationId: string, code: string): Promise<MasterUnit | undefined>;
  createUnit(input: NewMasterUnit): Promise<MasterUnit>;
  findItem(itemId: string): Promise<MasterItem | undefined>;
  /** `item.code` is unique per organization. */
  findItemByCode(organizationId: string, code: string): Promise<MasterItem | undefined>;
  /** `item.sku` is unique per organization. */
  findItemBySku(organizationId: string, sku: string): Promise<MasterItem | undefined>;
  createItem(input: NewMasterItem): Promise<MasterItem>;
  /** One page of organization items joined to their base unit, ordered by code. */
  listItems(query: ListItemsQuery): Promise<CatalogItemPage>;
  /** By id; organization-agnostic, so the caller must scope by `organizationId`. */
  findCatalogItem(itemId: string): Promise<CatalogItemRecord | undefined>;
  /** The supplier packs registered for one item, with supplier/pack-unit codes. */
  listSupplierItemsForItem(
    organizationId: string,
    itemId: string,
  ): Promise<readonly SupplierItemDetail[]>;
  findOrganization(organizationId: string): Promise<CatalogOrganizationRecord | undefined>;
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
