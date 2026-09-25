import { DomainError } from "@aquarela/domain";

import { assertIsoInstant, isBlank } from "../inventory/validation";
import type { ReportingStore } from "../reporting";

import { FORECAST_AUDIT_ACTIONS, FORECAST_SNAPSHOT_ENTITY_TYPE } from "./actions";
import { computeForecast } from "./forecast";
import {
  normalizeForecastScope,
  requireSupportedForecastGrain,
  salesReportGrainFor,
  type ForecastScopeInput,
} from "./forecast-scope";
import { isAnalyticsMetric, type AnalyticsMetric, type ForecastGrain } from "./types";
import type { ForecastWriteStore } from "./write-types";

export interface RecordForecastSnapshotInput extends ForecastScopeInput {
  readonly organizationId: string;
  readonly actorId: string;
  readonly metric: AnalyticsMetric;
  /** Only `day_location` is implemented today (the `DEC-011` ceiling). */
  readonly grain: ForecastGrain;
  readonly historyPeriods?: number | undefined;
  readonly horizonPeriods?: number | undefined;
  /** The window anchor; an ISO instant. Defaults to the current instant. */
  readonly now?: string | undefined;
}

export interface RecordForecastSnapshotResult {
  readonly forecastSnapshotId: string;
}

/**
 * Records the current `computeForecast` output as a `forecast_snapshot`
 * (`DEC-011`). The forecast is computed first (it is a read over the existing
 * reporting reads), then the snapshot and its audit fact are written in one
 * transaction. An `insufficient_history` forecast is **refused**: there is no
 * projection to track, and recording one would fabricate history — the honest
 * state is the caller re-running once enough history exists.
 */
export async function recordForecastSnapshot(
  store: ForecastWriteStore & ReportingStore,
  input: RecordForecastSnapshotInput,
): Promise<RecordForecastSnapshotResult> {
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
  const scope = normalizeForecastScope(input);
  if (input.now !== undefined) {
    assertIsoInstant(input.now, "now");
  }

  const forecast = await computeForecast(store, {
    organizationId: input.organizationId,
    metric: input.metric,
    grain: salesReportGrainFor(grain),
    ...(scope.locationId === null ? {} : { locationIds: [scope.locationId] }),
    ...(scope.channelId === null ? {} : { channelId: scope.channelId }),
    ...(input.historyPeriods === undefined ? {} : { historyPeriods: input.historyPeriods }),
    ...(input.horizonPeriods === undefined ? {} : { horizonPeriods: input.horizonPeriods }),
    ...(input.now === undefined ? {} : { now: input.now }),
  });

  if (forecast.status !== "ok" || forecast.model === null) {
    throw new DomainError(
      `cannot record a forecast snapshot: ${
        forecast.insufficient?.reason ?? "the forecast produced no model"
      }`,
    );
  }
  const model = forecast.model;

  return store.withTransaction(async (tx) => {
    const created = await tx.createForecastSnapshot({
      organizationId: input.organizationId,
      metric: input.metric,
      grain,
      locationId: scope.locationId,
      channelId: scope.channelId,
      category: scope.category,
      productVariantId: scope.productVariantId,
      asOf: forecast.asOf,
      model: model.method,
      projection: forecast.projection,
      accuracyMethod: forecast.accuracy?.method ?? null,
      accuracyMape: forecast.accuracy?.mape ?? null,
      accuracyPoints: forecast.accuracy?.points ?? null,
      actorId: input.actorId,
    });

    await tx.writeAudit({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: FORECAST_AUDIT_ACTIONS.forecastSnapshotRecorded,
      entityType: FORECAST_SNAPSHOT_ENTITY_TYPE,
      entityId: created.id,
      after: {
        metric: input.metric,
        grain,
        location_id: scope.locationId,
        channel_id: scope.channelId,
        as_of: forecast.asOf,
        model: model.method,
        projection_count: forecast.projection.length,
        accuracy_mape: forecast.accuracy?.mape ?? null,
      },
    });

    return { forecastSnapshotId: created.id };
  });
}
