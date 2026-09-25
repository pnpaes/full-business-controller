/**
 * Request-body parsing for the costing write endpoints. Kept deliberately
 * permissive: a value that is absent or malformed comes back `undefined` so the
 * route replies 400, and the application command remains the single validator of
 * vocabulary, ranges and cross-entity references.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads a non-empty trimmed string; absent/blank/non-string → undefined. */
export function readRequiredString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/** Reads an optional non-empty trimmed string; absent/blank/non-string → undefined. */
export function readOptionalString(body: Record<string, unknown>, key: string): string | undefined {
  return readRequiredString(body, key);
}

/**
 * True when `key` is present as a string that is empty or whitespace only. A
 * blank optional field is malformed, not authorization to take a default:
 * `effectiveTo: ""` must not silently become open-ended, and `scopeType: ""`
 * must not silently become `company_wide`, so the route rejects it.
 */
export function isPresentBlankString(body: Record<string, unknown>, key: string): boolean {
  return typeof body[key] === "string" && body[key].trim().length === 0;
}

/**
 * True when `key` is present but its value is not a string. The costing money
 * fields default to `"0.0000"` when *absent*, so a present-but-malformed value
 * (a JSON number or bool) must be a 400 rather than silently defaulting.
 */
export function isPresentNonString(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key) && typeof body[key] !== "string";
}

/**
 * True when `key` is present, not `null`, and its value is not a string. An
 * explicit `null` is a legitimate "clear this nullable field" for an optional
 * key (unlike the defaulted money fields), so it is not a malformed value.
 */
export function isPresentNonNullNonString(body: Record<string, unknown>, key: string): boolean {
  return (
    Object.prototype.hasOwnProperty.call(body, key) &&
    body[key] !== null &&
    typeof body[key] !== "string"
  );
}

/** Parses a JSON object body, or undefined when it is not one. */
export async function readJsonObject(
  request: Request,
): Promise<Record<string, unknown> | undefined> {
  try {
    const value: unknown = await request.json();
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
