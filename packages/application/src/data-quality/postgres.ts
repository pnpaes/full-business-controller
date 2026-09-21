import * as repo from "@aquarela/persistence";
import type { Database } from "@aquarela/persistence";

import type { DataQualityExceptionRecord, NewDataQualityExceptionRecord } from "./types";

function toDataQualityException(row: repo.DataQualityException): DataQualityExceptionRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    ruleCode: row.ruleCode,
    severity: row.severity,
    entityType: row.entityType,
    entityId: row.entityId,
    detectedAt: row.detectedAt.toISOString(),
    ownerId: row.ownerId,
    dueDate: row.dueDate,
    status: row.status,
    resolution: row.resolution,
  };
}

export async function createPostgresDataQualityException(
  db: Database,
  input: NewDataQualityExceptionRecord,
): Promise<DataQualityExceptionRecord> {
  return toDataQualityException(
    await repo.createDataQualityException(db, {
      organizationId: input.organizationId,
      ruleCode: input.ruleCode,
      severity: input.severity,
      entityType: input.entityType,
      entityId: input.entityId,
      detectedAt: new Date(input.detectedAt),
      status: input.status,
      ...(input.resolution === undefined ? {} : { resolution: input.resolution }),
      ...(input.ownerId === undefined ? {} : { ownerId: input.ownerId }),
      ...(input.dueDate === undefined ? {} : { dueDate: input.dueDate }),
      ...(input.createdBy === undefined ? {} : { createdBy: input.createdBy }),
    }),
  );
}
