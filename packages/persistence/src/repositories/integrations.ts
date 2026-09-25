import { and, asc, eq } from "drizzle-orm";

import type { Database } from "../client";
import { integrationSource } from "../schema";

export type IntegrationSource = typeof integrationSource.$inferSelect;
export type NewIntegrationSource = typeof integrationSource.$inferInsert;

/*
 * `INTG-001` / `DEC-137`: the **read-only** integrations registry repository.
 *
 * `integration_source` carries `organization_id` directly, so every read and
 * write that takes the organization is scoped by it (`DEC-061`): a row in
 * another organization is invisible, and an org-scoped miss returns `undefined`
 * rather than surfacing another tenant's row. The `DEC-015` write-requires-
 * approved-terms invariant, the vocabularies and the text[] subset are
 * database-backed, so this layer does not re-validate them; the application
 * validates first so a caller sees a `DomainError`.
 *
 * The audit columns are plain uuid (`auditColumns()`), so `createdBy`/
 * `updatedBy` take the acting user id; no `audit_event` is written here (the
 * application writes the facts, the `competitor.ts` convention).
 */

export interface CreateIntegrationSourceInput {
  readonly organizationId: string;
  readonly name: string;
  readonly systemType: string;
  /** Defaults to `read` (the read-only posture) at the database. */
  readonly direction?: string;
  /** `ALLOWED_OPERATION` subset; defaults to `{}` at the database. */
  readonly allowedOperations?: readonly string[];
  readonly credentialsOwner: string;
  readonly rateLimitNote: string | null;
  /** Defaults to `pending` at the database (`DEC-015`). */
  readonly termsStatus?: string;
  readonly active?: boolean;
  readonly actorId: string;
}

/** Creates one `integration_source` row; `(organization_id, name)` is unique. */
export async function createIntegrationSource(
  db: Database,
  input: CreateIntegrationSourceInput,
): Promise<IntegrationSource> {
  const rows = await db
    .insert(integrationSource)
    .values({
      organizationId: input.organizationId,
      name: input.name,
      systemType: input.systemType,
      ...(input.direction === undefined ? {} : { direction: input.direction }),
      ...(input.allowedOperations === undefined
        ? {}
        : { allowedOperations: [...input.allowedOperations] }),
      credentialsOwner: input.credentialsOwner,
      rateLimitNote: input.rateLimitNote,
      ...(input.termsStatus === undefined ? {} : { termsStatus: input.termsStatus }),
      ...(input.active === undefined ? {} : { active: input.active }),
      createdBy: input.actorId,
    })
    .returning();
  return rows[0]!;
}

export interface FindIntegrationSourceQuery {
  readonly organizationId: string;
  readonly integrationSourceId: string;
}

/** One source by id, organization-scoped (`DEC-061`), or `undefined`. */
export async function findIntegrationSourceById(
  db: Database,
  query: FindIntegrationSourceQuery,
): Promise<IntegrationSource | undefined> {
  const rows = await db
    .select()
    .from(integrationSource)
    .where(
      and(
        eq(integrationSource.id, query.integrationSourceId),
        eq(integrationSource.organizationId, query.organizationId),
      ),
    )
    .limit(1);
  return rows[0];
}

export interface FindIntegrationSourceByNameQuery {
  readonly organizationId: string;
  readonly name: string;
}

/**
 * One source by its `(organization_id, name)` unique key, or `undefined`.
 * Backs the duplicate-name guard in `registerIntegrationSource`.
 */
export async function findIntegrationSourceByName(
  db: Database,
  query: FindIntegrationSourceByNameQuery,
): Promise<IntegrationSource | undefined> {
  const rows = await db
    .select()
    .from(integrationSource)
    .where(
      and(
        eq(integrationSource.organizationId, query.organizationId),
        eq(integrationSource.name, query.name),
      ),
    )
    .limit(1);
  return rows[0];
}

export interface ListIntegrationSourcesQuery {
  readonly organizationId: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * The organization's integration sources, name-ascending (then id), with the
 * bounded paging idiom (`$dynamic()`). The organization filter is never optional
 * (`DEC-061`), so the read can never cross tenants; paging is applied after the
 * ordering. `list-integration-sources.ts` validates `limit`/`offset` first.
 */
export async function listIntegrationSources(
  db: Database,
  query: ListIntegrationSourcesQuery,
): Promise<readonly IntegrationSource[]> {
  const statement = db
    .select()
    .from(integrationSource)
    .where(eq(integrationSource.organizationId, query.organizationId))
    .orderBy(asc(integrationSource.name), asc(integrationSource.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}

export interface UpdateIntegrationSourceInput {
  readonly organizationId: string;
  readonly integrationSourceId: string;
  readonly name: string;
  readonly systemType: string;
  readonly direction: string;
  readonly allowedOperations: readonly string[];
  readonly credentialsOwner: string;
  readonly rateLimitNote: string | null;
  readonly termsStatus: string;
  readonly active: boolean;
  readonly actorId: string;
}

/**
 * Updates the mutable fields of one **organization-owned** source and stamps
 * `updated_at`/`updated_by`. `undefined` when the id is unknown or belongs to
 * another organization, so a scoped miss cannot silently update another
 * tenant's row (`DEC-061`).
 */
export async function updateIntegrationSource(
  db: Database,
  input: UpdateIntegrationSourceInput,
): Promise<IntegrationSource | undefined> {
  const rows = await db
    .update(integrationSource)
    .set({
      name: input.name,
      systemType: input.systemType,
      direction: input.direction,
      allowedOperations: [...input.allowedOperations],
      credentialsOwner: input.credentialsOwner,
      rateLimitNote: input.rateLimitNote,
      termsStatus: input.termsStatus,
      active: input.active,
      updatedAt: new Date(),
      updatedBy: input.actorId,
    })
    .where(
      and(
        eq(integrationSource.id, input.integrationSourceId),
        eq(integrationSource.organizationId, input.organizationId),
      ),
    )
    .returning();
  return rows[0];
}
