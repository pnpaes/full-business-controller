import {
  createPostgresInventoryStore,
  listLocations,
  listRoles,
  listUsers,
  loadUserAccess,
} from "@aquarela/application";
import { color, radius, spacing } from "@aquarela/ui";
import { redirect } from "next/navigation";

import { getAuthStore } from "../../../../lib/auth";
import { getDb } from "../../../../lib/db";
import { resolveOrganization } from "../../../../lib/organization";
import { getServerSession } from "../../../../lib/server-session";

import {
  ADMIN_USERS_ROLES,
  isAdministrationAuthorized,
} from "../../../api/v1/administration/access";
import { toRoleRow, toUserRow } from "../../../api/v1/administration/admin-rows";

import { UserAccessManager } from "../user-access-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Users & access — Administration" };

/**
 * The users & access register (07_SECURITY_AND_NFR.md §7.1): each user's
 * roles, location scopes and status, with the grant/revoke/scopes/disable/
 * enable actions. Gated on the caller's live roles (ADR-0003).
 */
export default async function AdministrationUsersPage() {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const organizationId = resolveOrganization();
  const access = await loadUserAccess(getAuthStore(), session.userId);
  const canManageUsers = isAdministrationAuthorized(access, ADMIN_USERS_ROLES);
  if (!canManageUsers) {
    redirect("/administration");
  }

  const users = await listUsers(getAuthStore(), { organizationId });
  const roles = await listRoles(getAuthStore(), { organizationId });
  const locations = await listLocations(createPostgresInventoryStore(getDb().db), {
    organizationId,
  });

  return (
    <section
      style={{
        backgroundColor: color.background.surface,
        border: `1px solid ${color.border.subtle}`,
        borderRadius: radius["2xl"],
        padding: spacing[5],
      }}
    >
      <UserAccessManager
        users={users.map(toUserRow)}
        roles={roles.map(toRoleRow)}
        locations={locations.map((location) => ({
          id: location.id,
          code: location.code,
          name: location.name,
        }))}
      />
    </section>
  );
}
