/**
 * Display labels for the integration-source registry (`INTG-001`, `DEC-137`).
 * The stored values are the schema vocabularies
 * (`INTEGRATION_SYSTEM_TYPE` / `INTEGRATION_DIRECTION` / `ALLOWED_OPERATION` /
 * `INTEGRATION_TERMS_STATUS`); these maps only turn them into human copy. An
 * unrecognised value reads as itself rather than masquerading as a known one, so
 * a future vocabulary item stays visible instead of blank.
 */

const SYSTEM_TYPE_LABELS: Readonly<Record<string, string>> = {
  pos: "POS",
  medusa: "Medusa",
  sanity: "Sanity",
  wolt: "Wolt",
  fiken: "Fiken",
  other: "Other",
};

export function systemTypeLabel(value: string): string {
  return SYSTEM_TYPE_LABELS[value] ?? value;
}

const DIRECTION_LABELS: Readonly<Record<string, string>> = {
  read: "Read",
  write: "Write",
  read_write: "Read + write",
};

export function directionLabel(value: string): string {
  return DIRECTION_LABELS[value] ?? value;
}

const ALLOWED_OPERATION_LABELS: Readonly<Record<string, string>> = {
  read: "Read",
  write_price: "Write prices",
  write_menu_product: "Write menu products",
  write_stock: "Write stock",
  write_accounting: "Write accounting",
};

export function allowedOperationLabel(value: string): string {
  return ALLOWED_OPERATION_LABELS[value] ?? value;
}

/** The comma-joined operation labels, or an explicit statement when none are allowed. */
export function allowedOperationsLabel(values: readonly string[]): string {
  return values.length === 0 ? "No operations" : values.map(allowedOperationLabel).join(", ");
}

const TERMS_STATUS_LABELS: Readonly<Record<string, string>> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

export function termsStatusLabel(value: string): string {
  return TERMS_STATUS_LABELS[value] ?? value;
}

/**
 * True for the `write_*` operations the `DEC-015` gate covers. A source may only
 * carry one once its terms are `approved`; the client uses this to warn before
 * posting, and the command/DB remain the authority.
 */
export function isWriteOperation(value: string): boolean {
  return value.startsWith("write_");
}
