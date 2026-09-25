import { DomainError } from "@aquarela/domain";

import type { ChannelListRecord, CostingReadStore } from "./read-types";

/** Page size when the caller does not ask for one. */
export const DEFAULT_CHANNEL_LIMIT = 50;
/** Hard cap so a caller cannot ask the store for the whole register in one page. */
export const MAX_CHANNEL_LIMIT = 200;

export interface ListChannelsQuery {
  readonly organizationId: string;
  /** Absent = every channel; present = delivery (`true`) or in-store (`false`) only. */
  readonly isDelivery?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * The organization's sales channels (`DATA_DICTIONARY` §1), ordered by `code`
 * (then `id`), with an optional delivery/in-store filter. The organization filter
 * is never optional, so a caller cannot read another tenant's channels
 * (`DEC-061`); `limit` defaults to `DEFAULT_CHANNEL_LIMIT` and is validated
 * against `MAX_CHANNEL_LIMIT` so a caller cannot request the whole register
 * unbounded. Cross-organization rows are dropped as defence in depth on top of
 * the store's own filter.
 */
export async function listChannels(
  store: CostingReadStore,
  query: ListChannelsQuery,
): Promise<readonly ChannelListRecord[]> {
  const limit = query.limit ?? DEFAULT_CHANNEL_LIMIT;
  const offset = query.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CHANNEL_LIMIT) {
    throw new DomainError(`limit must be an integer between 1 and ${MAX_CHANNEL_LIMIT}`);
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new DomainError("offset must be a non-negative integer");
  }

  const rows = await store.listChannels({
    organizationId: query.organizationId,
    ...(query.isDelivery === undefined ? {} : { isDelivery: query.isDelivery }),
    limit,
    offset,
  });
  return rows.filter((channel) => channel.organizationId === query.organizationId);
}
