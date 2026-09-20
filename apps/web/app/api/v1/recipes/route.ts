import { createPostgresRecipeStore, listRecipes, registerRecipe } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { getDb } from "../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../lib/http";
import { resolveOrganization } from "../../../../lib/organization";
import { readJsonObject } from "../../../../lib/request";
import { assertSameOrigin } from "../../../../lib/same-origin";
import { getServerSession } from "../../../../lib/server-session";

import { parseRegisterRecipeBody } from "./recipe-body";
import { parseRecipeListQuery } from "./recipe-query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/recipes` — the recipe list for the served organization, with each
 * recipe's latest version and a cost preview. Query: `?search=`, `?limit=`,
 * `?offset=`. Signed out → 401; malformed query → 400.
 */
export async function GET(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const parsed = parseRecipeListQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresRecipeStore(getDb().db);
    const recipes = await listRecipes(store, { organizationId, ...parsed.query });
    return jsonOk({ recipes });
  });
}

/**
 * `POST /api/v1/recipes` — registers a recipe identity. Same-origin and
 * session-guarded; the body is shape-checked here and the command owns the
 * domain rules (org-scoped duplicate code, output item in organization).
 */
export async function POST(request: Request): Promise<Response> {
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

    const parsed = parseRegisterRecipeBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresRecipeStore(getDb().db);
    try {
      const result = await registerRecipe(store, {
        organizationId,
        actorId: session.userId,
        ...parsed.value,
      });
      return jsonOk({ recipeId: result.recipeId });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }
  });
}
