import {
  createPostgresInventoryStore,
  listLocations,
  replaceLocationScopes,
} from "@aquarela/application";
import { DomainError } from "@aquarela/domain";

import { getDb } from "../../../../../../../lib/db";
import { jsonError, jsonOk } from "../../../../../../../lib/http";
import { readJsonObject } from "../../../../../../../lib/request";

import { administrationLimiters } from "../../../limiters";
import { parseLocationScopesBody } from "../../../admin-rows";
import { withUserMutation } from "../../../user-mutations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Replaces one user's whole location scope (`07_SECURITY_AND_NFR.md` §7.1
 * "Users/configuration"). Body: `{ locationIds: string[] }` (uuid ids; `[]`
 * clears the scope). Unlike a role or status change this does **not** revoke
 * sessions: authorization is loaded live per request, so the new scope applies on
 * the user's next request without signing them out.
 *
 * Gated on the live `ADMIN_USERS_ROLES` (owner / admin). A non-UUID id or a
 * malformed scope body → 400; an unknown or cross-organization user → 404. Each
 * submitted id is checked against the organization's real locations first, so an
 * id that does not exist is a 400 naming it rather than a foreign-key fault.
 */
export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return withUserMutation(
    request,
    administrationLimiters.replaceLocationScopes,
    id,
    async ({ session, store, organizationId, userId }) => {
      const parsed = parseLocationScopesBody(await readJsonObject(request));
      if (!parsed.ok) {
        return jsonError(400);
      }

      const locations = await listLocations(createPostgresInventoryStore(getDb().db), {
        organizationId,
      });
      const knownIds = new Set(locations.map((location) => location.id));
      const unknownIds = parsed.locationIds.filter((locationId) => !knownIds.has(locationId));
      if (unknownIds.length > 0) {
        return jsonError(
          400,
          `Unknown location id${unknownIds.length === 1 ? "" : "s"}: ${unknownIds.join(", ")}`,
        );
      }

      try {
        await replaceLocationScopes(store, {
          organizationId,
          userId,
          locationIds: parsed.locationIds,
          actorId: session.userId,
        });
      } catch (error) {
        if (error instanceof DomainError) {
          return jsonError(400, error.message);
        }
        throw error;
      }

      return jsonOk({ userId, locationIds: parsed.locationIds });
    },
  );
}
