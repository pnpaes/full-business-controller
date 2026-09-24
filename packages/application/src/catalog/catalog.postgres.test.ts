import {
  createDb,
  createSupplier,
  findSupplierItemBySku,
  item,
  type DatabaseTransaction,
  type DbClient,
  type NodeDatabase,
  unit,
  unitConversion,
} from "@aquarela/persistence";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresMasterDataStore } from "./postgres-store";
import { registerSupplier } from "./register-supplier";
import { registerSupplierItem } from "./register-supplier-item";
import { registerUnitConversion } from "./register-unit-conversion";
import { resolveConversion } from "./resolve-conversion";
import { updateItem } from "./update-item";

const databaseUrl = process.env.DATABASE_URL;
const suffix = randomUUID().replace(/-/g, "").slice(0, 12);

class RollbackSignal extends Error {}

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

describe.skipIf(!databaseUrl)("catalog commands against PostgreSQL", () => {
  let client: DbClient;
  let orgId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    const org = await client.pool.query<{ id: string }>(
      "insert into organization (legal_name) values ($1) returning id",
      [`Catalog IT ${suffix}`],
    );
    orgId = org.rows[0]!.id;
  });

  afterAll(async () => {
    if (client) {
      await client.pool.query("delete from organization where id = $1", [orgId]);
      await client.close();
    }
  });

  it("registers a supplier item with its pack conversion through the port", async () => {
    await inRollback(client.db, async (tx) => {
      const base = await tx
        .insert(unit)
        .values({ organizationId: orgId, code: `g_${suffix}`, dimension: "mass", isBase: true })
        .returning();
      const pack = await tx
        .insert(unit)
        .values({
          organizationId: orgId,
          code: `pack_${suffix}`,
          dimension: "package",
          isBase: false,
        })
        .returning();
      const flour = await tx
        .insert(item)
        .values({
          organizationId: orgId,
          code: `flour_${suffix}`,
          sku: `FLOUR_${suffix}`,
          name: "Flour",
          itemType: "ingredient",
          baseUnitId: base[0]!.id,
        })
        .returning();
      const supplier = await createSupplier(tx, {
        organizationId: orgId,
        code: `sup_${suffix}`,
        name: "Supplier",
      });

      const store = createPostgresMasterDataStore(tx);
      const { supplierItemId } = await registerSupplierItem(store, {
        organizationId: orgId,
        supplierId: supplier.id,
        itemId: flour[0]!.id,
        supplierSku: "FLOUR-25KG",
        packUnitId: pack[0]!.id,
        packToBaseUnitFactor: "1000",
        leadTimeDays: 2,
      });

      const stored = await findSupplierItemBySku(tx, supplier.id, "FLOUR-25KG");
      expect(stored?.id).toBe(supplierItemId);
      expect(stored?.packToBaseUnitFactor).toBe("1000.000000");
    });
  });

  it("resolves an effective conversion through the port", async () => {
    await inRollback(client.db, async (tx) => {
      const gram = await tx
        .insert(unit)
        .values({ organizationId: orgId, code: `g2_${suffix}`, dimension: "mass", isBase: true })
        .returning();
      const kilo = await tx
        .insert(unit)
        .values({ organizationId: orgId, code: `kg_${suffix}`, dimension: "mass", isBase: false })
        .returning();
      await tx.insert(unitConversion).values({
        organizationId: orgId,
        fromUnitId: kilo[0]!.id,
        toUnitId: gram[0]!.id,
        factor: "1000",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      });

      const store = createPostgresMasterDataStore(tx);
      const resolved = await resolveConversion(store, {
        organizationId: orgId,
        fromUnitId: kilo[0]!.id,
        toUnitId: gram[0]!.id,
        asOf: new Date("2026-09-19T00:00:00.000Z"),
      });
      expect(resolved.factor).toBe("1000.000000");
    });
  });

  it("updates an item's mutable fields through the port", async () => {
    await inRollback(client.db, async (tx) => {
      const base = await tx
        .insert(unit)
        .values({ organizationId: orgId, code: `g3_${suffix}`, dimension: "mass", isBase: true })
        .returning();
      const created = await tx
        .insert(item)
        .values({
          organizationId: orgId,
          code: `upd_${suffix}`,
          sku: `UPD_${suffix}`,
          name: "Before",
          itemType: "ingredient",
          baseUnitId: base[0]!.id,
        })
        .returning();

      const store = createPostgresMasterDataStore(tx);
      await updateItem(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        itemId: created[0]!.id,
        name: "After",
        lotTracked: true,
      });

      const read = await store.findCatalogItem(created[0]!.id);
      expect(read).toMatchObject({
        name: "After",
        lotTracked: true,
        code: `upd_${suffix}`,
        sku: `UPD_${suffix}`,
      });
    });
  });

  it("registers a supplier through the port, idempotent on code", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresMasterDataStore(tx);
      const first = await registerSupplier(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        code: `sup2_${suffix}`,
        name: "Supplier Two",
        currency: "NOK",
      });
      const second = await registerSupplier(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        code: `sup2_${suffix}`,
        name: "Ignored",
      });

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.supplierId).toBe(first.supplierId);
    });
  });

  it("registers a global unit conversion through the port", async () => {
    await inRollback(client.db, async (tx) => {
      const gram = await tx
        .insert(unit)
        .values({ organizationId: orgId, code: `g4_${suffix}`, dimension: "mass", isBase: true })
        .returning();
      const kilo = await tx
        .insert(unit)
        .values({ organizationId: orgId, code: `kg4_${suffix}`, dimension: "mass", isBase: false })
        .returning();

      const store = createPostgresMasterDataStore(tx);
      const { conversionId } = await registerUnitConversion(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        fromUnitCode: `kg4_${suffix}`,
        toUnitCode: `g4_${suffix}`,
        factor: "1000",
      });
      expect(conversionId).toBeTruthy();

      const resolved = await resolveConversion(store, {
        organizationId: orgId,
        fromUnitId: kilo[0]!.id,
        toUnitId: gram[0]!.id,
        asOf: new Date(),
      });
      expect(resolved.factor).toBe("1000.000000");
    });
  });
});
