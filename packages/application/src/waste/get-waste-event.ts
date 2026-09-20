import { DomainError } from "@aquarela/domain";

import { isBlank } from "../inventory/validation";

import type { WasteEventRecord, WasteStore } from "./types";

export interface GetWasteEventQuery {
  readonly organizationId: string;
  readonly wasteEventId: string;
}

/**
 * One waste event, organization-scoped (`DEC-061`), or `undefined` (the read
 * API maps that to 404). Covered by `record-waste-event.test.ts` via the record
 * command's replay path; the list read is the surface most callers use.
 */
export async function getWasteEvent(
  store: WasteStore,
  query: GetWasteEventQuery,
): Promise<WasteEventRecord | undefined> {
  if (isBlank(query.wasteEventId)) {
    throw new DomainError("wasteEventId is required");
  }
  return store.findWasteEvent({
    organizationId: query.organizationId,
    wasteEventId: query.wasteEventId.trim(),
  });
}
