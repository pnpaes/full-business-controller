import { DomainError } from "@aquarela/domain";

import { isBlank } from "../inventory/validation";

import { FORECAST_AUDIT_ACTIONS, FORECAST_OVERRIDE_ENTITY_TYPE } from "./actions";
import { DAY_PERIOD } from "./compute-forecast-tracking";
import {
  normalizeForecastScope,
  requireSupportedForecastGrain,
  type ForecastScopeInput,
} from "./forecast-scope";
import type { ForecastReadStore } from "./read-types";
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
 *
 * A `snapshotId` is resolved inside the transaction against the caller's
 * organization (`DEC-061`): the FK checks existence only, so an org-scoped read
 * plus the grain check is what stops an override pointing at a foreign
 * organization's snapshot or at a different grain. The period must be a
 * `YYYY-MM-DD` day bucket, checked here rather than trusted from the route.
 */
export async function recordForecastOverride(
  store: ForecastWriteStore & ForecastReadStore,
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
  if (!DAY_PERIOD.test(input.period)) {
    throw new DomainError(`period "${input.period}" is not a day bucket (YYYY-MM-DD)`);
  }
  if (isBlank(input.reason)) {
    throw new DomainError("reason is required: an override must state why");
  }
  const scope = normalizeForecastScope(input);
  const reason = input.reason.trim();
  const snapshotId = input.snapshotId ?? null;

  return store.withTransaction(async (tx) => {
    if (snapshotId !== null) {
      const snapshot = await tx.findForecastSnapshotById({
        organizationId: input.organizationId,
        snapshotId,
      });
      if (snapshot === undefined) {
        throw new DomainError("snapshot not found in organization");
      }
      if (snapshot.grain !== grain) {
        throw new DomainError(
          `override grain "${grain}" does not match the snapshot grain "${snapshot.grain}"`,
        );
      }
    }

    const created = await tx.createForecastOverride({
      organizationId: input.organizationId,
      snapshotId,
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
