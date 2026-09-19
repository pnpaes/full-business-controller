/** Safely parses a JSON object body; `undefined` for anything else. */
export async function readJsonObject(
  request: Request,
): Promise<Record<string, unknown> | undefined> {
  try {
    const body: unknown = await request.json();
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return undefined;
    }
    return body as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/**
 * Reads a non-empty string field, rejecting values over `maxLength` (a cheap
 * bound on the Argon2 work an oversized password could request). Bytes are not
 * trimmed: a password's leading/trailing spaces are significant.
 */
export function readString(
  body: Record<string, unknown> | undefined,
  key: string,
  maxLength = 512,
): string | undefined {
  const value = body?.[key];
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    return undefined;
  }
  return value;
}
