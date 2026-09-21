import { approvePriceScenario, createPostgresPriceScenarioStore } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { getDb } from "../../../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../../lib/organization";
import { assertSameOrigin } from "../../../../../../../lib/same-origin";
import { getServerSession } from "../../../../../../../lib/server-session";

import { parseApprovePriceScenarioBody, readApprovePriceScenarioBody } from "./body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/v1/costing/price-scenarios/[id]/approve` — approves a `draft` or
 * `submitted` scenario and creates the effective price version for its scope
 * (PRICE-002/003; `DEC-064`). The optional body carries the half-open effective
 * window `{ effectiveFrom?, effectiveTo? }` (instants; `effectiveTo: null` is
 * open-ended). Response `{ ok: true, priceVersionId }`. Signed out → 401;
 * cross-origin → 403; malformed body → 400; unknown/foreign scenario or an
 * illegal state → 400 (404 when the command reports a typed not-found).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    try {
      assertSameOrigin(request);
    } catch {
      return jsonError(403);
    }

    const { id } = await params;
    const body = await readApprovePriceScenarioBody(request);
    if (body === undefined) {
      return jsonError(400);
    }
    const parsed = parseApprovePriceScenarioBody(body);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresPriceScenarioStore(getDb().db);
    try {
      const result = await approvePriceScenario(store, {
        organizationId,
        actorId: session.userId,
        priceScenarioId: id,
        ...(parsed.value.effectiveFrom === undefined
          ? {}
          : { effectiveFrom: parsed.value.effectiveFrom }),
        ...(parsed.value.effectiveTo === undefined
          ? {}
          : { effectiveTo: parsed.value.effectiveTo }),
      });
      return jsonOk({ priceVersionId: result.priceVersionId });
    } catch (error) {
      if (error instanceof NotFoundError) {
        return jsonError(404);
      }
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }
  });
}
