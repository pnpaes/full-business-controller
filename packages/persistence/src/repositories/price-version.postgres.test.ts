import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient } from "../client";
import { channel, location, organization, priceScenario, product, productVariant } from "../schema";
import { createPriceScenario } from "./price-scenario";
import {
  createPriceVersion,
  findEffectivePriceVersion,
  findPriceVersion,
  listPriceVersions,
  listPriceVersionsForScope,
} from "./price-version";
import {
  createTestChannel,
  createTestLocation,
  createTestProduct,
  createTestProductVariant,
  createTestPriceVersion,
  createTestOrganization,
  inRollback,
  rejectionCause,
  uniqueSuffix,
} from "./test-support";

const databaseUrl = process.env.DATABASE_URL;
const suffix = uniqueSuffix();

const T = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

describe.skipIf(!databaseUrl)("price version repository", () => {
  let client: DbClient;
  let orgId: string;
  let productId: string;
  let variantId: string;
  let scenarioId: string;
  let otherScenarioId: string;
  let channelId: string;
  let locationId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    orgId = await createTestOrganization(client.db, suffix);
    const chan = await createTestChannel(client.db, orgId);
    channelId = chan.id;
    const loc = await createTestLocation(client.db, orgId);
    locationId = loc.id;
    const prod = await createTestProduct(client.db, orgId);
    productId = prod.id;
    const variant = await createTestProductVariant(client.db, orgId, productId);
    variantId = variant.id;
    const scenario = await createPriceScenario(client.db, {
      organizationId: orgId,
      productVariantId: variantId,
    });
    scenarioId = scenario.id;
    const other = await createPriceScenario(client.db, {
      organizationId: orgId,
      productVariantId: variantId,
    });
    otherScenarioId = other.id;
  });

  afterAll(async () => {
    if (client) {
      // price_version rows are always inside a rolled-back transaction, so the
      // deletes below only need to unwind the committed beforeAll fixtures.
      await client.db.delete(priceScenario).where(eq(priceScenario.organizationId, orgId));
      await client.db.delete(productVariant).where(eq(productVariant.id, variantId));
      await client.db.delete(product).where(eq(product.id, productId));
      await client.db.delete(channel).where(eq(channel.id, channelId));
      await client.db.delete(location).where(eq(location.id, locationId));
      await client.db.delete(organization).where(eq(organization.id, orgId));
      await client.close();
    }
  });

  it("creates a price version and finds it organization-scoped", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createPriceVersion(tx, {
        organizationId: orgId,
        productVariantId: variantId,
        grossPrice: "120.0000",
        netPrice: "100.0000",
        effectiveFrom: T("2026-01-01"),
        approvedBy: randomUUID(),
        approvedAt: T("2026-01-01"),
        sourceScenarioId: scenarioId,
      });
      expect(created.locationId).toBeNull();
      expect(created.channelId).toBeNull();
      expect(created.effectiveTo).toBeNull();

      expect(
        (await findPriceVersion(tx, { organizationId: orgId, priceVersionId: created.id }))?.id,
      ).toBe(created.id);

      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      expect(
        await findPriceVersion(tx, { organizationId: otherOrgId, priceVersionId: created.id }),
      ).toBeUndefined();
    });
  });

  it("lists versions newest effective_from first with paging", async () => {
    await inRollback(client.db, async (tx) => {
      const july = await createTestPriceVersion(
        tx,
        orgId,
        { productVariantId: variantId, sourceScenarioId: scenarioId },
        { effectiveFrom: T("2026-07-01") },
      );
      const january = await createTestPriceVersion(
        tx,
        orgId,
        { productVariantId: variantId, sourceScenarioId: scenarioId },
        { effectiveFrom: T("2026-01-01"), effectiveTo: T("2026-07-01") },
      );

      const all = await listPriceVersions(tx, { organizationId: orgId });
      expect(all.map((row) => row.id)).toEqual([july.id, january.id]);

      const paged = await listPriceVersions(tx, { organizationId: orgId, limit: 1, offset: 1 });
      expect(paged.map((row) => row.id)).toEqual([january.id]);

      const otherOrgId = await createTestOrganization(tx, uniqueSuffix());
      expect(await listPriceVersions(tx, { organizationId: otherOrgId })).toEqual([]);
    });
  });

  it("matches an exact scope, treating a null channel/location as its own scope", async () => {
    await inRollback(client.db, async (tx) => {
      const anyAny = await createTestPriceVersion(tx, orgId, {
        productVariantId: variantId,
        sourceScenarioId: scenarioId,
      });
      const byChannel = await createTestPriceVersion(
        tx,
        orgId,
        { productVariantId: variantId, sourceScenarioId: scenarioId },
        { channelId },
      );
      const byLocation = await createTestPriceVersion(
        tx,
        orgId,
        { productVariantId: variantId, sourceScenarioId: scenarioId },
        { locationId },
      );

      const nullScope = await listPriceVersionsForScope(tx, {
        organizationId: orgId,
        productVariantId: variantId,
        locationId: null,
        channelId: null,
      });
      expect(nullScope.map((row) => row.id)).toEqual([anyAny.id]);

      const channelScope = await listPriceVersionsForScope(tx, {
        organizationId: orgId,
        productVariantId: variantId,
        locationId: null,
        channelId,
      });
      expect(channelScope.map((row) => row.id)).toEqual([byChannel.id]);

      const locationScope = await listPriceVersionsForScope(tx, {
        organizationId: orgId,
        productVariantId: variantId,
        locationId,
        channelId: null,
      });
      expect(locationScope.map((row) => row.id)).toEqual([byLocation.id]);
    });
  });

  it("scopes the scope history to one product variant, oldest window first", async () => {
    await inRollback(client.db, async (tx) => {
      const late = await createTestPriceVersion(
        tx,
        orgId,
        { productVariantId: variantId, sourceScenarioId: scenarioId },
        { effectiveFrom: T("2026-07-01") },
      );
      const early = await createTestPriceVersion(
        tx,
        orgId,
        { productVariantId: variantId, sourceScenarioId: scenarioId },
        { effectiveFrom: T("2026-01-01"), effectiveTo: T("2026-07-01") },
      );

      const rows = await listPriceVersionsForScope(tx, {
        organizationId: orgId,
        productVariantId: variantId,
        locationId: null,
        channelId: null,
      });
      expect(rows.map((row) => row.id)).toEqual([early.id, late.id]);

      const otherProduct = await createTestProduct(tx, orgId);
      const otherVariant = await createTestProductVariant(tx, orgId, otherProduct.id);
      expect(
        await listPriceVersionsForScope(tx, {
          organizationId: orgId,
          productVariantId: otherVariant.id,
          locationId: null,
          channelId: null,
        }),
      ).toEqual([]);
    });
  });

  it("resolves the effective version on a half-open window (DEC-077)", async () => {
    await inRollback(client.db, async (tx) => {
      const first = await createTestPriceVersion(
        tx,
        orgId,
        { productVariantId: variantId, sourceScenarioId: scenarioId },
        { effectiveFrom: T("2026-01-01"), effectiveTo: T("2026-07-01") },
      );
      const second = await createTestPriceVersion(
        tx,
        orgId,
        { productVariantId: variantId, sourceScenarioId: scenarioId },
        { effectiveFrom: T("2026-07-01") },
      );

      const effective = (asOf: Date) =>
        findEffectivePriceVersion(tx, {
          organizationId: orgId,
          productVariantId: variantId,
          locationId: null,
          channelId: null,
          asOf,
        });

      // The `from` boundary is inclusive.
      expect((await effective(T("2026-01-01")))?.id).toBe(first.id);
      expect((await effective(T("2026-03-15")))?.id).toBe(first.id);
      // The `to` boundary is exclusive: it belongs to the next window.
      expect((await effective(T("2026-07-01")))?.id).toBe(second.id);
      // Before any window, or for a scope with nothing effective: no row.
      expect(await effective(T("2025-12-31"))).toBeUndefined();
    });
  });

  it("rejects an overlapping window in the same scope", async () => {
    await inRollback(client.db, async (tx) => {
      await createTestPriceVersion(
        tx,
        orgId,
        { productVariantId: variantId, sourceScenarioId: scenarioId },
        { effectiveFrom: T("2026-01-01"), effectiveTo: T("2026-07-01") },
      );

      // A different scenario id is a different row but the same scope
      // (`source_scenario_id` is not part of the version key), so the EXCLUDE
      // still sees the overlap and rejects the whole insert.
      const cause = await rejectionCause(
        createTestPriceVersion(
          tx,
          orgId,
          { productVariantId: variantId, sourceScenarioId: otherScenarioId },
          { effectiveFrom: T("2026-06-01"), effectiveTo: T("2026-12-31") },
        ),
      );
      expect(cause.message).toMatch(/price_version_no_overlap/);
    });
  });

  it("allows adjacent non-overlapping windows sharing a boundary", async () => {
    await inRollback(client.db, async (tx) => {
      const first = await createTestPriceVersion(
        tx,
        orgId,
        { productVariantId: variantId, sourceScenarioId: scenarioId },
        { effectiveFrom: T("2026-01-01"), effectiveTo: T("2026-07-01") },
      );
      const second = await createTestPriceVersion(
        tx,
        orgId,
        { productVariantId: variantId, sourceScenarioId: scenarioId },
        { effectiveFrom: T("2026-07-01") },
      );

      const rows = await listPriceVersionsForScope(tx, {
        organizationId: orgId,
        productVariantId: variantId,
        locationId: null,
        channelId: null,
      });
      expect(rows.map((row) => row.id)).toEqual([first.id, second.id]);
    });
  });

  it("treats a null location/channel as ONE scope: two null-scope rows overlap", async () => {
    await inRollback(client.db, async (tx) => {
      await createTestPriceVersion(tx, orgId, {
        productVariantId: variantId,
        sourceScenarioId: scenarioId,
      });

      // A null-channel row does not collide with a channel-specific one: those
      // are different scopes. Insert it before the expected failure.
      const channelScoped = await createTestPriceVersion(
        tx,
        orgId,
        { productVariantId: variantId, sourceScenarioId: scenarioId },
        { channelId, effectiveFrom: T("2026-02-01") },
      );
      expect(channelScoped.channelId).not.toBeNull();

      // Both rows mean "any location / any channel"; the sentinel makes them the
      // same scope, so the overlap is rejected rather than silently allowed.
      const cause = await rejectionCause(
        createTestPriceVersion(
          tx,
          orgId,
          { productVariantId: variantId, sourceScenarioId: scenarioId },
          { effectiveFrom: T("2026-02-01") },
        ),
      );
      expect(cause.message).toMatch(/price_version_no_overlap/);
    });
  });

  it("rejects a negative gross or net price", async () => {
    await inRollback(client.db, async (tx) => {
      const cause = await rejectionCause(
        createTestPriceVersion(
          tx,
          orgId,
          { productVariantId: variantId, sourceScenarioId: scenarioId },
          { grossPrice: "-1.0000" },
        ),
      );
      expect(cause.message).toMatch(/price_version_price_check/);
    });
  });

  it("rejects an empty/backwards effective window", async () => {
    await inRollback(client.db, async (tx) => {
      const cause = await rejectionCause(
        createTestPriceVersion(
          tx,
          orgId,
          { productVariantId: variantId, sourceScenarioId: scenarioId },
          { effectiveFrom: T("2026-07-01"), effectiveTo: T("2026-01-01") },
        ),
      );
      expect(cause.message).toMatch(/price_version_effective_range_check/);
    });
  });

  it("rejects a source scenario that does not exist", async () => {
    await inRollback(client.db, async (tx) => {
      const cause = await rejectionCause(
        createTestPriceVersion(tx, orgId, {
          productVariantId: variantId,
          sourceScenarioId: randomUUID(),
        }),
      );
      expect(cause.message).toMatch(/price_version_source_scenario_id_price_scenario_id_fk/);
    });
  });
});
