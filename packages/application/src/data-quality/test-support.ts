import { randomUUID } from "node:crypto";

import type { DataQualityExceptionRecord, NewDataQualityExceptionRecord } from "./types";

export function createFakeDataQualityException(
  store: Map<string, DataQualityExceptionRecord>,
  input: NewDataQualityExceptionRecord,
): Promise<DataQualityExceptionRecord> {
  const record: DataQualityExceptionRecord = {
    id: randomUUID(),
    organizationId: input.organizationId,
    ruleCode: input.ruleCode,
    severity: input.severity,
    entityType: input.entityType,
    entityId: input.entityId,
    detectedAt: input.detectedAt,
    ownerId: input.ownerId ?? null,
    dueDate: input.dueDate ?? null,
    status: input.status,
    resolution: input.resolution ?? null,
  };
  store.set(record.id, record);
  return Promise.resolve(record);
}
