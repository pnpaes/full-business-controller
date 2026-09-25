import {
  MAX_TAX_RULE_LIMIT,
  createPostgresCostingReadStore,
  createPostgresTaxStore,
  createTaxRule,
  listTaxRules,
} from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { getDb } from "../../../../../lib/db";
import { withMutationGuards } from "../../../../../lib/guards";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { getServerSession } from "../../../../../lib/server-session";
import { TAX_RULE_READ_ROLES, isCostingAuthorized, loadCostingAccess } from "../access";
import { isUuid, toTaxRuleRows } from "../costing-views";

import { TAX_RULE_WRITE_ROLES } from "./access";
import { taxRuleLimiters } from "./limiters";
import {
  isPresentBlankString,
  isPresentNonNullNonString,
  readJsonObject,
  readOptionalString,
  readRequiredString,
} from "../parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Optional keys whose value must be a string when present: a JSON number or
 * boolean must be a 400 rather than silently dropping the scope, window or
 * applicability. An explicit `null` stays valid (`effectiveTo: null` is
 * open-ended; `channelId: null` is the table's "no channel scope").
 */
const OPTIONAL_STRING_FIELDS = ["scopeType", "locationId", "channelId", "effectiveTo"] as const;

/**
 * Read-only tax rules (`DATA_DICTIONARY` §1, PRICE-005), ordered by code, one
 * bounded page. Response `{ ok: true, rows }`. Signed out → 401; a role outside
 * the costing read set → 403. Never returns another organization's rows.
 *
 * The picker asks for the read's hard cap rather than the default page: a
 * truncated list would silently hide a valid rule a caller needs to reference.
 */
export async function GET(): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadCostingAccess(session.userId);
    if (!isCostingAuthorized(access, TAX_RULE_READ_ROLES)) {
      return jsonError(403);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresCostingReadStore(getDb().db);
    const rules = await listTaxRules(store, { organizationId, limit: MAX_TAX_RULE_LIMIT });

    return jsonOk({ rows: toTaxRuleRows(organizationId, rules) });
  });
}

/**
 * Creates one effective-dated tax rule through the application command
 * (`PRICE-005`, `DEC-003`/`DEC-022`). The organization and actor come from the
 * session, never the body; the command remains the single validator of the
 * vocabulary, the 6 dp fraction rate, the scope ids, the effective window, the
 * unique code and the overlap, and a `DomainError` maps to 400.
 *
 * Guard order is session → role → parse (the channel-fee-rule precedent).
 * Authoring a rate is configuration, so the write set is owner/admin
 * (`TAX_RULE_WRITE_ROLES`).
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, taxRuleLimiters.createTaxRule, async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }

    const access = await loadCostingAccess(session.userId);
    if (!isCostingAuthorized(access, TAX_RULE_WRITE_ROLES)) {
      return jsonError(403);
    }

    const body = await readJsonObject(request);
    if (body === undefined) {
      return jsonError(400);
    }

    const code = readRequiredString(body, "code");
    const name = readRequiredString(body, "name");
    const ratePct = readRequiredString(body, "ratePct");
    const taxBasis = readRequiredString(body, "taxBasis");
    const taxTreatment = readRequiredString(body, "taxTreatment");
    const appliesTo = readRequiredString(body, "appliesTo");
    const effectiveFrom = readRequiredString(body, "effectiveFrom");
    if (
      code === undefined ||
      name === undefined ||
      ratePct === undefined ||
      taxBasis === undefined ||
      taxTreatment === undefined ||
      appliesTo === undefined ||
      effectiveFrom === undefined
    ) {
      return jsonError(400);
    }

    if (
      OPTIONAL_STRING_FIELDS.some(
        (key) => isPresentNonNullNonString(body, key) || isPresentBlankString(body, key),
      )
    ) {
      return jsonError(400);
    }
    if (
      Object.prototype.hasOwnProperty.call(body, "recoverable") &&
      typeof body.recoverable !== "boolean"
    ) {
      return jsonError(400);
    }
    const scopeType = readOptionalString(body, "scopeType");
    const locationId = readOptionalString(body, "locationId");
    const channelId = readOptionalString(body, "channelId");
    if (
      (locationId !== undefined && !isUuid(locationId)) ||
      (channelId !== undefined && !isUuid(channelId))
    ) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresTaxStore(getDb().db);
    try {
      const result = await createTaxRule(store, {
        organizationId,
        actorId: session.userId,
        code,
        name,
        ratePct,
        taxBasis,
        taxTreatment,
        recoverable: body.recoverable === true,
        appliesTo,
        ...(scopeType === undefined ? {} : { scopeType }),
        locationId: locationId ?? null,
        channelId: channelId ?? null,
        effectiveFrom,
        effectiveTo: readOptionalString(body, "effectiveTo") ?? null,
      });
      return jsonOk({ taxRuleId: result.taxRuleId });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }
  });
}
