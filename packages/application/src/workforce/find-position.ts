import { isBlank } from "../inventory/validation";

import type { PositionRecord, WorkforceStore } from "./types";

export interface FindPositionQuery {
  readonly organizationId: string;
  readonly positionId: string;
}

/**
 * One position by id (`DEC-151`), organization-scoped (`DEC-061`); `undefined`
 * for a missing or cross-organization id.
 */
export async function findPosition(
  store: WorkforceStore,
  query: FindPositionQuery,
): Promise<PositionRecord | undefined> {
  if (isBlank(query.positionId)) {
    return undefined;
  }
  return store.findPosition({
    organizationId: query.organizationId,
    positionId: query.positionId.trim(),
  });
}
