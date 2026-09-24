import { DomainError } from "@aquarela/domain";

import type { AuditEventRecord, AuthStore } from "./types";

/** Page size when the caller does not ask for one. */
export const DEFAULT_AUDIT_EVENT_LIMIT = 50;
/** Hard cap so a caller cannot ask the store for the whole register in one page. */
export const MAX_AUDIT_EVENT_LIMIT = 200;

export interface ListAuditEventsQuery {
  readonly organizationId: string;
  readonly entityType?: string;
  readonly entityId?: string;
  readonly action?: string;
  readonly actorId?: string;
  readonly from?: string;
  readonly to?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Audit facts for one organization (`07_SECURITY_AND_NFR.md` §7.3), newest
 * `occurred_at` first, with optional entity/action/actor and time filters. The
 * organization filter is never optional, so a caller cannot read another
 * tenant's audit trail (`DEC-061`); `limit` defaults to
 * `DEFAULT_AUDIT_EVENT_LIMIT` and is validated against `MAX_AUDIT_EVENT_LIMIT`
 * so a caller cannot request the whole register unbounded.
 */
export async function listAuditEvents(
  store: AuthStore,
  query: ListAuditEventsQuery,
): Promise<readonly AuditEventRecord[]> {
  const limit = query.limit ?? DEFAULT_AUDIT_EVENT_LIMIT;
  const offset = query.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_AUDIT_EVENT_LIMIT) {
    throw new DomainError(`limit must be an integer between 1 and ${MAX_AUDIT_EVENT_LIMIT}`);
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new DomainError("offset must be a non-negative integer");
  }

  return store.listAuditEvents({
    organizationId: query.organizationId,
    ...(query.entityType === undefined ? {} : { entityType: query.entityType }),
    ...(query.entityId === undefined ? {} : { entityId: query.entityId }),
    ...(query.action === undefined ? {} : { action: query.action }),
    ...(query.actorId === undefined ? {} : { actorId: query.actorId }),
    ...(query.from === undefined ? {} : { from: query.from }),
    ...(query.to === undefined ? {} : { to: query.to }),
    limit,
    offset,
  });
}
