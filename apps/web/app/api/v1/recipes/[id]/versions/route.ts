import { createPostgresRecipeStore, registerRecipeVersion } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { getDb } from "../../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../lib/request";
import { assertSameOrigin } from "../../../../../../lib/same-origin";
import { getServerSession } from "../../../../../../lib/server-session";

import { parseRegisterVersionBody } from "../../recipe-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/v1/recipes/[id]/versions` — registers a version with its lines and
 * allergen declarations through the existing `registerRecipeVersion` command.
 * Same-origin and session-guarded; the body is shape-checked here and the command
 * owns the domain rules (yield, unit compatibility, sub-recipe cycles, COST-002).
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
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

    const parsed = parseRegisterVersionBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const { id } = await context.params;
    const organizationId = resolveOrganization();
    const store = createPostgresRecipeStore(getDb().db);
    try {
      const result = await registerRecipeVersion(store, {
        organizationId,
        actorId: session.userId,
        recipeId: id,
        ...parsed.value,
      });
      return jsonOk({
        recipeVersionId: result.recipeVersionId,
        yieldRate: result.yieldRate,
        lineCount: result.lineCount,
        allergenCount: result.allergenCount,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(error instanceof NotFoundError ? 404 : 400, error.message);
      }
      throw error;
    }
  });
}
