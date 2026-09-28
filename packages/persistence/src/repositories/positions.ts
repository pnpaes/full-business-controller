import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import type { Database } from "../client";
import { employeePosition, position } from "../schema";

export type Position = typeof position.$inferSelect;
export type EmployeePosition = typeof employeePosition.$inferSelect;

/*
 * `DEC-151` (2026-09-28): the **position** catalogue and the employee↔position
 * join. `position` is an **open**, organization-scoped list (unlike the fixed
 * `role` access vocabulary): `code` is unique per organization, a position is
 * deactivated (`active_to`) rather than deleted, and the employee set is
 * **replaced** by `replaceEmployeePositions`.
 *
 * Every read and write takes the organization and is scoped by it (`DEC-061`);
 * a row in another organization is invisible at this scope (a scoped miss
 * returns `undefined`/`[]`). Both references carry `organization_id`, so the
 * `0080` guard triggers keep a cross-organization grant out.
 */

export interface CreatePositionInput {
  readonly organizationId: string;
  /** Unique per organization (`position_organization_id_code_key`). */
  readonly code: string;
  readonly name: string;
  /** `date`, `YYYY-MM-DD`; crosses this layer as a `YYYY-MM-DD` string. */
  readonly activeFrom: string;
  /** `date`, `YYYY-MM-DD`, or `null`; must be after `activeFrom`. */
  readonly activeTo?: string | null;
  /** Audit actor; recorded as `created_by` (the `app_user` FK is deferred). */
  readonly actorId?: string | null;
}

/** Creates one position row. `organizationId` is supplied by the caller. */
export async function createPosition(db: Database, input: CreatePositionInput): Promise<Position> {
  const rows = await db
    .insert(position)
    .values({
      organizationId: input.organizationId,
      code: input.code,
      name: input.name,
      activeFrom: input.activeFrom,
      activeTo: input.activeTo ?? null,
      createdBy: input.actorId ?? null,
    })
    .returning();
  return rows[0]!;
}

/** One position by id, organization-scoped (`DEC-061`), or `undefined`. */
export async function findPosition(
  db: Database,
  query: { readonly organizationId: string; readonly positionId: string },
): Promise<Position | undefined> {
  const rows = await db
    .select()
    .from(position)
    .where(
      and(eq(position.id, query.positionId), eq(position.organizationId, query.organizationId)),
    )
    .limit(1);
  return rows[0];
}

/** One position by `code`, organization-scoped (`DEC-061`), or `undefined`. */
export async function findPositionByCode(
  db: Database,
  query: { readonly organizationId: string; readonly code: string },
): Promise<Position | undefined> {
  const rows = await db
    .select()
    .from(position)
    .where(and(eq(position.code, query.code), eq(position.organizationId, query.organizationId)))
    .limit(1);
  return rows[0];
}

export interface UpdatePositionPatch {
  readonly code?: string;
  readonly name?: string;
  /** `date`, `YYYY-MM-DD`. */
  readonly activeFrom?: string;
  /** `date`, `YYYY-MM-DD`, or `null` to reactivate. */
  readonly activeTo?: string | null;
}

export interface UpdatePositionInput extends UpdatePositionPatch {
  readonly organizationId: string;
  readonly positionId: string;
  /** Audit actor; recorded as `updated_by` (the `app_user` FK is deferred). */
  readonly actorId?: string | null;
}

/**
 * Updates one position's mutable fields, organization-scoped (`DEC-061`). A
 * field left out of the patch is untouched (drizzle skips `undefined`); a
 * missing or cross-organization id returns `undefined`. There is deliberately
 * no delete: deactivation is `active_to`.
 */
export async function updatePosition(
  db: Database,
  input: UpdatePositionInput,
): Promise<Position | undefined> {
  const { organizationId, positionId, actorId, ...patch } = input;
  const rows = await db
    .update(position)
    .set({
      ...patch,
      updatedAt: new Date(),
      ...(actorId === undefined ? {} : { updatedBy: actorId }),
    })
    .where(and(eq(position.id, positionId), eq(position.organizationId, organizationId)))
    .returning();
  return rows[0];
}

export interface ListPositionsQuery {
  readonly organizationId: string;
  /** `true` = active (`active_to` null or in the future); `false` = inactive. */
  readonly active?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Position rows for one organization, ordered by `name` then id, with an
 * optional active filter. The organization filter is never optional
 * (`DEC-061`); paging is applied after the ordering.
 */
export async function listPositions(
  db: Database,
  query: ListPositionsQuery,
): Promise<readonly Position[]> {
  const active =
    query.active === undefined
      ? undefined
      : query.active
        ? or(isNull(position.activeTo), sql`${position.activeTo} > current_date`)
        : sql`${position.activeTo} is not null and ${position.activeTo} <= current_date`;
  const statement = db
    .select()
    .from(position)
    .where(and(eq(position.organizationId, query.organizationId), active))
    .orderBy(asc(position.name), asc(position.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}

/**
 * Replaces one employee's position set: deletes the existing grants then inserts
 * the supplied (already validated/deduped) positions, all inside the caller's
 * transaction so a failure rolls the whole set back. The employee and each
 * position are matched organization-scoped through the row's `organization_id`.
 */
export async function replaceEmployeePositions(
  db: Database,
  input: {
    readonly organizationId: string;
    readonly employeeId: string;
    readonly positionIds: readonly string[];
    readonly actorId?: string | null;
  },
): Promise<void> {
  await db
    .delete(employeePosition)
    .where(
      and(
        eq(employeePosition.organizationId, input.organizationId),
        eq(employeePosition.employeeId, input.employeeId),
      ),
    );
  // Dedupe defensively: the command already dedupes, but the unique pair would
  // otherwise reject a repeated id (23505) rather than ignore it.
  const positionIds = [...new Set(input.positionIds)];
  if (positionIds.length === 0) {
    return;
  }
  await db.insert(employeePosition).values(
    positionIds.map((positionId) => ({
      organizationId: input.organizationId,
      employeeId: input.employeeId,
      positionId,
      createdBy: input.actorId ?? null,
    })),
  );
}

/** The position rows one employee holds, organization-scoped (`DEC-061`). */
export async function listEmployeePositions(
  db: Database,
  query: { readonly organizationId: string; readonly employeeId: string },
): Promise<readonly Position[]> {
  return db
    .select({
      id: position.id,
      organizationId: position.organizationId,
      code: position.code,
      name: position.name,
      activeFrom: position.activeFrom,
      activeTo: position.activeTo,
      createdAt: position.createdAt,
      createdBy: position.createdBy,
      updatedAt: position.updatedAt,
      updatedBy: position.updatedBy,
      version: position.version,
    })
    .from(employeePosition)
    .innerJoin(position, eq(employeePosition.positionId, position.id))
    .where(
      and(
        eq(employeePosition.organizationId, query.organizationId),
        eq(employeePosition.employeeId, query.employeeId),
        eq(position.organizationId, query.organizationId),
      ),
    )
    .orderBy(asc(position.name), asc(position.id));
}

/** The ids of the positions one employee holds, organization-scoped (`DEC-061`). */
export async function listEmployeePositionIds(
  db: Database,
  query: { readonly organizationId: string; readonly employeeId: string },
): Promise<readonly string[]> {
  const rows = await db
    .select({ positionId: employeePosition.positionId })
    .from(employeePosition)
    .where(
      and(
        eq(employeePosition.organizationId, query.organizationId),
        eq(employeePosition.employeeId, query.employeeId),
      ),
    );
  return rows.map((row) => row.positionId);
}

/**
 * The position ids of many employees at once, organization-scoped (`DEC-061`),
 * returned as a `Map<employeeId, positionIds>` so a register read is one query
 * instead of N.
 */
export async function listEmployeePositionIdsByEmployeeIds(
  db: Database,
  query: { readonly organizationId: string; readonly employeeIds: readonly string[] },
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (query.employeeIds.length === 0) {
    return map;
  }
  const rows = await db
    .select({
      employeeId: employeePosition.employeeId,
      positionId: employeePosition.positionId,
    })
    .from(employeePosition)
    .where(
      and(
        eq(employeePosition.organizationId, query.organizationId),
        inArray(employeePosition.employeeId, [...query.employeeIds]),
      ),
    );
  for (const row of rows) {
    const list = map.get(row.employeeId);
    if (list === undefined) {
      map.set(row.employeeId, [row.positionId]);
    } else {
      list.push(row.positionId);
    }
  }
  return map;
}

/** The employee ids holding any of `positionIds`, organization-scoped (`DEC-061`). */
export async function listEmployeeIdsByPositions(
  db: Database,
  query: {
    readonly organizationId: string;
    readonly positionIds: readonly string[];
    readonly employeeId?: string;
  },
): Promise<readonly string[]> {
  if (query.positionIds.length === 0) {
    return [];
  }
  const rows = await db
    .selectDistinct({ employeeId: employeePosition.employeeId })
    .from(employeePosition)
    .where(
      and(
        eq(employeePosition.organizationId, query.organizationId),
        inArray(employeePosition.positionId, [...query.positionIds]),
        query.employeeId === undefined
          ? undefined
          : eq(employeePosition.employeeId, query.employeeId),
      ),
    );
  return rows.map((row) => row.employeeId);
}
