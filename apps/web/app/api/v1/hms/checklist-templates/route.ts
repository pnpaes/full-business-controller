import {
  createPostgresHmsStore,
  listChecklistTemplates,
  registerChecklistTemplate,
} from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { requireSession } from "../../../../../lib/auth";
import { getDb } from "../../../../../lib/db";
import { withMutationGuards } from "../../../../../lib/guards";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { resolveOrganization } from "../../../../../lib/organization";
import { readJsonObject } from "../../../../../lib/request";
import { getServerSession } from "../../../../../lib/server-session";

import {
  HMS_CHECKLIST_TEMPLATE_READ_ROLES,
  HMS_CHECKLIST_TEMPLATE_WRITE_ROLES,
  isHmsAuthorized,
  loadHmsAccess,
} from "../access";
import {
  parseChecklistTemplateListQuery,
  parseCreateChecklistTemplateBody,
  toChecklistTemplateRows,
} from "../checklist-rows";
import { hmsLimiters } from "../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Checklist templates for the served organization (`HMS-005`, `DEC-091`,
 * `DEC-096`), name then id.
 *
 * Query: optional `category`, `active` (`true`/`false`), plus `limit`/`offset`.
 * Response: `{ ok: true, limit, offset, rows }`. Signed out → 401; a role
 * outside the read set (owner / general_manager / location_manager / kitchen /
 * front_of_house / admin / analyst — `purchasing`/`finance` have no access,
 * `DEC-096`) → 403; a malformed filter → 400. Never returns another
 * organization's templates (`DEC-061`).
 *
 * No location scope applies: a `checklist_template` has no `location_id` — it is
 * an organization-wide definition — so this route checks the role only, even for
 * a location-scoped caller (`DEC-096`).
 */
export async function GET(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadHmsAccess(session.userId);
    if (!isHmsAuthorized(access, HMS_CHECKLIST_TEMPLATE_READ_ROLES)) {
      return jsonError(403);
    }

    const parsed = parseChecklistTemplateListQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresHmsStore(getDb().db);
    const templates = await listChecklistTemplates(store, {
      organizationId,
      ...(parsed.query.category === undefined ? {} : { category: parsed.query.category }),
      ...(parsed.query.active === undefined ? {} : { active: parsed.query.active }),
      limit: parsed.query.limit,
      offset: parsed.query.offset,
    });

    return jsonOk({
      limit: parsed.query.limit,
      offset: parsed.query.offset,
      rows: toChecklistTemplateRows(organizationId, templates),
    });
  });
}

/**
 * Registers one checklist template (`HMS-005`, `DEC-091`). The actor is the
 * session user and the organization the served tenant; the template is active by
 * default. Writing a template is a managed configuration change, so only owner /
 * general_manager / admin may do it (`DEC-096`) — kitchen/front_of_house may
 * read but not author, and `analyst`/`purchasing`/`finance` have no write access.
 *
 * The body carries `name`, `category`, `frequency`, the `items` array and an
 * optional `active`/`supersedesId` (the revision link). A bad vocabulary value,
 * a non-array `items` or a malformed body is a 400; a command rejection (blank
 * name or bad item element) is also a 400. Templates are organization-wide, so
 * no location scope is applied — the role is the only check.
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, hmsLimiters.registerChecklistTemplate, async () => {
    const { session } = await requireSession(request);
    const access = await loadHmsAccess(session.userId);
    if (!isHmsAuthorized(access, HMS_CHECKLIST_TEMPLATE_WRITE_ROLES)) {
      return jsonError(403);
    }

    const parsed = parseCreateChecklistTemplateBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresHmsStore(getDb().db);

    let template;
    try {
      template = await registerChecklistTemplate(store, {
        organizationId,
        actorId: session.userId,
        ...parsed.input,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(error instanceof NotFoundError ? 404 : 400, error.message);
      }
      throw error;
    }

    return jsonOk({ templateId: template.id, active: template.active });
  });
}
