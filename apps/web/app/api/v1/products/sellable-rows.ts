import type {
  AddonApplicabilityView,
  ProductRecord,
  ProductVariantDetail,
  ProductVariantRecord,
  ProductWithVariants,
  VariantRecipeAssignmentView,
} from "@aquarela/application";
import { PRODUCT_KIND } from "@aquarela/persistence";

/**
 * Pure body parsing and response mapping for the product/variant identity API
 * (`DEC-128`). Kept free of Next, DB and I/O imports so it can be unit-tested
 * directly: the routes do the reads and hand the application records to these
 * mappers, which pick the wire fields explicitly and normalise dates to ISO
 * strings.
 */

const MAX_TEXT = 200;

function readText(body: Record<string, unknown>, key: string, max = MAX_TEXT): string | null {
  const value = body[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

/** Optional trimmed text: absent/null/blank → `null`, an over-long value → `"invalid"`. */
function readOptionalText(
  body: Record<string, unknown>,
  key: string,
  max = MAX_TEXT,
): string | null | "invalid" {
  const value = body[key];
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
  return trimmed.length <= max ? trimmed : "invalid";
}

const DECIMAL = /^[+-]?\d{1,15}(\.\d{1,4})?$/;

/** A `yyyy-mm-dd` date or a full ISO timestamp, or `null` when absent/invalid. */
function readOptionalDate(body: Record<string, unknown>, key: string): Date | null | "invalid" {
  const value = body[key];
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    return "invalid";
  }
  const trimmed = value.trim();
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? new Date(`${trimmed}T00:00:00.000Z`)
    : new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? "invalid" : parsed;
}

/* ------------------------------ register product ---------------------------- */

export interface RegisterProductBody {
  readonly code: string;
  readonly name: string;
  readonly category?: string;
  readonly productKind: string;
}

export type ParsedRegisterProduct =
  { readonly ok: true; readonly input: RegisterProductBody } | { readonly ok: false };

/** Validates a product-registration body; `registerProduct` owns the business rules. */
export function parseRegisterProductBody(
  body: Record<string, unknown> | undefined,
): ParsedRegisterProduct {
  if (body === undefined) {
    return { ok: false };
  }
  const code = readText(body, "code", 60);
  const name = readText(body, "name", 120);
  if (code === null || name === null) {
    return { ok: false };
  }
  const productKind = readText(body, "productKind", 40) ?? "base";
  if (!(PRODUCT_KIND as readonly string[]).includes(productKind)) {
    return { ok: false };
  }
  const category = readOptionalText(body, "category", 120);
  if (category === "invalid") {
    return { ok: false };
  }
  return {
    ok: true,
    input: {
      code,
      name,
      productKind,
      ...(category === null ? {} : { category }),
    },
  };
}

/* ------------------------------ register variant ---------------------------- */

export interface RegisterVariantBody {
  readonly code: string;
  readonly sku: string;
  readonly name: string;
  readonly size?: string;
  readonly finishedGoodItemId?: string;
}

export type ParsedRegisterVariant =
  { readonly ok: true; readonly input: RegisterVariantBody } | { readonly ok: false };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validates a variant-registration body. The finished-good item is optional. */
export function parseRegisterVariantBody(
  body: Record<string, unknown> | undefined,
): ParsedRegisterVariant {
  if (body === undefined) {
    return { ok: false };
  }
  const code = readText(body, "code", 60);
  const sku = readText(body, "sku", 60);
  const name = readText(body, "name", 120);
  if (code === null || sku === null || name === null) {
    return { ok: false };
  }
  const size = readOptionalText(body, "size", 60);
  if (size === "invalid") {
    return { ok: false };
  }
  const finished = readOptionalText(body, "finishedGoodItemId", 64);
  if (finished === "invalid") {
    return { ok: false };
  }
  if (finished !== null && !UUID_PATTERN.test(finished)) {
    return { ok: false };
  }
  return {
    ok: true,
    input: {
      code,
      sku,
      name,
      ...(size === null ? {} : { size }),
      ...(finished === null ? {} : { finishedGoodItemId: finished }),
    },
  };
}

/* -------------------------------- update variant ---------------------------- */

export interface UpdateVariantBody {
  readonly name?: string;
  readonly size?: string | null;
  readonly finishedGoodItemId?: string | null;
}

export type ParsedUpdateVariant =
  { readonly ok: true; readonly input: UpdateVariantBody } | { readonly ok: false };

/**
 * Validates a variant-update body. Only the mutable fields are recognised;
 * `code`/`sku` are immutable. An explicit `null`/`""` clears `size` or the
 * finished-good link; an absent key leaves it unchanged.
 */
export function parseUpdateVariantBody(
  body: Record<string, unknown> | undefined,
): ParsedUpdateVariant {
  if (body === undefined) {
    return { ok: false };
  }
  const input: { name?: string; size?: string | null; finishedGoodItemId?: string | null } = {};
  if (body.name !== undefined) {
    const name = readText(body, "name", 120);
    if (name === null) {
      return { ok: false };
    }
    input.name = name;
  }
  if (body.size !== undefined) {
    const size = readOptionalText(body, "size", 60);
    if (size === "invalid") {
      return { ok: false };
    }
    input.size = size;
  }
  if (body.finishedGoodItemId !== undefined) {
    const finished = readOptionalText(body, "finishedGoodItemId", 64);
    if (finished === "invalid") {
      return { ok: false };
    }
    if (finished !== null && !UUID_PATTERN.test(finished)) {
      return { ok: false };
    }
    input.finishedGoodItemId = finished;
  }
  if (Object.keys(input).length === 0) {
    return { ok: false };
  }
  return { ok: true, input };
}

/* ----------------------------- recipe assignment ---------------------------- */

export interface RecipeAssignmentBody {
  readonly locationId: string;
  readonly recipeVersionId: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
}

export type ParsedRecipeAssignment =
  { readonly ok: true; readonly input: RecipeAssignmentBody } | { readonly ok: false };

/** Validates a recipe-assignment body; the command owns approval/overlap rules. */
export function parseRecipeAssignmentBody(
  body: Record<string, unknown> | undefined,
): ParsedRecipeAssignment {
  if (body === undefined) {
    return { ok: false };
  }
  const locationId = readText(body, "locationId", 64);
  const recipeVersionId = readText(body, "recipeVersionId", 64);
  if (
    locationId === null ||
    !UUID_PATTERN.test(locationId) ||
    recipeVersionId === null ||
    !UUID_PATTERN.test(recipeVersionId)
  ) {
    return { ok: false };
  }
  const effectiveFrom = readOptionalDate(body, "effectiveFrom");
  if (effectiveFrom === null || effectiveFrom === "invalid") {
    return { ok: false };
  }
  const effectiveTo = readOptionalDate(body, "effectiveTo");
  if (effectiveTo === "invalid") {
    return { ok: false };
  }
  if (effectiveTo !== null && effectiveTo.getTime() <= effectiveFrom.getTime()) {
    return { ok: false };
  }
  return {
    ok: true,
    input: { locationId, recipeVersionId, effectiveFrom, effectiveTo },
  };
}

/* ----------------------------- addon applicability -------------------------- */

export interface AddonApplicabilityBody {
  readonly baseProductId: string;
  readonly priceEffect: string | null;
}

export type ParsedAddonApplicability =
  { readonly ok: true; readonly input: AddonApplicabilityBody } | { readonly ok: false };

/**
 * Validates an add-on applicability body; the add-on product comes from the
 * route path and the command owns the org/self rules.
 */
export function parseAddonApplicabilityBody(
  body: Record<string, unknown> | undefined,
): ParsedAddonApplicability {
  if (body === undefined) {
    return { ok: false };
  }
  const baseProductId = readText(body, "baseProductId", 64);
  if (baseProductId === null || !UUID_PATTERN.test(baseProductId)) {
    return { ok: false };
  }
  const priceEffect = readOptionalText(body, "priceEffect", 30);
  if (priceEffect === "invalid" || (priceEffect !== null && !DECIMAL.test(priceEffect))) {
    return { ok: false };
  }
  return { ok: true, input: { baseProductId, priceEffect } };
}

/* ---------------------------------- rows ----------------------------------- */

export interface ProductRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly category: string | null;
  readonly productKind: string;
  readonly activeFrom: string;
  readonly activeTo: string | null;
}

export function toProductRow(record: ProductRecord): ProductRow {
  return {
    id: record.id,
    code: record.code,
    name: record.name,
    category: record.category,
    productKind: record.productKind,
    activeFrom: record.activeFrom,
    activeTo: record.activeTo,
  };
}

export interface ProductVariantRow {
  readonly id: string;
  readonly productId: string;
  readonly code: string;
  readonly sku: string;
  readonly name: string;
  readonly size: string | null;
  readonly finishedGoodItemId: string | null;
  readonly activeFrom: string;
  readonly activeTo: string | null;
}

export function toVariantRow(record: ProductVariantRecord): ProductVariantRow {
  return {
    id: record.id,
    productId: record.productId,
    code: record.code,
    sku: record.sku,
    name: record.name,
    size: record.size,
    finishedGoodItemId: record.finishedGoodItemId,
    activeFrom: record.activeFrom,
    activeTo: record.activeTo,
  };
}

export interface ProductWithVariantsRow {
  readonly product: ProductRow;
  readonly variants: readonly ProductVariantRow[];
}

export function toProductWithVariantsRow(record: ProductWithVariants): ProductWithVariantsRow {
  return {
    product: toProductRow(record.product),
    variants: record.variants.map(toVariantRow),
  };
}

export interface VariantRecipeAssignmentRow {
  readonly id: string;
  readonly locationId: string;
  readonly locationCode: string;
  readonly locationName: string;
  readonly recipeVersionId: string;
  readonly recipeVersionNo: number;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}

export function toVariantAssignmentRow(
  record: VariantRecipeAssignmentView,
): VariantRecipeAssignmentRow {
  return {
    id: record.id,
    locationId: record.locationId,
    locationCode: record.locationCode,
    locationName: record.locationName,
    recipeVersionId: record.recipeVersionId,
    recipeVersionNo: record.recipeVersionNo,
    effectiveFrom: record.effectiveFrom.toISOString(),
    effectiveTo: record.effectiveTo === null ? null : record.effectiveTo.toISOString(),
  };
}

export interface AddonApplicabilityRow {
  readonly id: string;
  readonly addon: { readonly id: string; readonly code: string; readonly name: string };
  readonly base: { readonly id: string; readonly code: string; readonly name: string };
  readonly priceEffect: string | null;
  readonly activeFrom: string;
  readonly activeTo: string | null;
}

export function toAddonApplicabilityRow(record: AddonApplicabilityView): AddonApplicabilityRow {
  return {
    id: record.id,
    addon: record.addon,
    base: record.base,
    priceEffect: record.priceEffect,
    activeFrom: record.activeFrom,
    activeTo: record.activeTo,
  };
}

export interface VariantDetailRow {
  readonly variant: ProductVariantRow;
  readonly product: { readonly id: string; readonly code: string; readonly name: string };
  readonly recipeAssignments: readonly VariantRecipeAssignmentRow[];
  readonly addonApplicability: readonly AddonApplicabilityRow[];
}

export function toVariantDetailRow(record: ProductVariantDetail): VariantDetailRow {
  return {
    variant: toVariantRow(record.variant),
    product: record.product,
    recipeAssignments: record.recipeAssignments.map(toVariantAssignmentRow),
    addonApplicability: record.addonApplicability.map(toAddonApplicabilityRow),
  };
}
