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
