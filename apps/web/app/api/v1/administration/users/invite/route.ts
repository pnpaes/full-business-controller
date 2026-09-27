import { inviteEmployeeUser } from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { getAuthStore, requireSession } from "../../../../../../lib/auth";
import { deliverInviteEmail, getAuthDeps } from "../../../../../../lib/deps";
import { withMutationGuards } from "../../../../../../lib/guards";
import { jsonError, jsonOk } from "../../../../../../lib/http";
import { limiters } from "../../../../../../lib/limiters";
import { resolveOrganization } from "../../../../../../lib/organization";
import { readJsonObject, readString } from "../../../../../../lib/request";
import { requestContext } from "../../../../../../lib/request-context";

import {
  ADMIN_USERS_ROLES,
  isAdministrationAuthorized,
  loadAdministrationAccess,
} from "../../access";
import { isUuid } from "../../admin-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Provisions an employee login and emails the accept invite (`DEC-146`, `WF-003`
 * slice A). Body: `{ employeeId, email }`.
 *
 * Gated on the live `ADMIN_USERS_ROLES` (owner / admin) and fail-closed
 * throttled; the account is created `invited` with no usable password and
 * `employee.user_id` is linked in one transaction. The plaintext invite token
 * returned by the command goes straight to `deliverInviteEmail` — it is never
 * put in the response or logged. A non-UUID `employeeId` or a missing field →
 * 400; an unknown/cross-organization employee → 404; a non-owner/admin caller →
 * 403.
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, limiters.inviteEmployee, async () => {
    const { session } = await requireSession(request);
    const access = await loadAdministrationAccess(session.userId);
    if (!isAdministrationAuthorized(access, ADMIN_USERS_ROLES)) {
      return jsonError(403);
    }

    const body = await readJsonObject(request);
    const employeeId = readString(body, "employeeId", 64);
    const email = readString(body, "email", 320);
    if (employeeId === undefined || email === undefined || !isUuid(employeeId)) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = getAuthStore();
    const employee = await store.findEmployeeLink({ organizationId, employeeId });
    if (employee === undefined) {
      return jsonError(404);
    }

    let result;
    try {
      result = await inviteEmployeeUser(store, getAuthDeps(), {
        organizationId,
        actorId: session.userId,
        employeeId,
        email,
        request: requestContext(request),
      });
    } catch (error) {
      // The command's DomainError message names an internal reason (which
      // employee/account state failed); it stays in the audit only. The client
      // gets the single generic 400 body.
      if (error instanceof NotFoundError) {
        return jsonError(404);
      }
      if (error instanceof DomainError) {
        return jsonError(400);
      }
      throw error;
    }

    await deliverInviteEmail({
      organizationId,
      userId: result.userId,
      email,
      token: result.token,
    });

    return jsonOk({
      userId: result.userId,
      employeeId: result.employeeId,
      expiresAt: result.expiresAt.toISOString(),
    });
  });
}
