import { DomainError } from "@aquarela/domain";

import type { CatalogItemRecord, MasterDataStore } from "./types";

/** Default page size when the caller does not pin one. */
export const DEFAULT_ITEMS_LIMIT = 50;
/** Hard cap so a caller cannot ask the store for the whole catalog in one page. */
export const MAX_ITEMS_LIMIT = 200;

export interface ListItemsInput {
  readonly organizationId: string;
  /** Case-insensitive contains match over code, SKU and name. */
  readonly search?: string;
  readonly itemType?: string;
  /** `DEC-150`: restrict to one purpose (`for_sale`/`for_use`). */
  readonly purpose?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface ListItemsResult {
  readonly items: readonly CatalogItemRecord[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

function assertPage(limit: number, offset: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ITEMS_LIMIT) {
    throw new DomainError(`limit must be an integer between 1 and ${MAX_ITEMS_LIMIT}`);
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new DomainError("offset must be a non-negative integer");
  }
}

/**
 * One page of the served organization's items (08_UI_UX.md §8.3), ordered by
 * `code`. `limit`/`offset` are validated here so a malformed page never reaches
 * the store; the store reports the total matching count so the caller can page.
 */
export async function listItems(
  store: MasterDataStore,
  input: ListItemsInput,
): Promise<ListItemsResult> {
  const limit = input.limit ?? DEFAULT_ITEMS_LIMIT;
  const offset = input.offset ?? 0;
  assertPage(limit, offset);

  const search = input.search?.trim();
  const page = await store.listItems({
    organizationId: input.organizationId,
    ...(search === undefined || search.length === 0 ? {} : { search }),
    ...(input.itemType === undefined || input.itemType.length === 0
      ? {}
      : { itemType: input.itemType }),
    ...(input.purpose === undefined || input.purpose.length === 0
      ? {}
      : { purpose: input.purpose }),
    limit,
    offset,
  });

  return { items: page.items, total: page.total, limit, offset };
}
