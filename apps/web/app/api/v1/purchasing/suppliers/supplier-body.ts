/**
 * Pure body parsing for the supplier registration route. `registerSupplier`
 * (application) remains the authority on emptiness, code idempotency and the
 * currency default; this module only validates shape.
 */

const MAX_CODE = 60;
const MAX_NAME = 120;
const MAX_TEXT = 200;
const CURRENCY = /^[A-Za-z]{3}$/;

export interface RegisterSupplierInput {
  readonly code: string;
  readonly name: string;
  readonly contact?: string;
  readonly terms?: string;
  readonly currency?: string;
}

export type ParsedRegisterSupplier =
  { readonly ok: true; readonly input: RegisterSupplierInput } | { readonly ok: false };

function readText(body: Record<string, unknown>, key: string, max: number): string | null {
  const value = body[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

function readOptionalText(
  body: Record<string, unknown>,
  key: string,
  max: number,
): string | null | undefined {
  const value = body[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return trimmed.length <= max ? trimmed : null;
}

export function parseRegisterSupplierBody(
  body: Record<string, unknown> | undefined,
): ParsedRegisterSupplier {
  if (body === undefined) {
    return { ok: false };
  }
  const code = readText(body, "code", MAX_CODE);
  const name = readText(body, "name", MAX_NAME);
  if (code === null || name === null) {
    return { ok: false };
  }

  const contact = readOptionalText(body, "contact", MAX_TEXT);
  if (contact === null) {
    return { ok: false };
  }
  const terms = readOptionalText(body, "terms", MAX_TEXT);
  if (terms === null) {
    return { ok: false };
  }
  const currency = readOptionalText(body, "currency", 3);
  if (currency === null || (currency !== undefined && !CURRENCY.test(currency))) {
    return { ok: false };
  }

  return {
    ok: true,
    input: {
      code,
      name,
      ...(contact === undefined ? {} : { contact }),
      ...(terms === undefined ? {} : { terms }),
      ...(currency === undefined ? {} : { currency }),
    },
  };
}
