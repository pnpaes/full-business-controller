import { DomainError, QUANTITY_SCALE, formatDecimal, parseDecimal } from "@aquarela/domain";
import { CHECK_FREQUENCY, MONITORING_POINT_KIND } from "@aquarela/persistence";

import { isBlank } from "../inventory/validation";

import { HMS_AUDIT_ACTIONS } from "./actions";
import type { HmsStore, MonitoringPointRecord } from "./types";

/** The `kind` vocabulary a point may hold (`MONITORING_POINT_KIND`). */
export const POINT_KINDS: readonly string[] = MONITORING_POINT_KIND;
/** The `check_frequency` vocabulary (`CHECK_FREQUENCY`). */
export const CHECK_FREQUENCIES: readonly string[] = CHECK_FREQUENCY;

export interface RegisterMonitoringPointInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly locationId: string;
  readonly storageAreaId?: string | null;
  readonly code: string;
  readonly name: string;
  /** One of `MONITORING_POINT_KIND`. */
  readonly kind: string;
  /** Free-text measured unit, e.g. `celsius` (no closed vocabulary yet). */
  readonly unit: string;
  /** numeric(19,6); inclusive lower bound. */
  readonly targetMin: string;
  /** numeric(19,6); inclusive upper bound. */
  readonly targetMax: string;
  /** One of `CHECK_FREQUENCY`. */
  readonly checkFrequency: string;
}

/**
 * Registers one monitoring point (`HMS-002`): validates the vocabulary, the
 * target range and the required text, then creates the point and its audit fact
 * in one transaction. The create is organization-scoped through
 * `input.organizationId` (`DEC-061`).
 *
 * `kind`/`check_frequency` and `target_min <= target_max` have database checks
 * too (`monitoring_point_kind_check`,
 * `monitoring_point_check_frequency_check`,
 * `monitoring_point_target_range_check`), but they are enforced here so the
 * fake-store unit suite and the API see one error class (`DomainError`) with a
 * readable message rather than a driver constraint violation.
 */
export async function registerMonitoringPoint(
  store: HmsStore,
  input: RegisterMonitoringPointInput,
): Promise<MonitoringPointRecord> {
  if (isBlank(input.code)) {
    throw new DomainError("code is required");
  }
  if (isBlank(input.name)) {
    throw new DomainError("name is required");
  }
  if (isBlank(input.unit)) {
    throw new DomainError("unit is required");
  }
  if (!POINT_KINDS.includes(input.kind)) {
    throw new DomainError(`kind must be one of ${POINT_KINDS.join(", ")}`);
  }
  if (!CHECK_FREQUENCIES.includes(input.checkFrequency)) {
    throw new DomainError(`checkFrequency must be one of ${CHECK_FREQUENCIES.join(", ")}`);
  }
  const targetMin = parseDecimal(input.targetMin, QUANTITY_SCALE);
  const targetMax = parseDecimal(input.targetMax, QUANTITY_SCALE);
  if (targetMin > targetMax) {
    throw new DomainError("targetMin must not be greater than targetMax");
  }

  return store.withTransaction(async (tx) => {
    const point = await tx.createMonitoringPoint({
      organizationId: input.organizationId,
      locationId: input.locationId,
      storageAreaId: input.storageAreaId ?? null,
      code: input.code.trim(),
      name: input.name.trim(),
      kind: input.kind,
      unit: input.unit.trim(),
      targetMin: formatDecimal(targetMin, QUANTITY_SCALE),
      targetMax: formatDecimal(targetMax, QUANTITY_SCALE),
      checkFrequency: input.checkFrequency,
      createdBy: input.actorId,
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: HMS_AUDIT_ACTIONS.monitoringPointCreated,
      entityType: "monitoring_point",
      entityId: point.id,
      after: {
        code: point.code,
        name: point.name,
        kind: point.kind,
        unit: point.unit,
        target_min: point.targetMin,
        target_max: point.targetMax,
        check_frequency: point.checkFrequency,
        location_id: point.locationId,
        storage_area_id: point.storageAreaId,
      },
    });

    return point;
  });
}
