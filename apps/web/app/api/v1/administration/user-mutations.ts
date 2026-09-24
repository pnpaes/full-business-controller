import type { AuthSessionRecord, AuthStore } from "@aquarela/application";

import { getAuthStore, requireSession } from "../../../../lib/auth";
import { withMutationGuards } from "../../../../lib/guards";
import { jsonError } from "../../../../lib/http";
import { resolveOrganization } from "../../../../lib/organization";
import type { RateLimiter } from "../../../../lib/rate-limit";

import { ADMIN_USERS_ROLES, isAdministrationAuthorized, loadAdministrationAccess } from "./access";
import { isUuid } from "./admin-rows";

export interface UserMutationContext {
  readonly session: AuthSessionRecord;
  readonly store: AuthStore;
  readonly organizationId: string;
  readonly userId: string;
}

/**
 * The shared prelude of every user/access mutation: CSRF + throttle
 * (`withMutationGuards`), the live-role gate (`ADMIN_USERS_ROLES` — never a
 * client claim, ADR-0003), a UUID check on the target id, and an
 * organization-scoped existence check, so an unknown or cross-organization user
 * is a 404 before any command runs (`DEC-061`). The handler only runs when all of
 * that holds.
 */
export async function withUserMutation(
  request: Request,
  limiter: RateLimiter,
  userId: string,
  run: (context: UserMutationContext) => Promise<Response>,
): Promise<Response> {
  return withMutationGuards(request, limiter, async () => {
    const { session } = await requireSession(request);
    const access = await loadAdministrationAccess(session.userId);
    if (!isAdministrationAuthorized(access, ADMIN_USERS_ROLES)) {
      return jsonError(403);
    }
    if (!isUuid(userId)) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = getAuthStore();
    const user = await store.findUserById(userId);
    if (user === undefined || user.organizationId !== organizationId) {
      return jsonError(404);
    }

    return run({ session, store, organizationId, userId });
  });
}
