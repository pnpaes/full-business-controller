import type {
  GoodsReceiptLineRecord,
  ReceivingItem,
  ReceivingLocationRecord,
  ReceivingStore,
  ReceivingSupplierOption,
  ReceivingUnit,
} from "@aquarela/application";

import type { ReceiptRefs } from "./receipt-http";

/**
 * Loads the display references for one receiving response via the receiving port
 * only (`findSupplier`/`findLocation`/`findItem`/`findUnit` and the option
 * lists), one query per distinct id rather than per row. Shared by the routes and
 * the server screens so both enrich rows identically.
 */

function toMap<T extends { readonly id: string }>(
  records: readonly (T | undefined)[],
): ReadonlyMap<string, T> {
  const map = new Map<string, T>();
  for (const record of records) {
    if (record !== undefined) {
      map.set(record.id, record);
    }
  }
  return map;
}

function distinct(values: Iterable<string>): string[] {
  return [...new Set(values)];
}

export async function loadReceiptRefs(
  store: ReceivingStore,
  organizationId: string,
  lines: readonly GoodsReceiptLineRecord[],
): Promise<ReceiptRefs> {
  const itemIds = distinct(lines.map((line) => line.itemId));
  const unitIds = distinct(lines.map((line) => line.unitId));

  const [suppliers, locations, items, units] = await Promise.all([
    store.listSuppliers(organizationId),
    store.listLocations(organizationId),
    Promise.all(itemIds.map((id) => store.findItem(id))),
    Promise.all(unitIds.map((id) => store.findUnit(id))),
  ]);

  // The lists are already org-scoped; the by-id reads are org-checked in the
  // mapper (`toReceiptRows`/`toReceiptLineRows`).
  const supplierById = new Map<string, ReceivingSupplierOption>(
    suppliers.map((supplier) => [supplier.id, supplier]),
  );
  const locationById = new Map<string, ReceivingLocationRecord>(
    locations.map((location) => [location.id, location]),
  );

  return {
    suppliers: supplierById,
    locations: locationById,
    items: toMap<ReceivingItem>(items),
    units: toMap<ReceivingUnit>(units),
  };
}
