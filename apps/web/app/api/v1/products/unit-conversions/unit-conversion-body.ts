/**
 * Pure body parsing for the unit-conversion registration route.
 * `registerUnitConversion` (application) remains the authority on the units
 * differing, the factor bound and the duplicate pair; this module only
 * validates shape.
 */

const MAX_UNIT_CODE = 40;
const MAX_DECIMAL = 30;
/** A non-scientific decimal literal with at most 6 fractional digits. */
const DECIMAL = /^\d{1,12}(\.\d{1,6})?$/;

export interface RegisterUnitConversionInput {
  readonly fromUnitCode: string;
  readonly toUnitCode: string;
  readonly factor: string;
}

export type ParsedRegisterUnitConversion =
  { readonly ok: true; readonly input: RegisterUnitConversionInput } | { readonly ok: false };

function readText(body: Record<string, unknown>, key: string, max: number): string | null {
  const value = body[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

export function parseRegisterUnitConversionBody(
  body: Record<string, unknown> | undefined,
): ParsedRegisterUnitConversion {
  if (body === undefined) {
    return { ok: false };
  }
  const fromUnitCode = readText(body, "fromUnitCode", MAX_UNIT_CODE);
  const toUnitCode = readText(body, "toUnitCode", MAX_UNIT_CODE);
  const factor = readText(body, "factor", MAX_DECIMAL);
  if (fromUnitCode === null || toUnitCode === null || factor === null || !DECIMAL.test(factor)) {
    return { ok: false };
  }
  return { ok: true, input: { fromUnitCode, toUnitCode, factor } };
}
