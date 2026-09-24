import type { SimulationScenario } from "@aquarela/application";

import { isUuid } from "../hms/hms-rows";

/**
 * Pure body parsing for `POST /api/v1/simulation`. Shape checks only — the
 * application command re-validates and owns the semantics. Kept free of Next,
 * DB and I/O imports so the route does the reads and hands the parsed scenario
 * to the application.
 */

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const DECIMAL = /^[+-]?\d+(?:\.\d+)?$/;
const MAX_TEXT = 200;

function isIsoInstant(value: unknown): value is string {
  return typeof value === "string" && ISO_INSTANT.test(value) && !Number.isNaN(Date.parse(value));
}

/** A decimal string with at most `scale` decimal places (sign allowed). */
function isDecimal(value: unknown, scale: number): value is string {
  if (typeof value !== "string" || !DECIMAL.test(value)) {
    return false;
  }
  const fraction = value.split(".")[1] ?? "";
  return fraction.length <= scale;
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_TEXT;
}

function isUuidValue(value: unknown): value is string {
  return typeof value === "string" && isUuid(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The scenario fields the route adds an organization id to. */
export type ParsedSimulationScenario = Omit<SimulationScenario, "organizationId">;

export type ParsedSimulationBody =
  { readonly ok: true; readonly scenario: ParsedSimulationScenario } | { readonly ok: false };

function readOptionalDecimal(value: unknown, scale: number): string | undefined | "invalid" {
  if (value === undefined || value === null) {
    return undefined;
  }
  return isDecimal(value, scale) ? value : "invalid";
}

export function parseSimulationBody(
  body: Record<string, unknown> | undefined,
): ParsedSimulationBody {
  if (body === undefined) {
    return { ok: false };
  }
  const { asOf, locationId, baseline } = body;
  if (!isIsoInstant(asOf) || !isUuidValue(locationId)) {
    return { ok: false };
  }
  if (!isRecord(baseline)) {
    return { ok: false };
  }
  const { periodFrom, periodTo } = baseline;
  if (
    !isIsoInstant(periodFrom) ||
    !isIsoInstant(periodTo) ||
    Date.parse(periodFrom) > Date.parse(periodTo)
  ) {
    return { ok: false };
  }

  const volumeChangePct = readOptionalDecimal(body["volumeChangePct"], 6);
  const priceChangePct = readOptionalDecimal(body["priceChangePct"], 6);
  const wageChangePct = readOptionalDecimal(body["wageChangePct"], 6);
  if (
    volumeChangePct === "invalid" ||
    priceChangePct === "invalid" ||
    wageChangePct === "invalid"
  ) {
    return { ok: false };
  }

  const menuAdds: { recipeId: string; expectedUnitsPerPeriod: string }[] = [];
  const rawAdds = body["menuAdds"];
  if (rawAdds !== undefined) {
    if (!Array.isArray(rawAdds)) {
      return { ok: false };
    }
    for (const entry of rawAdds) {
      if (!isRecord(entry)) {
        return { ok: false };
      }
      const { recipeId, expectedUnitsPerPeriod } = entry;
      if (!isUuidValue(recipeId) || !isDecimal(expectedUnitsPerPeriod, 6)) {
        return { ok: false };
      }
      menuAdds.push({ recipeId, expectedUnitsPerPeriod });
    }
  }

  const menuRemovals: { recipeId: string }[] = [];
  const rawRemovals = body["menuRemovals"];
  if (rawRemovals !== undefined) {
    if (!Array.isArray(rawRemovals)) {
      return { ok: false };
    }
    for (const entry of rawRemovals) {
      if (!isRecord(entry)) {
        return { ok: false };
      }
      const { recipeId } = entry;
      if (!isUuidValue(recipeId)) {
        return { ok: false };
      }
      menuRemovals.push({ recipeId });
    }
  }

  const headcountChange: {
    roleCode: string;
    countDelta: string;
    hoursPerPeriod: string;
    costCenterId?: string;
  }[] = [];
  const rawHeadcount = body["headcountChange"];
  if (rawHeadcount !== undefined) {
    if (!Array.isArray(rawHeadcount)) {
      return { ok: false };
    }
    for (const entry of rawHeadcount) {
      if (!isRecord(entry)) {
        return { ok: false };
      }
      const { roleCode, countDelta, hoursPerPeriod, costCenterId } = entry;
      if (!isNonEmptyText(roleCode) || !isDecimal(countDelta, 6) || !isDecimal(hoursPerPeriod, 6)) {
        return { ok: false };
      }
      if (costCenterId !== undefined && costCenterId !== null && !isUuidValue(costCenterId)) {
        return { ok: false };
      }
      headcountChange.push({
        roleCode,
        countDelta,
        hoursPerPeriod,
        ...(costCenterId === undefined || costCenterId === null ? {} : { costCenterId }),
      });
    }
  }

  return {
    ok: true,
    scenario: {
      asOf,
      locationId,
      baseline: { periodFrom, periodTo },
      ...(volumeChangePct === undefined ? {} : { volumeChangePct }),
      ...(priceChangePct === undefined ? {} : { priceChangePct }),
      ...(wageChangePct === undefined ? {} : { wageChangePct }),
      ...(menuAdds.length === 0 ? {} : { menuAdds }),
      ...(menuRemovals.length === 0 ? {} : { menuRemovals }),
      ...(headcountChange.length === 0 ? {} : { headcountChange }),
    },
  };
}
