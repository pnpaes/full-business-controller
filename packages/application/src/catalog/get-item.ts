import { DomainError } from "@aquarela/domain";

import type {
  CatalogItemRecord,
  ConversionEdge,
  MasterDataStore,
  SupplierItemDetail,
} from "./types";

export interface GetItemInput {
  readonly organizationId: string;
  readonly itemId: string;
  /** The date the item-scoped conversions are resolved at; defaults to now. */
  readonly asOf?: Date;
}

export interface ItemDetail {
  readonly item: CatalogItemRecord;
  readonly supplierItems: readonly SupplierItemDetail[];
  readonly conversions: readonly ConversionEdge[];
}

/**
 * One item's detail (08_UI_UX.md §8.3): identity, base unit, current cost,
 * inventory policy and lot tracking, plus its supplier packs and the effective
 * conversions scoped to it. The item and every nested row stay inside the
 * organization; a cross-organization (or unknown) id is a domain failure rather
 * than a silent miss.
 */
export async function getItem(store: MasterDataStore, input: GetItemInput): Promise<ItemDetail> {
  const item = await store.findCatalogItem(input.itemId);
  if (item === undefined || item.organizationId !== input.organizationId) {
    throw new DomainError("item not found in organization");
  }

  const asOf = input.asOf ?? new Date();
  const [supplierItems, conversions] = await Promise.all([
    store.listSupplierItemsForItem(input.organizationId, input.itemId),
    store.listEffectiveConversions(input.organizationId, asOf, input.itemId),
  ]);

  return { item, supplierItems, conversions };
}
