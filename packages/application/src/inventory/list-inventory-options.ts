import type { InventoryItemRecord, InventoryLocationRecord, InventoryStore } from "./types";

/**
 * Reference option lists for the manual movement form: the stocked items that can
 * receive a movement and the locations a movement can be booked to. Both are
 * org-scoped reads of master data exposed through the inventory port, so the web
 * layer never reaches past its slice. Cross-organization rows are dropped as
 * defence in depth on top of the store's own filter.
 */
export async function listStockedItems(
  store: InventoryStore,
  query: { readonly organizationId: string },
): Promise<readonly InventoryItemRecord[]> {
  const rows = await store.listStockedItems(query);
  return rows.filter((item) => item.organizationId === query.organizationId);
}

export async function listLocations(
  store: InventoryStore,
  query: { readonly organizationId: string },
): Promise<readonly InventoryLocationRecord[]> {
  const rows = await store.listLocations(query);
  return rows.filter((location) => location.organizationId === query.organizationId);
}
