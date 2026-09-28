import { STOCK_VALUE_SCALE, formatDecimal, parseDecimal } from "@aquarela/domain";
import {
  createDb,
  item,
  location,
  product,
  productVariant,
  storageArea,
  unit,
  type DatabaseTransaction,
  type DbClient,
  type NodeDatabase,
} from "@aquarela/persistence";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { postStockMovement } from "../inventory";
import { getWasteEvent } from "./get-waste-event";
import { createPostgresWasteStore } from "./postgres-store";
import { recordWasteEvent } from "./record-waste-event";

const databaseUrl = process.env.DATABASE_URL;
const suffix = randomUUID().replace(/-/g, "").slice(0, 12);

class RollbackSignal extends Error {}

/** Runs `fn` in a transaction and always rolls it back (append-only audits stay clean). */
async function inRollback(
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

interface Fixture {
  readonly unitId: string;
  readonly locationId: string;
  readonly storageAreaId: string;
  readonly itemId: string;
  readonly productVariantId: string;
}

async function seedFixture(tx: DatabaseTransaction, orgId: string): Promise<Fixture> {
  const base = await tx
    .insert(unit)
    .values({ organizationId: orgId, code: `g_${suffix}`, dimension: "mass", isBase: true })
    .returning();
  const createdLocation = await tx
    .insert(location)
    .values({ organizationId: orgId, code: `loc_${suffix}`, name: "Waste IT" })
    .returning();
  const area = await tx
    .insert(storageArea)
    .values({
      organizationId: orgId,
      locationId: createdLocation[0]!.id,
      code: `area_${suffix}`,
      name: "Dry store",
      kind: "dry_store",
    })
    .returning();
  const stocked = await tx
    .insert(item)
    .values({
      organizationId: orgId,
      code: `item_${suffix}`,
      sku: `SKU_${suffix}`,
      name: "Flour",
      itemType: "ingredient",
      // `DEC-150`: the fixture uses this item as the variant's finished good, so
      // it must be for sale for the edge guard to accept the variant.
      purpose: "for_sale",
      baseUnitId: base[0]!.id,
    })
    .returning();
  const finishedProduct = await tx
    .insert(product)
    .values({ organizationId: orgId, code: `prod_${suffix}`, name: "Cake" })
    .returning();
  const variant = await tx
    .insert(productVariant)
    .values({
      organizationId: orgId,
      productId: finishedProduct[0]!.id,
      code: `var_${suffix}`,
      sku: `VSKU_${suffix}`,
      name: "Cake slice",
      finishedGoodItemId: stocked[0]!.id,
    })
    .returning();

  return {
    unitId: base[0]!.id,
    locationId: createdLocation[0]!.id,
    storageAreaId: area[0]!.id,
    itemId: stocked[0]!.id,
    productVariantId: variant[0]!.id,
  };
}

/** An inbound movement (source types other than the guarded ones are no-ops). */
async function seedStock(
  store: ReturnType<typeof createPostgresWasteStore>,
  orgId: string,
  fixture: Fixture,
  actorId: string,
): Promise<void> {
  await postStockMovement(store, {
    organizationId: orgId,
    actorId,
    locationId: fixture.locationId,
    storageAreaId: fixture.storageAreaId,
    itemId: fixture.itemId,
    movementType: "correction",
    sourceType: "correction",
    sourceId: randomUUID(),
    quantityDelta: "100.000000",
    unitCost: "4.0000",
    occurredAt: "2026-01-01T10:00:00.000Z",
    reasonCode: "seeded opening",
  });
}

describe.skipIf(!databaseUrl)("waste vertical against PostgreSQL", () => {
  let client: DbClient;
  let orgId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    const org = await client.pool.query<{ id: string }>(
      "insert into organization (legal_name) values ($1) returning id",
      [`Waste IT ${suffix}`],
    );
    orgId = org.rows[0]!.id;
  });

  afterAll(async () => {
    if (client) {
      await client.pool.query("delete from organization where id = $1", [orgId]);
      await client.close();
    }
  });

  it("inserts the event before its movement and matches the ledger magnitude", async () => {
    await inRollback(client.db, async (tx) => {
      const fixture = await seedFixture(tx, orgId);
      const store = createPostgresWasteStore(tx);
      const actorId = randomUUID();
      await seedStock(store, orgId, fixture, actorId);

      const result = await recordWasteEvent(store, {
        organizationId: orgId,
        actorId,
        locationId: fixture.locationId,
        storageAreaId: fixture.storageAreaId,
        itemId: fixture.itemId,
        quantity: "10.000000",
        stage: "storage_expiry",
        reasonCode: "storage_expiry",
        occurredAt: "2026-01-02T10:00:00.000Z",
      });

      expect(result).toMatchObject({
        quantity: "10.000000",
        value: "40.0000",
        valueMethod: "moving_average",
        currency: "NOK",
        replayed: false,
      });

      const event = await getWasteEvent(store, {
        organizationId: orgId,
        wasteEventId: result.wasteEventId,
      });
      const movement = await store.findStockMovement(result.movementId);
      expect(event).toMatchObject({ itemId: fixture.itemId, value: "40.0000" });
      expect(movement).toMatchObject({
        movementType: "waste",
        sourceType: "waste_event",
        sourceId: result.wasteEventId,
        quantityDelta: "-10.000000",
        valueDelta: "-40.0000",
      });
      expect(event!.value).toBe(
        formatDecimal(-parseDecimal(movement!.valueDelta!, STOCK_VALUE_SCALE), STOCK_VALUE_SCALE),
      );

      const balance = await store.findStockBalance({
        organizationId: orgId,
        itemId: fixture.itemId,
        locationId: fixture.locationId,
        storageAreaId: fixture.storageAreaId,
        lotId: null,
      });
      expect(balance).toMatchObject({ quantityOnHand: "90.000000", valueOnHand: "360.0000" });
    });
  });

  it("resolves a product variant and replays a repeated idempotency key", async () => {
    await inRollback(client.db, async (tx) => {
      const fixture = await seedFixture(tx, orgId);
      const store = createPostgresWasteStore(tx);
      const actorId = randomUUID();
      await seedStock(store, orgId, fixture, actorId);

      const variant = await store.findProductVariant(fixture.productVariantId);
      expect(variant).toMatchObject({
        organizationId: orgId,
        code: `var_${suffix}`,
        finishedGoodItemId: fixture.itemId,
      });
      expect(await store.findProductVariant(randomUUID())).toBeUndefined();

      const input = {
        organizationId: orgId,
        actorId,
        locationId: fixture.locationId,
        storageAreaId: fixture.storageAreaId,
        itemId: null,
        productVariantId: fixture.productVariantId,
        quantity: "5.000000",
        stage: "unsold_finished_goods",
        reasonCode: "unsold_finished_goods",
        occurredAt: "2026-01-03T10:00:00.000Z",
        idempotencyKey: `waste-it-${suffix}`,
      } as const;

      const first = await recordWasteEvent(store, input);
      const replay = await recordWasteEvent(store, input);
      expect(replay.replayed).toBe(true);
      expect(replay.wasteEventId).toBe(first.wasteEventId);

      const events = await store.listWasteEvents({ organizationId: orgId });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        productVariantId: fixture.productVariantId,
        itemId: null,
        value: "20.0000",
      });
    });
  });
});
