import { DomainError } from "@aquarela/domain";

import { isBlank } from "../inventory/validation";

import { FORECAST_AUDIT_ACTIONS, FORECAST_OVERRIDE_ENTITY_TYPE } from "./actions";
import {
  normalizeForecastScope,
  requireSupportedForecastGrain,
  type ForecastScopeInput,
} from "./forecast-scope";
import { isAnalyticsMetric, type AnalyticsMetric, type ForecastGrain } from "./types";
import type { ForecastWriteStore } from "./write-types";

export interface RecordForecastOverrideInput extends ForecastScopeInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly metric: AnalyticsMetric;
  /** Only `day_location` is implemented today (the `DEC-011` ceiling). */
  readonly grain: ForecastGrain;
  /** The grain bucket being overridden (e.g. `2026-09-25`). */
  readonly period: string;
  /** The annotated snapshot; omit/null when the override stands alone. */
  readonly snapshotId?: string | null | undefined;
  /** Mandatory: there is no silent override. */
  readonly reason: string;
}

export interface RecordForecastOverrideResult {
  readonly forecastOverrideId: string;
}

/**
 * Appends one `forecast_override` (`DEC-011`): a human, reasoned annotation of a
 * projected period. The row is append-only (the `0070` trigger rejects
 * UPDATE/DELETE/TRUNCATE), so a correction is a new override, and a reason is
 * mandatory — an unexplained override is refused. It is advisory only; nothing
 * auto-applies it.
 */
export async function recordForecastOverride(
  store: ForecastWriteStore,
  input: RecordForecastOverrideInput,
): Promise<RecordForecastOverrideResult> {
  if (isBlank(input.organizationId)) {
    throw new DomainError("organizationId is required");
  }
  if (isBlank(input.actorId)) {
    throw new DomainError("actorId is required");
  }
  if (!isAnalyticsMetric(input.metric)) {
    throw new DomainError(`unknown analytics metric "${String(input.metric)}"`);
  }
  const grain = requireSupportedForecastGrain(input.grain);
  if (isBlank(input.period)) {
    throw new DomainError("period is required");
  }
  if (isBlank(input.reason)) {
    throw new DomainError("reason is required: an override must state why");
  }
  const scope = normalizeForecastScope(input);
  const reason = input.reason.trim();

  return store.withTransaction(async (tx) => {
    const created = await tx.createForecastOverride({
      organizationId: input.organizationId,
      snapshotId: input.snapshotId ?? null,
      metric: input.metric,
      grain,
      period: input.period,
      locationId: scope.locationId,
      channelId: scope.channelId,
      category: scope.category,
      productVariantId: scope.productVariantId,
      actorId: input.actorId,
      reason,
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: FORECAST_AUDIT_ACTIONS.forecastOverrideRecorded,
      entityType: FORECAST_OVERRIDE_ENTITY_TYPE,
      entityId: created.id,
      reason,
      after: {
        metric: input.metric,
        grain,
        period: input.period,
        snapshot_id: created.snapshotId,
        location_id: scope.locationId,
        channel_id: scope.channelId,
      },
    });

    return { forecastOverrideId: created.id };
  });
}
