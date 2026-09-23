import {
  createPostgresCostingReadStore,
  createPostgresCostingStore,
  registerChannelFeeRule,
} from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { getDb } from "../../../../../lib/db";
import { withMutationGuards } from "../../../../../lib/guards";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { getServerSession } from "../../../../../lib/server-session";
import {
  CHANNEL_FEE_RULE_READ_ROLES,
  CHANNEL_FEE_RULE_WRITE_ROLES,
  isCostingAuthorized,
  loadCostingAccess,
} from "../access";
import {
  isUuid,
  listChannelFeeRules,
  loadCostingRefs,
  toChannelFeeRuleRows,
} from "../costing-views";
import { costingLimiters } from "../limiters";
import {
  isPresentNonNullNonString,
  readJsonObject,
  readOptionalString,
  readRequiredString,
} from "../parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Optional keys whose value must be a string when present: a JSON number or
 * boolean must be a 400 rather than silently dropping the fee component. An
 * explicit `null` stays valid (`taxRuleId: null` clears the tax-rule link).
 */
const OPTIONAL_STRING_FIELDS = ["percentageRate", "fixedAmount", "taxRuleId"] as const;

/**
 * Read-only channel fee rules (`DEC-112`), newest effective window first.
 * Response `{ ok: true, rows }`. Signed out → 401; a role outside the costing
 * read set → 403. Never returns another organization's rows.
 */
export async function GET(): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadCostingAccess(session.userId);
    if (!isCostingAuthorized(access, CHANNEL_FEE_RULE_READ_ROLES)) {
      return jsonError(403);
    }

    const organizationId = resolveOrganization();
    const db = getDb().db;
    const rules = await listChannelFeeRules(db, organizationId);
    const store = createPostgresCostingReadStore(db);
    const refs = await loadCostingRefs(store, {
      channelIds: rules.map((rule) => rule.channelId),
    });

    return jsonOk({ rows: toChannelFeeRuleRows(organizationId, rules, refs) });
  });
}

/**
 * Registers one channel fee rule through the application command (`DEC-112`).
 * The organization and actor come from the session, never the body; the command
 * remains the single validator of the fee-kind/basis vocabulary and the
 * percentage-vs-fixed shape, and a `DomainError` maps to 400.
 *
 * Guard order is session → role → parse (the cost-card precedent): the role
 * check runs before the body is read. Channel fee rules are channel-scoped, not
 * location-scoped, so no location scope check applies.
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, costingLimiters.registerChannelFeeRule, async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }

    const access = await loadCostingAccess(session.userId);
    if (!isCostingAuthorized(access, CHANNEL_FEE_RULE_WRITE_ROLES)) {
      return jsonError(403);
    }

    const body = await readJsonObject(request);
    if (body === undefined) {
      return jsonError(400);
    }

    const channelId = readRequiredString(body, "channelId");
    const feeKind = readRequiredString(body, "feeKind");
    const feeBasis = readRequiredString(body, "feeBasis");
    const effectiveFrom = readRequiredString(body, "effectiveFrom");
    if (
      channelId === undefined ||
      feeKind === undefined ||
      feeBasis === undefined ||
      effectiveFrom === undefined
    ) {
      return jsonError(400);
    }
    if (!isUuid(channelId)) {
      return jsonError(400);
    }

    // A fee field present as a number/boolean must not silently disappear.
    if (OPTIONAL_STRING_FIELDS.some((key) => isPresentNonNullNonString(body, key))) {
      return jsonError(400);
    }

    const taxRuleId = readOptionalString(body, "taxRuleId");
    if (taxRuleId !== undefined && !isUuid(taxRuleId)) {
      return jsonError(400);
    }

    const percentageRate = readOptionalString(body, "percentageRate");
    const fixedAmount = readOptionalString(body, "fixedAmount");
    const organizationId = resolveOrganization();
    const store = createPostgresCostingStore(getDb().db);
    try {
      const result = await registerChannelFeeRule(store, {
        organizationId,
        actorId: session.userId,
        channelId,
        feeKind,
        ...(percentageRate === undefined ? {} : { percentageRate }),
        ...(fixedAmount === undefined ? {} : { fixedAmount }),
        feeBasis,
        taxRuleId: taxRuleId ?? null,
        effectiveFrom,
        effectiveTo: readOptionalString(body, "effectiveTo") ?? null,
      });
      return jsonOk({ channelFeeRuleId: result.channelFeeRuleId });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }
  });
}
