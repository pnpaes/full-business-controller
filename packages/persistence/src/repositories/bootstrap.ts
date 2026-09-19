import { and, eq, sql } from "drizzle-orm";

import type { Database } from "../client";
import { organization, role, userRole } from "../schema";

export type OrganizationRow = typeof organization.$inferSelect;
export type RoleRow = typeof role.$inferSelect;

/**
 * Bootstrap-only primitives for creating the first organization and its `owner`
 * role. They are the thin SQL seam the application `bootstrap.ts` command needs
 * and exist so the command never reaches for `drizzle-orm` directly. The owner
 * *user* is created with `createUser` and the grant with `assignRole`.
 */

/**
 * Finds the organization by display name, case-insensitively and trimmed. There
 * is no unique index on `legal_name` (the schema is multi-organization-capable),
 * so bootstrap treats the first match as the installation's organization; the
 * runbook tells the operator to reuse the exact name on every run.
 */
export async function findOrganizationByName(
  db: Database,
  legalName: string,
): Promise<OrganizationRow | undefined> {
  const normalized = legalName.trim().toLowerCase();
  const rows = await db
    .select()
    .from(organization)
    .where(sql`lower(btrim(${organization.legalName})) = ${normalized}`)
    .limit(1);
  return rows[0];
}

export async function createOrganization(
  db: Database,
  input: { readonly legalName: string },
): Promise<OrganizationRow> {
  const rows = await db.insert(organization).values({ legalName: input.legalName }).returning();
  return rows[0]!;
}

export async function findRoleByCode(
  db: Database,
  organizationId: string,
  code: string,
): Promise<RoleRow | undefined> {
  const rows = await db
    .select()
    .from(role)
    .where(and(eq(role.organizationId, organizationId), eq(role.code, code)))
    .limit(1);
  return rows[0];
}

export async function createRole(
  db: Database,
  input: { readonly organizationId: string; readonly code: string; readonly name: string },
): Promise<RoleRow> {
  const rows = await db.insert(role).values(input).returning();
  return rows[0]!;
}

/**
 * Whether any user in the organization already holds the given role. Bootstrap
 * uses this as its "an owner already exists" guard (scoped to the target
 * organization, so a second organization is unaffected).
 */
export async function hasRoleGrant(
  db: Database,
  organizationId: string,
  code: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: userRole.id })
    .from(userRole)
    .innerJoin(role, eq(role.id, userRole.roleId))
    .where(and(eq(role.organizationId, organizationId), eq(role.code, code)))
    .limit(1);
  return rows.length > 0;
}
