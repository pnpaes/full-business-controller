import {
  assembleCostCardComposition,
  calculateCostCard,
  createPostgresCostCardCompositionStore,
  createPostgresCostCardStore,
  createPostgresCostingReadStore,
  getCostCardDetail,
  listCostCards,
} from "@aquarela/application";

import { getDb } from "../../../../../lib/db";
import { withMutationGuards } from "../../../../../lib/guards";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { getServerSession } from "../../../../../lib/server-session";
import {
  COST_CARD_READ_ROLES,
  COST_CARD_WRITE_ROLES,
  isCostingAuthorized,
  loadCostingAccess,
} from "../access";
import {
  costCardRefRequest,
  isUuid,
  loadCostingRefs,
  toCostCardDetailView,
  toCostCardRows,
} from "../costing-views";
import { costingLimiters } from "../limiters";
import {
  isPresentNonString,
  isRecord,
  readJsonObject,
  readOptionalString,
  readRequiredString,
} from "../parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Provisional defaults for the card's policy and rule label (DEC-111). */
const DEFAULT_COST_SELECTION_POLICY = "latest_approved_price";
const DEFAULT_RULE_VERSION = "calc-v1";

/**
 * Money/currency body keys. A missing key falls back to the assembler's default
 * (`"0.0000"`, `"NOK"`), but a present non-string value must not silently reach
 * that default: `{"directLaborCost": 2.55}` would otherwise persist `0.0000`.
 */
const STRING_MONEY_FIELDS = [
  "directLaborCost",
  "channelVariableCost",
  "otherVariableCost",
  "allocatedUnitOverhead",
  "currency",
] as const;

/**
 * Read-only cost cards for the served organization (COST-005/008), newest first.
 * Response `{ ok: true, rows }`. Signed out → 401; a role outside the cost-card
 * read set (the matrix gives `front_of_house` None) → 403. Never returns another
 * organization's rows.
 */
export async function GET(): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadCostingAccess(session.userId);
    if (!isCostingAuthorized(access, COST_CARD_READ_ROLES)) {
      return jsonError(403);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresCostingReadStore(getDb().db);
    const cards = await listCostCards(store, { organizationId });
    const refs = await loadCostingRefs(store, {
      productVariantIds: cards.map((card) => card.productVariantId),
      locationIds: cards.map((card) => card.locationId),
      channelIds: cards.flatMap((card) => (card.channelId === null ? [] : [card.channelId])),
    });

    return jsonOk({ rows: toCostCardRows(organizationId, cards, refs) });
  });
}

/**
 * Assembles a cost-card composition from the effective recipe assignment, the
 * recipe cost and the effective price version (DEC-111), then calculates and
 * freezes the cost card through `calculateCostCard`. The four component costs
 * with no resolver are explicit, validated body inputs. The organization and
 * actor come from the session, never the body; `withMutationGuards` applies the
 * same-origin check and the per-IP throttle, and a `DomainError` maps to 400.
 *
 * Guard order is session → role → parse (the payroll-reports precedent): the
 * role-only check runs before the body is read, and the location scope is then
 * enforced once `locationId` has been parsed.
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, costingLimiters.calculateCostCard, async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }

    const access = await loadCostingAccess(session.userId);
    if (!isCostingAuthorized(access, COST_CARD_WRITE_ROLES)) {
      return jsonError(403);
    }

    const body = await readJsonObject(request);
    if (body === undefined) {
      return jsonError(400);
    }

    const productVariantId = readRequiredString(body, "productVariantId");
    const locationId = readRequiredString(body, "locationId");
    const asOfRaw = readRequiredString(body, "asOf");
    if (productVariantId === undefined || locationId === undefined || asOfRaw === undefined) {
      return jsonError(400);
    }
    if (!isUuid(productVariantId) || !isUuid(locationId)) {
      return jsonError(400);
    }
    // A location-scoped caller must hold the body's location.
    if (!isCostingAuthorized(access, COST_CARD_WRITE_ROLES, locationId)) {
      return jsonError(403);
    }
    const asOf = new Date(asOfRaw);
    if (Number.isNaN(asOf.getTime())) {
      return jsonError(400);
    }

    const channelId = readOptionalString(body, "channelId");
    const recipeVersionId = readOptionalString(body, "recipeVersionId");
    const fxRateId = readOptionalString(body, "fxRateId");
    if (
      (channelId !== undefined && !isUuid(channelId)) ||
      (recipeVersionId !== undefined && !isUuid(recipeVersionId)) ||
      (fxRateId !== undefined && !isUuid(fxRateId))
    ) {
      return jsonError(400);
    }

    // A money/currency key that is present but not a string must not fall back
    // to its default (F2): reject rather than persist a wrong financial fact.
    if (STRING_MONEY_FIELDS.some((key) => isPresentNonString(body, key))) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const db = getDb().db;
    const compositionStore = createPostgresCostCardCompositionStore(db);

    const currency = readOptionalString(body, "currency");
    const directLaborCost = readOptionalString(body, "directLaborCost");
    const channelVariableCost = readOptionalString(body, "channelVariableCost");
    const otherVariableCost = readOptionalString(body, "otherVariableCost");
    const allocatedUnitOverhead = readOptionalString(body, "allocatedUnitOverhead");
    // Optional jsonb metadata: absent is fine, present-but-not-an-object is a 400.
    if (
      (body["taxRuleSnapshot"] !== undefined && !isRecord(body["taxRuleSnapshot"])) ||
      (body["roundingScales"] !== undefined && !isRecord(body["roundingScales"]))
    ) {
      return jsonError(400);
    }
    const taxRuleSnapshot = isRecord(body["taxRuleSnapshot"]) ? body["taxRuleSnapshot"] : undefined;
    const roundingScales = isRecord(body["roundingScales"]) ? body["roundingScales"] : undefined;

    const assembled = await assembleCostCardComposition(compositionStore, {
      organizationId,
      productVariantId,
      locationId,
      channelId: channelId ?? null,
      recipeVersionId: recipeVersionId ?? null,
      asOf,
      ...(currency === undefined ? {} : { currency }),
      ...(directLaborCost === undefined ? {} : { directLaborCost }),
      ...(channelVariableCost === undefined ? {} : { channelVariableCost }),
      ...(otherVariableCost === undefined ? {} : { otherVariableCost }),
      ...(allocatedUnitOverhead === undefined ? {} : { allocatedUnitOverhead }),
      ...(taxRuleSnapshot === undefined ? {} : { taxRuleSnapshot }),
      ...(fxRateId === undefined ? {} : { fxRateId }),
      ...(roundingScales === undefined ? {} : { roundingScales }),
    });

    const writeStore = createPostgresCostCardStore(db);
    const result = await calculateCostCard(writeStore, {
      organizationId,
      actorId: session.userId,
      productVariantId,
      locationId,
      channelId: channelId ?? null,
      recipeVersionId: assembled.recipeVersionId,
      costSelectionPolicy:
        readOptionalString(body, "costSelectionPolicy") ?? DEFAULT_COST_SELECTION_POLICY,
      asOf,
      ruleVersion: readOptionalString(body, "ruleVersion") ?? DEFAULT_RULE_VERSION,
      composition: assembled.composition,
      components: assembled.components,
      ...assembled.snapshotOptions,
    });

    const readStore = createPostgresCostingReadStore(db);
    const detail = await getCostCardDetail(readStore, {
      organizationId,
      costCardId: result.costCardId,
    });
    if (detail === undefined) {
      return jsonError(500);
    }
    const refs = await loadCostingRefs(readStore, costCardRefRequest(detail));

    return jsonOk({
      costCardId: result.costCardId,
      snapshotId: result.snapshotId,
      costCard: toCostCardDetailView(organizationId, detail, refs),
    });
  });
}
