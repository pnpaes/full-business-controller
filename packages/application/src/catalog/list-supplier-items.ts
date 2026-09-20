import { DomainError } from "@aquarela/domain";

import type { MasterDataStore, SupplierItemDetail } from "./types";

/**
 * The supplier packs registered for one item (PROC-001), with the supplier and
 * pack-unit codes resolved for display. Throws when the item is outside the
 * organization so the read never crosses a tenant boundary; an item with no
 * packs returns an empty list.
 */
export async function listSupplierItems(
  store: MasterDataStore,
  input: { readonly organizationId: string; readonly itemId: string },
): Promise<readonly SupplierItemDetail[]> {
  const item = await store.findCatalogItem(input.itemId);
  if (item === undefined || item.organizationId !== input.organizationId) {
    throw new DomainError("item not found in organization");
  }
  return store.listSupplierItemsForItem(input.organizationId, input.itemId);
}
