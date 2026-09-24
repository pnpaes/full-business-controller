/**
 * Audit action vocabulary for the catalog master-data commands. Values are the
 * `audit_event.action` strings; keeping them here stops a handler from drifting
 * into near-duplicate names.
 */
export const CATALOG_AUDIT_ACTIONS = {
  itemUpdated: "catalog.item.updated",
  supplierRegistered: "catalog.supplier.registered",
  unitConversionRegistered: "catalog.unit_conversion.registered",
} as const;

export type CatalogAuditAction = (typeof CATALOG_AUDIT_ACTIONS)[keyof typeof CATALOG_AUDIT_ACTIONS];
