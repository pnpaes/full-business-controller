import {
  DomainError,
  NotFoundError,
  QUANTITY_SCALE,
  formatDecimal,
  isReadingInRange,
  parseDecimal,
} from "@aquarela/domain";

import { assertIsoInstant, isBlank } from "../inventory/validation";

import { HMS_AUDIT_ACTIONS } from "./actions";
import type { HmsStore, MonitoringReadingRecord } from "./types";

export interface RecordMonitoringReadingInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly monitoringPointId: string;
  /** numeric(19,6). */
  readonly value: string;
  /** ISO instant the measurement was taken at (not the record time). */
  readonly measuredAt: string;
  readonly notes?: string | null;
}

/**
 * Records one monitoring reading (`HMS-002`): loads the point organization-scoped
 * (`DEC-061`; a missing or cross-organization id is a typed `NotFoundError`),
 * derives `inRange` through the domain primitive `isReadingInRange` (bounds
 * inclusive, decimal-only), takes the `unit` from the point and appends the
 * fact with its audit entry in one transaction.
 *
 * The reading is append-only (the `0038` trigger): `value`, `unit`,
 * `measured_at`, `monitoring_point_id` and `organization_id` are immutable and a
 * DELETE is rejected, so this command offers no update path. `recorded_by` is
 * the acting user (a plain uuid — the `app_user` FK is deferred).
 */
export async function recordMonitoringReading(
  store: HmsStore,
  input: RecordMonitoringReadingInput,
): Promise<MonitoringReadingRecord> {
  if (isBlank(input.monitoringPointId)) {
    throw new DomainError("monitoringPointId is required");
  }
  assertIsoInstant(input.measuredAt, "measuredAt");
  const value = parseDecimal(input.value, QUANTITY_SCALE);

  return store.withTransaction(async (tx) => {
    const point = await tx.findMonitoringPoint({
      organizationId: input.organizationId,
      monitoringPointId: input.monitoringPointId.trim(),
    });
    if (point === undefined) {
      throw new NotFoundError("monitoring point not found in organization");
    }

    const storedValue = formatDecimal(value, QUANTITY_SCALE);
    const inRange = isReadingInRange(storedValue, point.targetMin, point.targetMax);
    const reading = await tx.recordMonitoringReading({
      organizationId: input.organizationId,
      monitoringPointId: point.id,
      value: storedValue,
      unit: point.unit,
      measuredAt: input.measuredAt,
      recordedBy: input.actorId,
      inRange,
      notes: input.notes ?? null,
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: HMS_AUDIT_ACTIONS.monitoringReadingRecorded,
      entityType: "monitoring_reading",
      entityId: reading.id,
      after: {
        monitoring_point_id: reading.monitoringPointId,
        value: reading.value,
        unit: reading.unit,
        measured_at: reading.measuredAt,
        in_range: reading.inRange,
      },
    });

    return reading;
  });
}
