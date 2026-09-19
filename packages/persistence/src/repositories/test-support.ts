import { randomUUID } from "node:crypto";

import type { Database, DatabaseTransaction, NodeDatabase } from "../client";
import { location, organization, role } from "../schema";
import { createUser, type NewUser, type User } from "./users";

/**
 * Test-only support for the PostgreSQL integration tests.
 *
 * Every integration test runs inside a transaction that is always rolled back.
 * That keeps the append-only `audit_event` rows (which the database by design
 * refuses to delete) from accumulating, and means each test's rows are isolated
 * even when a statement is expected to fail.
 */
class RollbackSignal extends Error {
  constructor() {
    super("rollback");
    this.name = "RollbackSignal";
  }
}

let counter = 0;

/** Random, collision-resistant suffix for usernames, emails and org names. */
export function uniqueSuffix(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

export function uniqueName(prefix: string): string {
  counter += 1;
  return `${prefix}_${counter}_${uniqueSuffix()}`;
}

export async function createTestOrganization(db: Database, suffix: string): Promise<string> {
  const rows = await db
    .insert(organization)
    .values({ legalName: `Test Org ${suffix}` })
    .returning({ id: organization.id });
  return rows[0]!.id;
}

export async function createTestUser(
  db: Database,
  organizationId: string,
  overrides: Partial<NewUser> = {},
): Promise<User> {
  return createUser(db, {
    organizationId,
    username: uniqueName("user"),
    email: `${uniqueName("mail")}@example.test`,
    displayName: "Test User",
    passwordHash: "hash-v1",
    ...overrides,
  });
}

export async function createTestLocation(
  db: Database,
  organizationId: string,
  overrides: Partial<typeof location.$inferInsert> = {},
): Promise<typeof location.$inferSelect> {
  const rows = await db
    .insert(location)
    .values({
      organizationId,
      code: uniqueName("loc"),
      name: "Test Location",
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

export async function createTestRole(
  db: Database,
  organizationId: string,
  overrides: Partial<typeof role.$inferInsert> = {},
): Promise<typeof role.$inferSelect> {
  const rows = await db
    .insert(role)
    .values({
      organizationId,
      code: "owner",
      name: "Owner",
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

/**
 * Runs `fn` in a transaction and rolls it back. A statement that is expected to
 * fail can be caught inside `fn` without aborting the test: the rollback at the
 * end is what discards the work either way.
 */
export async function inRollback(
  db: NodeDatabase,
  fn: (tx: DatabaseTransaction) => Promise<void>,
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await fn(tx);
      throw new RollbackSignal();
    });
  } catch (error) {
    if (!(error instanceof RollbackSignal)) {
      throw error;
    }
  }
}
