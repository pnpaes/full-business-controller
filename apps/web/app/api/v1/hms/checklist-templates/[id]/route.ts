import {
  createPostgresHmsStore,
  findChecklistTemplate,
  updateChecklistTemplate,
} from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { requireSession } from "../../../../../../lib/auth";
import { getDb } from "../../../../../../lib/db";
import { withMutationGuards } from "../../../../../../lib/guards";
import { jsonError, jsonOk, mapErrors } from "../../../../../../lib/http";
import { resolveOrganization } from "../../../../../../lib/organization";
import { readJsonObject } from "../../../../../../lib/request";
import { getServerSession } from "../../../../../../lib/server-session";

import {
  HMS_CHECKLIST_TEMPLATE_READ_ROLES,
  HMS_CHECKLIST_TEMPLATE_WRITE_ROLES,
  isHmsAuthorized,
  loadHmsAccess,
} from "../../access";
import {
  isUuid,
  parseUpdateChecklistTemplateBody,
  toChecklistTemplateRow,
} from "../../checklist-rows";
import { hmsLimiters } from "../../limiters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One checklist template by id (`HMS-005`, `DEC-091`, `DEC-096`).
 *
 * Signed out → 401; a role outside the read set → 403; a non-UUID id → 400. The
 * read is organization-scoped, so an unknown or cross-organization id is a 404
 * (`DEC-061`). No location scope applies: a template has no `location_id` — it is
 * an organization-wide definition (`DEC-096`).
 */
export async function GET(
  _request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadHmsAccess(session.userId);
    if (!isHmsAuthorized(access, HMS_CHECKLIST_TEMPLATE_READ_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresHmsStore(getDb().db);
    const template = await findChecklistTemplate(store, { organizationId, templateId: id });
    if (template === undefined) {
      return jsonError(404);
    }

    return jsonOk({ template: toChecklistTemplateRow(organizationId, template) });
  });
}

/**
 * Amends one checklist template (`HMS-005`, `DEC-091`). Editing is the same
 * managed configuration write as creating, so only owner / general_manager /
 * admin may do it (`DEC-096`). `supersedes_id` is immutable — a revision is a new
 * row, not a re-pointing of this one.
 *
 * The body is any subset of `name`, `category`, `frequency`, the `items` array
 * and `active`. A bad vocabulary value, a non-array `items`, a malformed body or
 * a non-UUID id is a 400, as is a command rejection (blank name, no fields). An
 * unknown/cross-organization template is a 404. Templates are organization-wide,
 * so no location scope is applied.
 */
export async function PATCH(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  return withMutationGuards(request, hmsLimiters.updateChecklistTemplate, async () => {
    const { session } = await requireSession(request);
    const access = await loadHmsAccess(session.userId);
    if (!isHmsAuthorized(access, HMS_CHECKLIST_TEMPLATE_WRITE_ROLES)) {
      return jsonError(403);
    }

    const { id } = await context.params;
    if (!isUuid(id)) {
      return jsonError(400);
    }

    const parsed = parseUpdateChecklistTemplateBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresHmsStore(getDb().db);

    let template;
    try {
      template = await updateChecklistTemplate(store, {
        organizationId,
        actorId: session.userId,
        templateId: id,
        ...parsed.input,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(error instanceof NotFoundError ? 404 : 400, error.message);
      }
      throw error;
    }

    return jsonOk({ template: toChecklistTemplateRow(organizationId, template) });
  });
}
