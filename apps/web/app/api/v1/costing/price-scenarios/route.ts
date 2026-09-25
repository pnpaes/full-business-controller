import {
  calculatePriceScenario,
  createPostgresCostingReadStore,
  createPostgresPriceScenarioStore,
  listPriceScenarios,
  type PriceScenarioFeeInput,
} from "@aquarela/application";
import { TAX_BASES, type TaxBasis } from "@aquarela/domain";

import { getDb } from "../../../../../lib/db";
import { withMutationGuards } from "../../../../../lib/guards";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { getServerSession } from "../../../../../lib/server-session";
import { PRICE_SCENARIO_WRITE_ROLES, isCostingAuthorized, loadCostingAccess } from "../access";
import {
  isUuid,
  loadCostingRefs,
  priceScenarioRefRequest,
  toPriceScenarioRows,
} from "../costing-views";
import { costingLimiters } from "../limiters";
import {
  isPresentNonNullNonString,
  isRecord,
  readJsonObject,
  readOptionalString,
  readRequiredString,
} from "../parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Provisional defaults for the scenario's policy and rule label (DEC-111). */
const DEFAULT_COST_SELECTION_POLICY = "latest_approved_price";
const DEFAULT_RULE_VERSION = "calc-v1";

/**
 * Optional scenario value keys. A missing/null key means "not set", but a
 * present JSON number or boolean must be a 400 rather than silently dropped —
 * these reach a decimal-only calculation, so a bare number can never be
 * coerced.
 */
const OPTIONAL_VALUE_FIELDS = [
  "grossPrice",
  "targetContributionRate",
  "discount",
  "refund",
  "fixedCost",
  "volumeAssumption",
] as const;

function isTaxBasis(value: string): value is TaxBasis {
  return (TAX_BASES as readonly string[]).includes(value);
}

type ParsedChannelFee = PriceScenarioFeeInput | null | "invalid";

/**
 * Parses the optional `channelFee` object. Its two components are required by
 * the command's fee maths, so a partial object is `"invalid"` (a 400) rather
 * than a silently dropped fee; `fixedOrderFeePerUnit` is genuinely optional.
 */
function parseChannelFee(value: unknown): ParsedChannelFee {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isRecord(value) || isPresentNonNullNonString(value, "fixedOrderFeePerUnit")) {
    return "invalid";
  }
  const percentageFeeRate = readRequiredString(value, "percentageFeeRate");
  const feeBasisAmount = readRequiredString(value, "feeBasisAmount");
  if (percentageFeeRate === undefined || feeBasisAmount === undefined) {
    return "invalid";
  }
  const fixedOrderFeePerUnit = readOptionalString(value, "fixedOrderFeePerUnit");
  return {
    percentageFeeRate,
    feeBasisAmount,
    ...(fixedOrderFeePerUnit === undefined ? {} : { fixedOrderFeePerUnit }),
  };
}

/**
 * Read-only price scenarios for the served organization (PRICE-001–005), newest
 * first. Response `{ ok: true, rows }`. Signed out → 401.
 */
export async function GET(): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresCostingReadStore(getDb().db);
    const scenarios = await listPriceScenarios(store, { organizationId });
    const refs = await loadCostingRefs(store, priceScenarioRefRequest(scenarios));

    return jsonOk({ rows: toPriceScenarioRows(organizationId, scenarios, refs) });
  });
}

/**
 * Calculates (proposes) a price scenario through `calculatePriceScenario`
 * (PRICE-001/004) and returns its stored outcome. This creates a `draft`
 * scenario only — approving it is what creates an effective `price_version`
 * (PRICE-002/003), so the UI never creates a version directly. Every money/rate
 * value is a decimal string; the calculation stays in the application/domain
 * layers and nothing is recomputed here.
 *
 * Guard order is session → role → parse (the cost-card precedent): the role-only
 * check runs before the body is read, and the caller's location scope is enforced
 * once `locationId` is parsed. Organization and actor come from the session,
 * never the body; a `DomainError` maps to 400 via `mapErrors`.
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, costingLimiters.calculatePriceScenario, async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }

    const access = await loadCostingAccess(session.userId);
    if (!isCostingAuthorized(access, PRICE_SCENARIO_WRITE_ROLES)) {
      return jsonError(403);
    }

    const body = await readJsonObject(request);
    if (body === undefined) {
      return jsonError(400);
    }

    const productVariantId = readRequiredString(body, "productVariantId");
    const unitVariableCost = readRequiredString(body, "unitVariableCost");
    const taxBasisRaw = readRequiredString(body, "taxBasis");
    const taxRate = readRequiredString(body, "taxRate");
    if (
      productVariantId === undefined ||
      unitVariableCost === undefined ||
      taxBasisRaw === undefined ||
      taxRate === undefined
    ) {
      return jsonError(400);
    }
    if (!isUuid(productVariantId) || !isTaxBasis(taxBasisRaw)) {
      return jsonError(400);
    }

    const locationId = readOptionalString(body, "locationId");
    const channelId = readOptionalString(body, "channelId");
    if (
      (locationId !== undefined && !isUuid(locationId)) ||
      (channelId !== undefined && !isUuid(channelId))
    ) {
      return jsonError(400);
    }
    // A location-scoped caller must hold the location it proposes a price for.
    if (
      locationId !== undefined &&
      !isCostingAuthorized(access, PRICE_SCENARIO_WRITE_ROLES, locationId)
    ) {
      return jsonError(403);
    }

    if (OPTIONAL_VALUE_FIELDS.some((key) => isPresentNonNullNonString(body, key))) {
      return jsonError(400);
    }
    const channelFee = parseChannelFee(body["channelFee"]);
    if (channelFee === "invalid") {
      return jsonError(400);
    }

    const asOfRaw = readOptionalString(body, "asOf");
    const asOf = asOfRaw === undefined ? new Date() : new Date(asOfRaw);
    if (Number.isNaN(asOf.getTime())) {
      return jsonError(400);
    }
    const discount = readOptionalString(body, "discount");
    const refund = readOptionalString(body, "refund");

    const organizationId = resolveOrganization();
    const store = createPostgresPriceScenarioStore(getDb().db);
    const result = await calculatePriceScenario(store, {
      organizationId,
      actorId: session.userId,
      productVariantId,
      locationId: locationId ?? null,
      channelId: channelId ?? null,
      asOf,
      ruleVersion: readOptionalString(body, "ruleVersion") ?? DEFAULT_RULE_VERSION,
      costSelectionPolicy:
        readOptionalString(body, "costSelectionPolicy") ?? DEFAULT_COST_SELECTION_POLICY,
      grossPrice: readOptionalString(body, "grossPrice") ?? null,
      targetContributionRate: readOptionalString(body, "targetContributionRate") ?? null,
      taxBasis: taxBasisRaw,
      taxRate,
      ...(discount === undefined ? {} : { discount }),
      ...(refund === undefined ? {} : { refund }),
      unitVariableCost,
      channelFee,
      fixedCost: readOptionalString(body, "fixedCost") ?? null,
      volumeAssumption: readOptionalString(body, "volumeAssumption") ?? null,
    });

    return jsonOk({
      priceScenarioId: result.priceScenarioId,
      snapshotId: result.snapshotId,
      outcome: result.outcome,
    });
  });
}
