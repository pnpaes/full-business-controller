import {
  DomainError,
  NotFoundError,
  QUANTITY_SCALE,
  formatDecimal,
  parseDecimal,
} from "@aquarela/domain";

import { isBlank } from "../inventory/validation";

import { HMS_AUDIT_ACTIONS } from "./actions";
import { CHECK_FREQUENCIES, POINT_KINDS } from "./register-monitoring-point";
import type { HmsStore, MonitoringPointRecord } from "./types";

export interface UpdateMonitoringPointInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly monitoringPointId: string;
  /** Non-empty; trimmed. Omitted leaves the name unchanged. */
  readonly name?: string;
  /** One of `MONITORING_POINT_KIND`. */
  readonly kind?: string;
  /** Non-empty free-text measured unit; trimmed. */
  readonly unit?: string;
  /** numeric(19,6); inclusive lower bound. */
  readonly targetMin?: string;
  /** numeric(19,6); inclusive upper bound. */
  readonly targetMax?: string;
  /** One of `CHECK_FREQUENCY`. */
  readonly checkFrequency?: string;
  readonly locationId?: string;
  /** `null` clears the optional storage area. */
  readonly storageAreaId?: string | null;
  /** `false` deactivates the point; the stored readings are untouched. */
  readonly active?: boolean;
}

/** Patch field → audit payload key, so `before`/`after` share one shape. */
const AUDIT_FIELDS = {
  name: "name",
  kind: "kind",
  unit: "unit",
  targetMin: "target_min",
  targetMax: "target_max",
  checkFrequency: "check_frequency",
  locationId: "location_id",
  storageAreaId: "storage_area_id",
  active: "active",
} as const;

/**
 * Corrects or retires one monitoring point (`HMS-002`, `DEC-089`). `code` is
 * immutable, so a misconfigured point is fixed by patching `name`, the
 * vocabulary fields, the target bounds, the location/storage area or `active`
 * (`active: false` deactivates it without touching its readings).
 *
 * The point is loaded organization-scoped first (`DEC-061`; a missing or
 * cross-organization id is a typed `NotFoundError`), then the patch is validated
 * exactly like `registerMonitoringPoint`: vocabulary membership for
 * `kind`/`checkFrequency`, non-empty `name`/`unit`, decimal-only normalized
 * bounds at quantity scale and `targetMin <= targetMax` against the merged view
 * (a patch of one bound is checked against the stored other one). The update and
 * its `hms.monitoring_point.updated` audit fact — whose `before`/`after` carry
 * the patched fields — commit or roll back together.
 */
export async function updateMonitoringPoint(
  store: HmsStore,
  input: UpdateMonitoringPointInput,
): Promise<MonitoringPointRecord> {
  if (isBlank(input.monitoringPointId)) {
    throw new DomainError("monitoringPointId is required");
  }

  return store.withTransaction(async (tx) => {
    const point = await tx.findMonitoringPoint({
      organizationId: input.organizationId,
      monitoringPointId: input.monitoringPointId.trim(),
    });
    if (point === undefined) {
      throw new NotFoundError("monitoring point not found in organization");
    }

    const mutable: {
      name?: string;
      kind?: string;
      unit?: string;
      targetMin?: string;
      targetMax?: string;
      checkFrequency?: string;
      locationId?: string;
      storageAreaId?: string | null;
      active?: boolean;
    } = {};

    if (input.name !== undefined) {
      if (isBlank(input.name)) {
        throw new DomainError("name is required");
      }
      mutable.name = input.name.trim();
    }
    if (input.unit !== undefined) {
      if (isBlank(input.unit)) {
        throw new DomainError("unit is required");
      }
      mutable.unit = input.unit.trim();
    }
    if (input.kind !== undefined) {
      if (!POINT_KINDS.includes(input.kind)) {
        throw new DomainError(`kind must be one of ${POINT_KINDS.join(", ")}`);
      }
      mutable.kind = input.kind;
    }
    if (input.checkFrequency !== undefined) {
      if (!CHECK_FREQUENCIES.includes(input.checkFrequency)) {
        throw new DomainError(`checkFrequency must be one of ${CHECK_FREQUENCIES.join(", ")}`);
      }
      mutable.checkFrequency = input.checkFrequency;
    }
    const targetMin = parseDecimal(
      input.targetMin === undefined ? point.targetMin : input.targetMin,
      QUANTITY_SCALE,
    );
    const targetMax = parseDecimal(
      input.targetMax === undefined ? point.targetMax : input.targetMax,
      QUANTITY_SCALE,
    );
    if (targetMin > targetMax) {
      throw new DomainError("targetMin must not be greater than targetMax");
    }
    if (input.targetMin !== undefined) {
      mutable.targetMin = formatDecimal(targetMin, QUANTITY_SCALE);
    }
    if (input.targetMax !== undefined) {
      mutable.targetMax = formatDecimal(targetMax, QUANTITY_SCALE);
    }
    if (input.locationId !== undefined) {
      mutable.locationId = input.locationId;
    }
    if (input.storageAreaId !== undefined) {
      mutable.storageAreaId = input.storageAreaId;
    }
    if (input.active !== undefined) {
      mutable.active = input.active;
    }

    if (Object.keys(mutable).length === 0) {
      throw new DomainError("no updatable fields provided");
    }

    const updated = await tx.updateMonitoringPoint({
      organizationId: input.organizationId,
      monitoringPointId: point.id,
      ...mutable,
    });
    if (updated === undefined) {
      throw new NotFoundError("monitoring point not found in organization");
    }

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const field of Object.keys(AUDIT_FIELDS) as (keyof typeof AUDIT_FIELDS)[]) {
      if (mutable[field] === undefined) continue;
      before[AUDIT_FIELDS[field]] = point[field];
      after[AUDIT_FIELDS[field]] = updated[field];
    }

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: HMS_AUDIT_ACTIONS.monitoringPointUpdated,
      entityType: "monitoring_point",
      entityId: updated.id,
      before,
      after,
    });

    return updated;
  });
}
