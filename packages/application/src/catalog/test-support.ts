import type { AuditInput } from "../auth";
import type {
  CatalogItemPage,
  CatalogItemRecord,
  ConversionEdge,
  ListItemsQuery,
  MasterDataStore,
  MasterItem,
  MasterSupplier,
  MasterSupplierRecord,
  MasterUnit,
  NewMasterItem,
  NewMasterSupplier,
  NewMasterUnit,
  NewSupplierItem,
  NewUnitConversionRecord,
  SupplierItemDetail,
  SupplierItemRecord,
  UnitListQuery,
  UpdateItemRecord,
  VariantBackingRecord,
} from "./types";

/**
 * In-memory `MasterDataStore` for the unit suite. It mirrors the observable
 * contract closely enough to exercise the commands and read services without a
 * database; `catalog.postgres.test.ts` covers the real adapter.
 *
 * Two item stores coexist: `items` (the minimal identity record the commands
 * use) and `catalogItems` (the full read projection the Products screens use),
 * so a command can create an item without the read fixture having to spell out
 * every display field. `addCatalogItem` seeds the read projection directly.
 */
export class FakeMasterDataStore implements MasterDataStore {
  readonly units = new Map<string, MasterUnit>();
  readonly items = new Map<string, MasterItem>();
  readonly catalogItems = new Map<string, CatalogItemRecord>();
  readonly organizations = new Map<string, string>();
  readonly suppliers = new Map<string, MasterSupplier>();
  readonly supplierMasters: MasterSupplierRecord[] = [];
  readonly supplierItems: SupplierItemRecord[] = [];
  readonly supplierItemDetails: SupplierItemDetail[] = [];
  readonly conversions: ConversionEdge[] = [];
  readonly audits: AuditInput[] = [];
  /** `DEC-150`: variants seeded as referencing an item (the "Backs" read). */
  readonly variantBackings: {
    organizationId: string;
    itemId: string;
    backing: VariantBackingRecord;
  }[] = [];

  /** Owning organization per unit id, so `listUnits` can scope by tenant. */
  private readonly unitOrganizations = new Map<string, string>();

  private unitSequence = 0;
  private itemSequence = 0;

  addConversion(edge: ConversionEdge): void {
    this.conversions.push(edge);
  }

  /** Seeds one unit for `organizationId` (the read fixture `createUnit` cannot tag). */
  addUnit(record: MasterUnit, organizationId: string): void {
    this.units.set(record.id, record);
    this.unitOrganizations.set(record.id, organizationId);
  }

  addCatalogItem(record: CatalogItemRecord): void {
    this.catalogItems.set(record.id, record);
  }

  addVariantBacking(organizationId: string, itemId: string, backing: VariantBackingRecord): void {
    this.variantBackings.push({ organizationId, itemId, backing });
  }

  async withTransaction<T>(fn: (store: MasterDataStore) => Promise<T>): Promise<T> {
    return fn(this);
  }

  findUnit(unitId: string): Promise<MasterUnit | undefined> {
    return Promise.resolve(this.units.get(unitId));
  }

  /**
   * Codes are matched organization-agnostically, mirroring the fake's existing
   * org-agnostic `findUnit`; the real repository scopes by organization.
   */
  findUnitByCode(_organizationId: string, code: string): Promise<MasterUnit | undefined> {
    return Promise.resolve([...this.units.values()].find((row) => row.code === code));
  }

  createUnit(input: NewMasterUnit): Promise<MasterUnit> {
    this.unitSequence += 1;
    const record: MasterUnit = {
      id: `unit-${this.unitSequence}`,
      code: input.code,
      dimension: input.dimension,
      isBase: input.isBase ?? false,
    };
    this.units.set(record.id, record);
    this.unitOrganizations.set(record.id, input.organizationId);
    return Promise.resolve(record);
  }

  listUnits(query: UnitListQuery): Promise<readonly MasterUnit[]> {
    const matching = [...this.units.values()]
      .filter((row) => this.unitOrganizations.get(row.id) === query.organizationId)
      .filter((row) => query.dimension === undefined || row.dimension === query.dimension)
      .sort((a, b) => a.code.localeCompare(b.code) || a.id.localeCompare(b.id));
    const offset = query.offset ?? 0;
    return Promise.resolve(
      query.limit === undefined
        ? matching.slice(offset)
        : matching.slice(offset, offset + query.limit),
    );
  }

  findItem(itemId: string): Promise<MasterItem | undefined> {
    return Promise.resolve(this.items.get(itemId));
  }

  findItemByCode(organizationId: string, code: string): Promise<MasterItem | undefined> {
    return Promise.resolve(
      [...this.items.values()].find(
        (row) => row.organizationId === organizationId && row.code === code,
      ),
    );
  }

  findItemBySku(organizationId: string, sku: string): Promise<MasterItem | undefined> {
    return Promise.resolve(
      [...this.items.values()].find(
        (row) => row.organizationId === organizationId && row.sku === sku,
      ),
    );
  }

  createItem(input: NewMasterItem): Promise<MasterItem> {
    this.itemSequence += 1;
    const record: MasterItem = {
      id: `item-${this.itemSequence}`,
      organizationId: input.organizationId,
      code: input.code,
      sku: input.sku,
      baseUnitId: input.baseUnitId,
    };
    this.items.set(record.id, record);
    const baseUnit = this.units.get(input.baseUnitId);
    this.catalogItems.set(record.id, {
      id: record.id,
      organizationId: input.organizationId,
      code: input.code,
      sku: input.sku,
      name: input.name,
      itemType: input.itemType,
      purpose: input.purpose,
      baseUnitId: input.baseUnitId,
      baseUnitCode: baseUnit?.code ?? "",
      inventoryPolicy: input.inventoryPolicy,
      lotTracked: input.lotTracked,
      currentCost: null,
      activeFrom: "2026-01-01",
      activeTo: null,
    });
    return Promise.resolve(record);
  }

  listItems(query: ListItemsQuery): Promise<CatalogItemPage> {
    const search = query.search?.trim().toLowerCase();
    const matching = [...this.catalogItems.values()]
      .filter((row) => row.organizationId === query.organizationId)
      .filter((row) => query.itemType === undefined || row.itemType === query.itemType)
      .filter((row) => query.purpose === undefined || row.purpose === query.purpose)
      .filter(
        (row) =>
          search === undefined ||
          search.length === 0 ||
          row.code.toLowerCase().includes(search) ||
          row.sku.toLowerCase().includes(search) ||
          row.name.toLowerCase().includes(search),
      )
      .sort((a, b) => a.code.localeCompare(b.code));
    return Promise.resolve({
      items: matching.slice(query.offset, query.offset + query.limit),
      total: matching.length,
    });
  }

  findCatalogItem(itemId: string): Promise<CatalogItemRecord | undefined> {
    return Promise.resolve(this.catalogItems.get(itemId));
  }

  listVariantsForFinishedGoodItem(
    organizationId: string,
    itemId: string,
  ): Promise<readonly VariantBackingRecord[]> {
    return Promise.resolve(
      this.variantBackings
        .filter((row) => row.organizationId === organizationId && row.itemId === itemId)
        .map((row) => row.backing),
    );
  }

  listSupplierItemsForItem(
    organizationId: string,
    itemId: string,
  ): Promise<readonly SupplierItemDetail[]> {
    return Promise.resolve(
      this.supplierItemDetails.filter(
        (row) => row.organizationId === organizationId && row.itemId === itemId,
      ),
    );
  }

  findOrganization(organizationId: string): Promise<{ id: string; currency: string } | undefined> {
    const currency = this.organizations.get(organizationId);
    return Promise.resolve(currency === undefined ? undefined : { id: organizationId, currency });
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

  updateItem(input: UpdateItemRecord): Promise<void> {
    const catalog = this.catalogItems.get(input.itemId);
    if (catalog !== undefined) {
      this.catalogItems.set(input.itemId, {
        ...catalog,
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
        ...(input.inventoryPolicy === undefined ? {} : { inventoryPolicy: input.inventoryPolicy }),
        ...(input.lotTracked === undefined ? {} : { lotTracked: input.lotTracked }),
      });
    }
    return Promise.resolve();
  }

  findSupplierByCode(
    organizationId: string,
    code: string,
  ): Promise<MasterSupplierRecord | undefined> {
    return Promise.resolve(
      this.supplierMasters.find(
        (row) => row.organizationId === organizationId && row.code === code,
      ),
    );
  }

  createSupplier(input: NewMasterSupplier): Promise<MasterSupplierRecord> {
    const record: MasterSupplierRecord = {
      id: `supplier-${this.supplierMasters.length + 1}`,
      organizationId: input.organizationId,
      code: input.code,
      name: input.name,
      contact: input.contact ?? null,
      terms: input.terms ?? null,
      currency: input.currency,
      active: input.active ?? true,
    };
    this.supplierMasters.push(record);
    this.suppliers.set(record.id, { id: record.id, organizationId: record.organizationId });
    return Promise.resolve(record);
  }

  createUnitConversion(input: NewUnitConversionRecord): Promise<{ id: string }> {
    const id = `conversion-${this.conversions.length + 1}`;
    const fromUnit = this.units.get(input.fromUnitId);
    const toUnit = this.units.get(input.toUnitId);
    if (fromUnit !== undefined && toUnit !== undefined) {
      this.conversions.push({
        fromUnit,
        toUnit,
        factor: input.factor,
        itemId: input.itemId,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo,
      });
    }
    return Promise.resolve({ id });
  }

  writeAudit(input: AuditInput): Promise<void> {
    this.audits.push(input);
    return Promise.resolve();
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
