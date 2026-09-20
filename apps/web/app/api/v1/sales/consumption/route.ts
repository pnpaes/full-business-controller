import { createPostgresConsumptionStore, postTheoreticalConsumption } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { requireSession } from "../../../../../lib/auth";
import { getDb } from "../../../../../lib/db";
import { withMutationGuards } from "../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { readJsonObject } from "../../../../../lib/request";
import { salesLimiters } from "../limiters";
import { parsePostTheoreticalConsumptionBody } from "../sales-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Posts the day's **theoretical sale consumption** for one location (`DEC-009`,
 * `SALE-005`): every posted sales line of the day is exploded to its components
 * and posted as negative `sale_consumption` movements at the moving weighted
 * average, through the slice-8 ledger writer (`ADR-0005`).
 *
 * The body must carry the draw `storageAreaId` — there is no WIP/source-draw
 * policy (recorded open point) — and the whole day is one transaction.
 * Idempotency is per `(location, date, sales_line)`, so a retry replays rather
 * than double-posting. A line whose variant has no effective recipe is skipped
 * and reported in `skippedVariantIds`.
 *
 * Recorded, not resolved: the `DEC-009` daily-per-location grain versus a single
 * `sales_line` `source_id` (A1) — the ledger guard validates `source_type
 * 'sales_line'` against `sales_line.id`, so the command posts per line.
 *
 * Signed out → 401; a malformed body → 400; an unknown location/area, a
 * mismatched area/location or an unstocked component → 400 with the authored
 * `DomainError` message.
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, salesLimiters.consumption, async () => {
    const { session } = await requireSession(request);
    const parsed = parsePostTheoreticalConsumptionBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresConsumptionStore(getDb().db);

    let result: {
      locationId: string;
      occurredOn: string;
      salesLineCount: number;
      consumedLineCount: number;
      skippedVariantIds: readonly string[];
      movementIds: readonly string[];
      replayed: boolean;
    };
    try {
      result = await postTheoreticalConsumption(store, {
        organizationId,
        actorId: session.userId,
        locationId: parsed.input.locationId,
        occurredOn: parsed.input.occurredOn,
        storageAreaId: parsed.input.storageAreaId,
        ...(parsed.input.idempotencyKey === null
          ? {}
          : { idempotencyKey: parsed.input.idempotencyKey }),
        allowNegativeOverride: parsed.input.allowNegativeOverride,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }

    return jsonOk({
      locationId: result.locationId,
      occurredOn: result.occurredOn,
      salesLineCount: result.salesLineCount,
      consumedLineCount: result.consumedLineCount,
      skippedVariantIds: result.skippedVariantIds,
      movementIds: result.movementIds,
      replayed: result.replayed,
    });
  });
}
