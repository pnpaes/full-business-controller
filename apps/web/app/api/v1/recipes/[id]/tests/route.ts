import {
  createPostgresRecipeStore,
  listRecipeTests,
  recordRecipeTest,
} from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { getDb } from "../../../../../../lib/db";
import { jsonError, jsonOk, mapErrors } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../lib/request";
import { assertSameOrigin } from "../../../../../../lib/same-origin";
import { getServerSession } from "../../../../../../lib/server-session";

import {
  isUuid,
  parseRecipeTestListQuery,
  parseRecordRecipeTestBody,
  toRecipeTestRow,
} from "../../recipe-test-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/recipes/[id]/tests` — the trials recorded for a recipe, newest
 * tested first, with each trial's tried/resulting version number and state.
 * Query: `?recipeVersionId=<uuid>` to narrow to one version. Signed out → 401;
 * malformed id/query → 400.
 *
 * `DEC-123` clause 6: the recipe routes carry **no `isAuthorizedFor` row** (a
 * recorded gap — the missing recipe access matrix is not invented here), so this
 * route inherits the existing session + same-origin posture of its siblings.
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
    const parsed = parseRecipeTestListQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresRecipeStore(getDb().db);
    try {
      const tests = await listRecipeTests(store, {
        organizationId,
        recipeId: id,
        ...(parsed.query.recipeVersionId === undefined
          ? {}
          : { recipeVersionId: parsed.query.recipeVersionId }),
      });
      return jsonOk({ tests: tests.map(toRecipeTestRow) });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(error instanceof NotFoundError ? 404 : 400, error.message);
      }
      throw error;
    }
  });
}

/**
 * `POST /api/v1/recipes/[id]/tests` — records one append-only trial through
 * `recordRecipeTest`. Same-origin and session-guarded; the body is shape-checked
 * here and the command owns the domain rules (org-scoped version, positive batch
 * size/output, non-negative duration/cost, text trimming).
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

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const parsed = parseRecordRecipeTestBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresRecipeStore(getDb().db);
    try {
      const result = await recordRecipeTest(store, {
        organizationId,
        actorId: session.userId,
        ...parsed.value,
      });
      return jsonOk({ recipeTestId: result.recipeTestId });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(error instanceof NotFoundError ? 404 : 400, error.message);
      }
      throw error;
    }
  });
}
