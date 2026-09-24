import { INVENTORY_POLICY, ITEM_TYPE } from "@aquarela/persistence";

/**
 * Pure body parsing for the item registration route. `registerItem`
 * (application) remains the authority on emptiness, code/SKU uniqueness and
 * idempotency; this module only validates shape and vocabulary.
 */

const MAX_TEXT = 200;
const MAX_UNIT_CODE = 40;

export interface RegisterItemInput {
  readonly code: string;
  readonly sku: string;
  readonly name: string;
  readonly itemType: string;
  readonly baseUnitCode: string;
  readonly inventoryPolicy?: string;
  readonly lotTracked?: boolean;
}

export type ParsedRegisterItem =
  { readonly ok: true; readonly input: RegisterItemInput } | { readonly ok: false };

function readText(body: Record<string, unknown>, key: string, max = MAX_TEXT): string | null {
  const value = body[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

/**
 * Validates a registration body. `itemType`/`inventoryPolicy` must be in the
 * persistence vocabulary (the same lists the column checks enforce). The base
 * unit arrives as its organization-unique code; the route resolves it to the
 * unit id, so the form needs no unit picker read model.
 */
export function parseRegisterItemBody(
  body: Record<string, unknown> | undefined,
): ParsedRegisterItem {
  if (body === undefined) {
    return { ok: false };
  }
  const code = readText(body, "code", 60);
  const sku = readText(body, "sku", 60);
  const name = readText(body, "name", 120);
  const baseUnitCode = readText(body, "baseUnitCode", MAX_UNIT_CODE);
  if (code === null || sku === null || name === null || baseUnitCode === null) {
    return { ok: false };
  }
  const itemType = readText(body, "itemType", 40);
  if (itemType === null || !(ITEM_TYPE as readonly string[]).includes(itemType)) {
    return { ok: false };
  }
  let inventoryPolicy: string | undefined;
  const policyRaw = readText(body, "inventoryPolicy", 40);
  if (policyRaw !== null) {
    if (!(INVENTORY_POLICY as readonly string[]).includes(policyRaw)) {
      return { ok: false };
    }
    inventoryPolicy = policyRaw;
  }
  const lotTrackedRaw = body.lotTracked;
  if (lotTrackedRaw !== undefined && typeof lotTrackedRaw !== "boolean") {
    return { ok: false };
  }
  return {
    ok: true,
    input: {
      code,
      sku,
      name,
      itemType,
      baseUnitCode,
      ...(inventoryPolicy === undefined ? {} : { inventoryPolicy }),
      ...(lotTrackedRaw === undefined ? {} : { lotTracked: lotTrackedRaw }),
    },
  };
}

export interface UpdateItemInput {
  readonly name?: string;
  readonly inventoryPolicy?: string;
  readonly lotTracked?: boolean;
}

export type ParsedUpdateItem =
  { readonly ok: true; readonly input: UpdateItemInput } | { readonly ok: false };

/**
 * Validates an item-update body. Only the mutable fields are recognised; an
 * unknown-only or empty body is rejected. `code`/`sku`/`baseUnit`/`itemType`
 * are deliberately not accepted here (they are immutable, `updateItem`).
 */
export function parseUpdateItemBody(body: Record<string, unknown> | undefined): ParsedUpdateItem {
  if (body === undefined) {
    return { ok: false };
  }
  const input: { name?: string; inventoryPolicy?: string; lotTracked?: boolean } = {};
  if (body.name !== undefined) {
    const name = readText(body, "name", 120);
    if (name === null) {
      return { ok: false };
    }
    input.name = name;
  }
  if (body.inventoryPolicy !== undefined) {
    const policy = readText(body, "inventoryPolicy", 40);
    if (policy === null || !(INVENTORY_POLICY as readonly string[]).includes(policy)) {
      return { ok: false };
    }
    input.inventoryPolicy = policy;
  }
  if (body.lotTracked !== undefined) {
    if (typeof body.lotTracked !== "boolean") {
      return { ok: false };
    }
    input.lotTracked = body.lotTracked;
  }
  if (Object.keys(input).length === 0) {
    return { ok: false };
  }
  return { ok: true, input };
}

export interface RegisterSupplierItemInput {
  readonly supplierId: string;
  readonly supplierSku: string;
  readonly packUnitCode: string;
  readonly packToBaseUnitFactor: string;
  readonly minOrderQty?: string;
  readonly leadTimeDays?: number;
  readonly preferred?: boolean;
}

export type ParsedRegisterSupplierItem =
  { readonly ok: true; readonly input: RegisterSupplierItemInput } | { readonly ok: false };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DECIMAL = 30;

/** A non-scientific decimal literal with at most 6 fractional digits. */
const DECIMAL = /^\d{1,12}(\.\d{1,6})?$/;

function readDecimal(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_DECIMAL && DECIMAL.test(trimmed)
    ? trimmed
    : null;
}

/**
 * Validates a supplier-pack registration body. The pack factor and the optional
 * `minOrderQty`/`leadTimeDays` shapes are checked here; their business bounds
 * (`SupplierPack`, positive quantity, non-negative integer days) stay with
 * `registerSupplierItem`.
 */
export function parseRegisterSupplierItemBody(
  body: Record<string, unknown> | undefined,
): ParsedRegisterSupplierItem {
  if (body === undefined) {
    return { ok: false };
  }
  const supplierId = readText(body, "supplierId", 64);
  const supplierSku = readText(body, "supplierSku", 60);
  const packUnitCode = readText(body, "packUnitCode", MAX_UNIT_CODE);
  const packToBaseUnitFactor = readDecimal(body, "packToBaseUnitFactor");
  if (
    supplierId === null ||
    !UUID_PATTERN.test(supplierId) ||
    supplierSku === null ||
    packUnitCode === null ||
    packToBaseUnitFactor === null
  ) {
    return { ok: false };
  }
  let minOrderQty: string | undefined;
  const minOrderRaw = body.minOrderQty;
  if (minOrderRaw !== undefined && minOrderRaw !== null && minOrderRaw !== "") {
    if (typeof minOrderRaw !== "string") {
      return { ok: false };
    }
    const trimmed = minOrderRaw.trim();
    if (trimmed.length === 0 || !DECIMAL.test(trimmed)) {
      return { ok: false };
    }
    minOrderQty = trimmed;
  }
  let leadTimeDays: number | undefined;
  const leadTimeRaw = body.leadTimeDays;
  if (leadTimeRaw !== undefined && leadTimeRaw !== null && leadTimeRaw !== "") {
    if (typeof leadTimeRaw !== "number" || !Number.isInteger(leadTimeRaw) || leadTimeRaw < 0) {
      return { ok: false };
    }
    leadTimeDays = leadTimeRaw;
  }
  const preferredRaw = body.preferred;
  if (preferredRaw !== undefined && typeof preferredRaw !== "boolean") {
    return { ok: false };
  }
  return {
    ok: true,
    input: {
      supplierId,
      supplierSku,
      packUnitCode,
      packToBaseUnitFactor,
      ...(minOrderQty === undefined ? {} : { minOrderQty }),
      ...(leadTimeDays === undefined ? {} : { leadTimeDays }),
      ...(preferredRaw === undefined ? {} : { preferred: preferredRaw === true }),
    },
  };
}
