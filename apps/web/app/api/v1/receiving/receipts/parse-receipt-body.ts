import { TAX_BASIS } from "@aquarela/persistence";

/**
 * Structural validation for `POST /api/v1/receiving/receipts`. This is a shape
 * gate only: it rejects malformed types, ids, dates and decimal strings before
 * any transaction opens, then hands the values to `recordGoodsReceipt`, which
 * owns the domain rules (non-negative, accepted ≤ received, tax basis, precision).
 * Splitting the two keeps the command the single source of costing truth.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECIMAL = /^\d{1,13}(\.\d{1,6})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

const MAX_TEXT_LENGTH = 200;
const MAX_LINES = 100;

const TAX_BASES: readonly string[] = TAX_BASIS;

export interface ParsedReceiptLine {
  readonly supplierItemId: string | null;
  readonly itemId: string;
  readonly receivedPackQty: string;
  readonly acceptedPackQty: string;
  readonly rejectedPackQty: string;
  readonly unitId: string;
  readonly packToBaseFactor: string;
  readonly price: string;
  readonly discount: string;
  readonly taxBasis: string;
  readonly recoverableTax?: string;
  readonly allocatedFreight: string;
  readonly importFee: string;
  readonly lotNumber: string | null;
  readonly expiryDate: string | null;
}

export interface ParsedReceiptBody {
  readonly locationId: string;
  readonly supplierId: string | null;
  readonly storeName: string | null;
  readonly deliveryRef: string | null;
  /** ISO instant. */
  readonly receivedAt: string;
  readonly currency?: string;
  readonly lines: readonly ParsedReceiptLine[];
}

export type ParseReceiptBodyResult =
  { readonly ok: true; readonly input: ParsedReceiptBody } | { readonly ok: false };

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

/** A required non-empty, bounded string. */
function requiredString(object: Record<string, unknown>, key: string): string | undefined {
  const value = object[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_TEXT_LENGTH ? trimmed : undefined;
}

/** `null` = absent/null; `"invalid"` = present but not a bounded string. */
function optionalString(object: Record<string, unknown>, key: string): string | null | "invalid" {
  const value = object[key];
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    return "invalid";
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.length <= MAX_TEXT_LENGTH ? trimmed : "invalid";
}

function requiredUuid(object: Record<string, unknown>, key: string): string | undefined {
  const value = requiredString(object, key);
  return value !== undefined && UUID.test(value) ? value : undefined;
}

/** `null` = absent/null; `"invalid"` = present but not a UUID. */
function optionalUuid(object: Record<string, unknown>, key: string): string | null | "invalid" {
  const value = optionalString(object, key);
  if (value === null) {
    return null;
  }
  return value === "invalid" || !UUID.test(value) ? "invalid" : value;
}

/** `null` = absent (caller defaults); `"invalid"` = present but not a decimal. */
function optionalDecimal(object: Record<string, unknown>, key: string): string | null | "invalid" {
  const value = object[key];
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return typeof value === "string" && DECIMAL.test(value) ? value : "invalid";
}

function parseLine(value: unknown): ParsedReceiptLine | undefined {
  const line = asObject(value);
  if (line === undefined) {
    return undefined;
  }
  const supplierItemId = optionalUuid(line, "supplierItemId");
  const itemId = requiredUuid(line, "itemId");
  const unitId = requiredUuid(line, "unitId");
  const receivedPackQty = optionalDecimal(line, "receivedPackQty");
  const acceptedPackQty = optionalDecimal(line, "acceptedPackQty");
  const packToBaseFactor = optionalDecimal(line, "packToBaseFactor");
  const price = optionalDecimal(line, "price");
  const taxBasis = requiredString(line, "taxBasis");
  const lotNumber = optionalString(line, "lotNumber");
  const expiryDate = optionalString(line, "expiryDate");
  if (
    supplierItemId === "invalid" ||
    itemId === undefined ||
    unitId === undefined ||
    receivedPackQty === null ||
    receivedPackQty === "invalid" ||
    acceptedPackQty === null ||
    acceptedPackQty === "invalid" ||
    packToBaseFactor === null ||
    packToBaseFactor === "invalid" ||
    price === null ||
    price === "invalid" ||
    taxBasis === undefined ||
    !TAX_BASES.includes(taxBasis) ||
    lotNumber === "invalid" ||
    expiryDate === "invalid" ||
    (expiryDate !== null && !DATE.test(expiryDate))
  ) {
    return undefined;
  }
  const rejectedPackQty = optionalDecimal(line, "rejectedPackQty");
  const discount = optionalDecimal(line, "discount");
  const allocatedFreight = optionalDecimal(line, "allocatedFreight");
  const importFee = optionalDecimal(line, "importFee");
  const recoverableTax = optionalDecimal(line, "recoverableTax");
  if (
    rejectedPackQty === "invalid" ||
    discount === "invalid" ||
    allocatedFreight === "invalid" ||
    importFee === "invalid" ||
    recoverableTax === "invalid"
  ) {
    return undefined;
  }
  return {
    supplierItemId,
    itemId,
    receivedPackQty,
    acceptedPackQty,
    rejectedPackQty: rejectedPackQty ?? "0",
    unitId,
    packToBaseFactor,
    price,
    discount: discount ?? "0",
    taxBasis,
    ...(recoverableTax === null ? {} : { recoverableTax }),
    allocatedFreight: allocatedFreight ?? "0",
    importFee: importFee ?? "0",
    lotNumber,
    expiryDate,
  };
}

export function parseReceiptBody(body: unknown): ParseReceiptBodyResult {
  const object = asObject(body);
  if (object === undefined) {
    return { ok: false };
  }
  const locationId = requiredUuid(object, "locationId");
  const supplierId = optionalUuid(object, "supplierId");
  const storeName = optionalString(object, "storeName");
  const deliveryRef = optionalString(object, "deliveryRef");
  const currency = optionalString(object, "currency");
  const receivedAt = requiredString(object, "receivedAt");
  if (
    locationId === undefined ||
    supplierId === "invalid" ||
    storeName === "invalid" ||
    deliveryRef === "invalid" ||
    currency === "invalid" ||
    receivedAt === undefined ||
    !ISO_INSTANT.test(receivedAt) ||
    Number.isNaN(Date.parse(receivedAt))
  ) {
    return { ok: false };
  }
  // A purchase is either from a known supplier or a named store (DEC-047); the
  // DB enforces it too, but rejecting here avoids a failed insert.
  if (supplierId === null && storeName === null) {
    return { ok: false };
  }
  if (!Array.isArray(object["lines"])) {
    return { ok: false };
  }
  const rawLines = object["lines"];
  if (rawLines.length === 0 || rawLines.length > MAX_LINES) {
    return { ok: false };
  }
  const lines: ParsedReceiptLine[] = [];
  for (const rawLine of rawLines) {
    const line = parseLine(rawLine);
    if (line === undefined) {
      return { ok: false };
    }
    lines.push(line);
  }
  return {
    ok: true,
    input: {
      locationId,
      supplierId,
      storeName,
      deliveryRef,
      receivedAt,
      ...(currency === null ? {} : { currency }),
      lines,
    },
  };
}
