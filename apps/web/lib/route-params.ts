import { notFound } from "next/navigation";

/**
 * Canonical 8-4-4-4-12 hex UUID. The version/variant nibbles are intentionally
 * not constrained, so any UUID form (v1–v8, any variant) validates; only the
 * shape and the hex alphabet are enforced.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Returns the trimmed value when it is a UUID; otherwise renders the 404 page.
 *
 * Route params come straight from the URL and an unvalidated id must never
 * reach the database: passing `notauuid` into a Postgres `uuid` comparison
 * raises a driver error and turns the page into a 500. Validating here keeps
 * malformed ids on the 404 path, while a well-formed but unknown id still falls
 * through to the caller's existing `notFound()`.
 */
export function uuidOrNotFound(value: string): string {
  const candidate = value.trim();
  if (!UUID.test(candidate)) {
    notFound();
  }
  return candidate;
}
