import { DomainError } from "@aquarela/domain";
import type { SalesReportGrain } from "@aquarela/domain";

import {
  FORECAST_GRAIN_TO_SALES_REPORT_GRAIN,
  isSupportedForecastGrain,
  type ForecastGrain,
  type ForecastScope,
  type SupportedForecastGrain,
} from "./types";

/**
 * The scope normalisation shared by the two commands and the tracking read, and
 * the `DEC-011` grain ceiling stated in one place.
 *
 * `DEC-011` declared `day_location`, `day_location_category` and
 * `day_location_product`; only `day_location` is implemented, because the
 * reporting read behind `computeForecast` (`summarizeSales`) can scope by
 * location and channel but has no category/product filter. A command for an
 * unimplemented grain is refused with the reason, never stored with a dropped
 * scope dimension.
 */

/** A caller-supplied scope; blank/empty reads as `null` (organization-wide). */
export interface ForecastScopeInput {
  readonly locationId?: string | null | undefined;
  readonly channelId?: string | null | undefined;
  readonly category?: string | null | undefined;
  readonly productVariantId?: string | null | undefined;
}

/** Refuses a grain this slice cannot scope, naming the `DEC-011` ceiling. */
export function requireSupportedForecastGrain(grain: ForecastGrain): SupportedForecastGrain {
  if (!isSupportedForecastGrain(grain)) {
    throw new DomainError(
      `forecast grain "${grain}" is not implemented; only day_location is supported today (DEC-011: the reporting read cannot yet scope by category or product)`,
    );
  }
  return grain;
}

/** The reporting bucket grain a forecast grain maps to (always `day`). */
export function salesReportGrainFor(grain: ForecastGrain): SalesReportGrain {
  return FORECAST_GRAIN_TO_SALES_REPORT_GRAIN[grain];
}

/** `null` for undefined/blank text, otherwise the trimmed-unchanged value. */
function blankToNull(value: string | null | undefined): string | null {
  return value === undefined || value === null || value.trim() === "" ? null : value;
}

/**
 * Normalises and validates a scope for the (supported) `day_location` grain:
 * `category`/`productVariantId` are refused because their grains are not
 * implemented, and a blank `locationId`/`channelId` reads as organization-wide.
 */
export function normalizeForecastScope(input: ForecastScopeInput): ForecastScope {
  const category = blankToNull(input.category);
  const productVariantId = blankToNull(input.productVariantId);
  if (category !== null) {
    throw new DomainError(
      "category is only valid for the day_location_category grain, which is not implemented yet (DEC-011)",
    );
  }
  if (productVariantId !== null) {
    throw new DomainError(
      "productVariantId is only valid for the day_location_product grain, which is not implemented yet (DEC-011)",
    );
  }
  return {
    locationId: blankToNull(input.locationId),
    channelId: blankToNull(input.channelId),
    category: null,
    productVariantId: null,
  };
}
