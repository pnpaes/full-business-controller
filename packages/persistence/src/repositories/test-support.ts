import { randomUUID } from "node:crypto";

import type { Database, DatabaseTransaction, NodeDatabase } from "../client";
import {
  channel,
  costCenter,
  item,
  location,
  organization,
  product,
  productVariant,
  role,
  stockCount,
  stockCountLine,
  stockLot,
  stockMovement,
  stockTransfer,
  storageArea,
  unit,
  wasteEvent,
} from "../schema";
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

export async function createTestChannel(
  db: Database,
  organizationId: string,
  overrides: Partial<typeof channel.$inferInsert> = {},
): Promise<typeof channel.$inferSelect> {
  const rows = await db
    .insert(channel)
    .values({
      organizationId,
      code: uniqueName("chan"),
      name: "Test Channel",
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

export async function createTestProduct(
  db: Database,
  organizationId: string,
  overrides: Partial<typeof product.$inferInsert> = {},
): Promise<typeof product.$inferSelect> {
  const rows = await db
    .insert(product)
    .values({
      organizationId,
      code: uniqueName("prod"),
      name: "Test Product",
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

export async function createTestProductVariant(
  db: Database,
  organizationId: string,
  productId: string,
  overrides: Partial<typeof productVariant.$inferInsert> = {},
): Promise<typeof productVariant.$inferSelect> {
  const rows = await db
    .insert(productVariant)
    .values({
      organizationId,
      productId,
      code: uniqueName("variant"),
      sku: uniqueName("sku"),
      name: "Test Variant",
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

export async function createTestUnit(
  db: Database,
  organizationId: string,
  overrides: Partial<typeof unit.$inferInsert> = {},
): Promise<typeof unit.$inferSelect> {
  const rows = await db
    .insert(unit)
    .values({
      organizationId,
      code: uniqueName("unit"),
      dimension: "mass",
      isBase: true,
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

export async function createTestCostCenter(
  db: Database,
  organizationId: string,
  overrides: Partial<typeof costCenter.$inferInsert> = {},
): Promise<typeof costCenter.$inferSelect> {
  const rows = await db
    .insert(costCenter)
    .values({
      organizationId,
      code: uniqueName("cc"),
      name: "Test Cost Center",
      kind: "company_shared",
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

export async function createTestItem(
  db: Database,
  organizationId: string,
  baseUnitId: string,
  overrides: Partial<typeof item.$inferInsert> = {},
): Promise<typeof item.$inferSelect> {
  const rows = await db
    .insert(item)
    .values({
      organizationId,
      code: uniqueName("item"),
      sku: uniqueName("sku"),
      name: "Test Item",
      itemType: "ingredient",
      baseUnitId,
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

export async function createTestStorageArea(
  db: Database,
  organizationId: string,
  locationId: string,
  overrides: Partial<typeof storageArea.$inferInsert> = {},
): Promise<typeof storageArea.$inferSelect> {
  const rows = await db
    .insert(storageArea)
    .values({
      organizationId,
      locationId,
      code: uniqueName("area"),
      name: "Test Storage Area",
      kind: "dry_store",
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

export async function createTestStockLot(
  db: Database,
  organizationId: string,
  itemId: string,
  locationId: string,
  overrides: Partial<typeof stockLot.$inferInsert> = {},
): Promise<typeof stockLot.$inferSelect> {
  const rows = await db
    .insert(stockLot)
    .values({
      organizationId,
      itemId,
      locationId,
      lotNumber: uniqueName("lot"),
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

/**
 * A ledger movement with a non-zero quantity delta, defaulting to an
 * `adjustment` source. That default deliberately relies on the documented
 * `0017` `stock_movement_source_guard` no-op: the guard validates only
 * `source_type = 'goods_receipt'` and returns `NEW` unchanged for every other
 * source type (adjustment's source table is not modelled yet). Override
 * `sourceType`/`sourceId` to exercise `goods_receipt` validation.
 */
export async function createTestStockMovement(
  db: Database,
  organizationId: string,
  refs: {
    readonly itemId: string;
    readonly locationId: string;
    readonly storageAreaId: string;
    readonly unitId: string;
  },
  overrides: Partial<typeof stockMovement.$inferInsert> = {},
): Promise<typeof stockMovement.$inferSelect> {
  const rows = await db
    .insert(stockMovement)
    .values({
      organizationId,
      locationId: refs.locationId,
      storageAreaId: refs.storageAreaId,
      itemId: refs.itemId,
      movementType: "count_adjustment",
      quantityDelta: "1",
      unitId: refs.unitId,
      sourceType: "adjustment",
      sourceId: randomUUID(),
      occurredAt: new Date("2026-03-01T00:00:00.000Z"),
      postedBy: randomUUID(),
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

export async function createTestStockCount(
  db: Database,
  organizationId: string,
  locationId: string,
  overrides: Partial<typeof stockCount.$inferInsert> = {},
): Promise<typeof stockCount.$inferSelect> {
  const rows = await db
    .insert(stockCount)
    .values({
      organizationId,
      locationId,
      cutoff: new Date("2026-03-01T00:00:00.000Z"),
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

export async function createTestStockCountLine(
  db: Database,
  stockCountId: string,
  refs: { readonly itemId: string; readonly storageAreaId: string },
  overrides: Partial<typeof stockCountLine.$inferInsert> = {},
): Promise<typeof stockCountLine.$inferSelect> {
  const rows = await db
    .insert(stockCountLine)
    .values({
      stockCountId,
      itemId: refs.itemId,
      storageAreaId: refs.storageAreaId,
      expectedQty: "0",
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

export async function createTestStockTransfer(
  db: Database,
  organizationId: string,
  refs: {
    readonly fromLocationId: string;
    readonly fromStorageAreaId: string;
    readonly toLocationId: string;
    readonly toStorageAreaId: string;
  },
  overrides: Partial<typeof stockTransfer.$inferInsert> = {},
): Promise<typeof stockTransfer.$inferSelect> {
  const rows = await db
    .insert(stockTransfer)
    .values({
      organizationId,
      ...refs,
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

export async function createTestWasteEvent(
  db: Database,
  organizationId: string,
  refs: {
    readonly locationId: string;
    readonly storageAreaId: string;
    readonly itemId: string;
    readonly unitId: string;
  },
  overrides: Partial<typeof wasteEvent.$inferInsert> = {},
): Promise<typeof wasteEvent.$inferSelect> {
  const rows = await db
    .insert(wasteEvent)
    .values({
      organizationId,
      locationId: refs.locationId,
      storageAreaId: refs.storageAreaId,
      itemId: refs.itemId,
      quantity: "1",
      unitId: refs.unitId,
      stage: "other",
      reasonCode: "test",
      valueMethod: "moving_average",
      occurredAt: new Date("2026-03-01T00:00:00.000Z"),
      actorId: randomUUID(),
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

/**
 * Awaits `operation` expecting it to reject, then returns the underlying error.
 *
 * drizzle 0.44+ wraps driver errors in `DrizzleQueryError` with the original
 * PostgreSQL error (the one carrying the trigger/constraint message) in
 * `.cause`. Assertions on a failure reason must go through `.cause`; falling
 * back to the wrapper keeps this usable if that wrapping ever changes.
 */
export async function rejectionCause(operation: Promise<unknown>): Promise<Error> {
  const caught = await operation.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(caught instanceof Error)) {
    throw new Error("expected the operation to reject with an Error");
  }
  return caught.cause instanceof Error ? caught.cause : caught;
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
