/**
 * Pure query parsing for the HMS compliance/evidence export route
 * (`DEC-093`, clarified by `DEC-098`). Kept free of Next, DB and I/O imports so
 * the route does the read and hands the parsed bounds to the application.
 *
 * Shape checks only: `from`/`to` must be full ISO-8601 instants (`timestamptz`
 * shaped, the same convention as the maintenance-log `performedAt` parser) and
 * `from > to` is rejected — both are also validated by `buildComplianceExport`,
 * but rejecting here keeps a malformed or inverted window a 400 without touching
 * the store (the query stays the authority; this does not contradict it).
 */

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** True when `value` is a full ISO-8601 instant (`timestamptz` shaped). */
function isIsoInstant(value: string): boolean {
  return ISO_INSTANT.test(value) && !Number.isNaN(Date.parse(value));
}

export interface ComplianceExportQuery {
  /** Inclusive lower bound; absent → open-ended. */
  readonly from?: string;
  /** Inclusive upper bound; absent → open-ended. */
  readonly to?: string;
}

export type ParsedComplianceExportQuery =
  { readonly ok: true; readonly query: ComplianceExportQuery } | { readonly ok: false };

/** Parses the optional inclusive `from`/`to` instants; rejects a malformed or inverted window. */
export function parseComplianceExportQuery(
  searchParams: URLSearchParams,
): ParsedComplianceExportQuery {
  const rawFrom = searchParams.get("from");
  const rawTo = searchParams.get("to");
  const from = rawFrom === null ? undefined : rawFrom.trim();
  const to = rawTo === null ? undefined : rawTo.trim();
  if (from !== undefined && !isIsoInstant(from)) {
    return { ok: false };
  }
  if (to !== undefined && !isIsoInstant(to)) {
    return { ok: false };
  }
  if (from !== undefined && to !== undefined && Date.parse(from) > Date.parse(to)) {
    return { ok: false };
  }
  return {
    ok: true,
    query: { ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }) },
  };
}
