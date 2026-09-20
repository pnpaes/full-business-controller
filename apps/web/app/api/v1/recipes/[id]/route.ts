import { createPostgresRecipeStore, getRecipe } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { getDb } from "../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { getServerSession } from "../../../../../lib/server-session";

import { parseRecipeDetailQuery } from "../recipe-query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/recipes/[id]` — one recipe with every version (newest first),
 * each version's nested lines and allergen declarations, and a cost preview.
 * Query: `?asOf=<ISO instant>` (default: request time). Signed out → 401;
 * malformed `asOf` → 400; unknown/cross-organization recipe → 404.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const parsed = parseRecipeDetailQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const { id } = await context.params;
    const organizationId = resolveOrganization();
    const store = createPostgresRecipeStore(getDb().db);
    try {
      const detail = await getRecipe(store, {
        organizationId,
        recipeId: id,
        asOf: parsed.query.asOf,
      });
      return jsonOk({
        recipe: detail.recipe,
        versions: detail.versions,
        costPreview: detail.costPreview,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(/not found/i.test(error.message) ? 404 : 400);
      }
      throw error;
    }
  });
}
