import {
  createPostgresWasteStore,
  listWasteEvents,
  recordWasteEvent,
  type RecordWasteEventResult,
  type WasteEventPage,
} from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { requireSession } from "../../../../lib/auth";
import { getDb } from "../../../../lib/db";
import { withMutationGuards } from "../../../../lib/guards";
import { jsonError, jsonOk, mapErrors } from "../../../../lib/http";
import { resolveOrganization } from "../../../../lib/organization";
import { readJsonObject } from "../../../../lib/request";
import { getServerSession } from "../../../../lib/server-session";

import { wasteLimiters } from "./limiters";
import { loadWasteRefs } from "./refs";
import { parseRecordWasteBody, parseWasteQuery, toWasteEventRows } from "./waste-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Waste events for the served organization (`WASTE-001`, 08_UI_UX.md §8.3/§8.6).
 *
 * Query: optional `locationId`/`itemId` (UUID), `stage` (a DEC-018 stage), an
 * optional `from`/`to` ISO-instant window and `limit`/`offset` paging. Response:
 * `{ ok: true, limit, offset, hasMore, rows }`. Signed out → 401; a malformed
 * filter → 400.
 */
export async function GET(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }

    const parsed = parseWasteQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresWasteStore(getDb().db);

    let page: WasteEventPage;
    try {
      page = await listWasteEvents(store, { organizationId, ...parsed.query });
    } catch (error) {
      // `listWasteEvents` is the single validator of the ISO window and paging.
      if (error instanceof DomainError) {
        return jsonError(400);
      }
      throw error;
    }

    const refs = await loadWasteRefs(store, page.events);
    return jsonOk({
      limit: page.limit,
      offset: page.offset,
      hasMore: page.hasMore,
      rows: toWasteEventRows(organizationId, page.events, refs),
    });
  });
}

/**
 * Records one waste event: the event and its negative `waste` ledger movement
 * are written in one transaction. The actor is the session user and the
 * organization the served tenant; a command rejection (bad stage, missing
 * reason, both/neither of item and variant, insufficient stock) is a 400.
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, wasteLimiters.recordWaste, async () => {
    const { session } = await requireSession(request);
    const body = await readJsonObject(request);
    const parsed = parseRecordWasteBody(body);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresWasteStore(getDb().db);

    let result: RecordWasteEventResult;
    try {
      result = await recordWasteEvent(store, {
        organizationId,
        actorId: session.userId,
        locationId: parsed.input.locationId,
        storageAreaId: parsed.input.storageAreaId,
        itemId: parsed.input.itemId,
        productVariantId: parsed.input.productVariantId,
        productionBatchId: parsed.input.productionBatchId,
        quantity: parsed.input.quantity,
        stage: parsed.input.stage,
        reasonCode: parsed.input.reasonCode,
        occurredAt: parsed.input.occurredAt ?? new Date().toISOString(),
        correctiveAction: parsed.input.correctiveAction,
        allowNegativeOverride: parsed.input.allowNegativeOverride,
        idempotencyKey: parsed.input.idempotencyKey,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400);
      }
      throw error;
    }

    return jsonOk({
      wasteEventId: result.wasteEventId,
      movementId: result.movementId,
      quantity: result.quantity,
      value: result.value,
      valueMethod: result.valueMethod,
      currency: result.currency,
      replayed: result.replayed,
    });
  });
}
