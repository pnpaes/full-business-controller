import { createImportRun, createPostgresImportStore, listImportRuns } from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { requireSession } from "../../../../../lib/auth";
import { getDb } from "../../../../../lib/db";
import { withMutationGuards } from "../../../../../lib/guards";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { readJsonObject } from "../../../../../lib/request";
import { getServerSession } from "../../../../../lib/server-session";

import { parseCreateImportRunBody, parseImportRunListQuery, toImportRunRows } from "../import-rows";
import { importLimiters } from "../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Import runs for the served organization (`SALE-004`), newest first.
 *
 * Query: optional `source` (free text), `status` (import vocabulary),
 * `limit`/`offset`. Response: `{ ok: true, limit, offset, rows }`. Signed out →
 * 401; a malformed filter → 400. Never returns another organization's runs.
 */
export async function GET(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }

    const parsed = parseImportRunListQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresImportStore(getDb().db);
    const summaries = await listImportRuns(store, { organizationId, ...parsed.query });

    return jsonOk({
      limit: parsed.query.limit,
      offset: parsed.query.offset,
      rows: toImportRunRows(organizationId, summaries),
    });
  });
}

/**
 * Registers an uploaded file as a new run in `uploaded` (`SALE-004`, steps 1–2).
 * The actor is the session user and the organization the served tenant.
 *
 * A duplicate `fileHash` within the organization is a replay of an existing file
 * (`05_WORKFLOWS.md` step 8), so the command rejects it and the route returns
 * 400. `fileObjectId` is a plain uuid — no `file` table exists yet.
 * `profileVersion` is optional: the run resolves its `import_profile` by source
 * and takes the profile's version, so a caller value must match it or be omitted;
 * a source with no profile still requires one (`DEC-081`).
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, importLimiters.createRun, async () => {
    const { session } = await requireSession(request);
    const parsed = parseCreateImportRunBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresImportStore(getDb().db);

    let result: { importRunId: string; status: string };
    try {
      result = await createImportRun(store, {
        organizationId,
        actorId: session.userId,
        source: parsed.input.source,
        fileHash: parsed.input.fileHash,
        periodStart: parsed.input.periodStart,
        periodEnd: parsed.input.periodEnd,
        fileObjectId: parsed.input.fileObjectId,
        ...(parsed.input.profileVersion === null
          ? {}
          : { profileVersion: parsed.input.profileVersion }),
        ...(parsed.input.postingPolicy === null
          ? {}
          : { postingPolicy: parsed.input.postingPolicy }),
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(400, error.message);
      }
      throw error;
    }

    return jsonOk({ importRunId: result.importRunId, status: result.status });
  });
}
