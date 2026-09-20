import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, type DbClient } from "../client";
import {
  calculationSnapshot,
  costCard,
  location,
  organization,
  product,
  productVariant,
} from "../schema";
import {
  createCalculationSnapshot,
  createCostCard,
  createSnapshotComponents,
  findCalculationSnapshot,
  findCostCard,
  listApprovedCostCardsForScope,
  listCalculationSnapshotsForCostCard,
  listSnapshotComponents,
  updateCostCard,
} from "./cost-card";
import {
  createTestChannel,
  createTestLocation,
  createTestOrganization,
  createTestProduct,
  createTestProductVariant,
  inRollback,
  rejectionCause,
  uniqueSuffix,
} from "./test-support";

const databaseUrl = process.env.DATABASE_URL;
const suffix = uniqueSuffix();

describe.skipIf(!databaseUrl)("cost-card repository", () => {
  let client: DbClient;
  let orgId: string;
  let locationId: string;
  let variantId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    orgId = await createTestOrganization(client.db, suffix);
    const loc = await createTestLocation(client.db, orgId);
    locationId = loc.id;
    const prod = await createTestProduct(client.db, orgId);
    const variant = await createTestProductVariant(client.db, orgId, prod.id);
    variantId = variant.id;
  });

  afterAll(async () => {
    if (client) {
      // Every integration test rolls back, so only the seeded master data persists.
      await client.db.delete(productVariant).where(eq(productVariant.organizationId, orgId));
      await client.db.delete(product).where(eq(product.organizationId, orgId));
      await client.db.delete(location).where(eq(location.organizationId, orgId));
      await client.db.delete(organization).where(eq(organization.id, orgId));
      await client.close();
    }
  });

  const scope = () => ({ organizationId: orgId, productVariantId: variantId, locationId });

  it("round-trips a cost card through create and find", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createCostCard(tx, {
        ...scope(),
        costSelectionPolicy: "latest_approved_price",
      });
      expect(created.id).toBeDefined();
      expect(created.state).toBe("draft");
      expect(created.channelId).toBeNull();

      const found = await findCostCard(tx, created.id);
      expect(found?.id).toBe(created.id);
      expect(found?.costSelectionPolicy).toBe("latest_approved_price");
    });
  });

  it("creates a card with an explicit null channel id", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createCostCard(tx, {
        ...scope(),
        channelId: null,
        recipeVersionId: null,
        costSelectionPolicy: "moving_weighted_average",
      });
      expect(created.channelId).toBeNull();
      expect(created.recipeVersionId).toBeNull();
    });
  });

  it("applies an approval patch (state, approver and timestamp)", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createCostCard(tx, {
        ...scope(),
        costSelectionPolicy: "latest_approved_price",
      });
      const approver = randomUUID();
      const approvedAt = new Date("2026-03-01T12:00:00.000Z");

      const approved = await updateCostCard(tx, created.id, {
        state: "approved",
        approvedBy: approver,
        approvedAt,
      });
      expect(approved.state).toBe("approved");
      expect(approved.approvedBy).toBe(approver);
      expect(approved.approvedAt?.toISOString()).toBe(approvedAt.toISOString());
    });
  });

  it("rejects approving a card without an approver and timestamp", async () => {
    await inRollback(client.db, async (tx) => {
      const created = await createCostCard(tx, {
        ...scope(),
        costSelectionPolicy: "latest_approved_price",
      });
      const cause = await rejectionCause(updateCostCard(tx, created.id, { state: "approved" }));
      expect(cause.message).toMatch(/cost_card_approval_check/);
    });
  });

  it("lists only approved cards in the exact scope", async () => {
    await inRollback(client.db, async (tx) => {
      const otherLocation = await createTestLocation(tx, orgId);
      const channel = await createTestChannel(tx, orgId);
      const approve = (id: string) =>
        updateCostCard(tx, id, {
          state: "approved",
          approvedBy: randomUUID(),
          approvedAt: new Date(),
        });

      const approvedNullChannel = await createCostCard(tx, {
        ...scope(),
        costSelectionPolicy: "latest_approved_price",
      });
      await approve(approvedNullChannel.id);

      const draft = await createCostCard(tx, {
        ...scope(),
        costSelectionPolicy: "latest_approved_price",
      });

      const approvedOtherChannel = await createCostCard(tx, {
        ...scope(),
        channelId: channel.id,
        costSelectionPolicy: "latest_approved_price",
      });
      await approve(approvedOtherChannel.id);

      const approvedOtherLocation = await createCostCard(tx, {
        organizationId: orgId,
        productVariantId: variantId,
        locationId: otherLocation.id,
        costSelectionPolicy: "latest_approved_price",
      });
      await approve(approvedOtherLocation.id);

      const inScope = await listApprovedCostCardsForScope(tx, scope());
      expect(inScope.map((card) => card.id)).toEqual([approvedNullChannel.id]);
      expect(inScope.map((card) => card.id)).not.toContain(draft.id);

      const otherChannel = await listApprovedCostCardsForScope(tx, {
        ...scope(),
        channelId: channel.id,
      });
      expect(otherChannel.map((card) => card.id)).toEqual([approvedOtherChannel.id]);
    });
  });

  it("returns the single approved card in scope and excludes drafts", async () => {
    await inRollback(client.db, async (tx) => {
      const approved = await createCostCard(tx, {
        ...scope(),
        costSelectionPolicy: "latest_approved_price",
      });
      await updateCostCard(tx, approved.id, {
        state: "approved",
        approvedBy: randomUUID(),
        approvedAt: new Date(),
      });

      const firstDraft = await createCostCard(tx, {
        ...scope(),
        costSelectionPolicy: "latest_approved_price",
      });
      const secondDraft = await createCostCard(tx, {
        ...scope(),
        costSelectionPolicy: "latest_approved_price",
      });
      // Distinct, newer calculations on the drafts must not affect the result:
      // only the approval state (and the scope) is queried.
      await tx
        .update(costCard)
        .set({ calculatedAt: new Date("2026-02-01T00:00:00.000Z") })
        .where(eq(costCard.id, firstDraft.id));
      await tx
        .update(costCard)
        .set({ calculatedAt: new Date("2026-03-01T00:00:00.000Z") })
        .where(eq(costCard.id, secondDraft.id));

      const listed = await listApprovedCostCardsForScope(tx, scope());
      expect(listed.map((card) => card.id)).toEqual([approved.id]);
      expect(listed.map((card) => card.id)).not.toContain(firstDraft.id);
      expect(listed.map((card) => card.id)).not.toContain(secondDraft.id);
    });
  });

  it("rejects a second approved card in the same channel scope", async () => {
    await inRollback(client.db, async (tx) => {
      const channel = await createTestChannel(tx, orgId);
      const first = await createCostCard(tx, {
        ...scope(),
        channelId: channel.id,
        costSelectionPolicy: "latest_approved_price",
      });
      const second = await createCostCard(tx, {
        ...scope(),
        channelId: channel.id,
        costSelectionPolicy: "latest_approved_price",
      });
      await updateCostCard(tx, first.id, {
        state: "approved",
        approvedBy: randomUUID(),
        approvedAt: new Date(),
      });

      const cause = await rejectionCause(
        updateCostCard(tx, second.id, {
          state: "approved",
          approvedBy: randomUUID(),
          approvedAt: new Date(),
        }),
      );
      expect(cause.message).toMatch(/cost_card_approved_scope_key/);
    });
  });

  it("rejects a second company-wide approved card (null channel, NULLS NOT DISTINCT)", async () => {
    await inRollback(client.db, async (tx) => {
      const first = await createCostCard(tx, {
        ...scope(),
        channelId: null,
        costSelectionPolicy: "latest_approved_price",
      });
      const second = await createCostCard(tx, {
        ...scope(),
        channelId: null,
        costSelectionPolicy: "latest_approved_price",
      });
      await updateCostCard(tx, first.id, {
        state: "approved",
        approvedBy: randomUUID(),
        approvedAt: new Date(),
      });

      const cause = await rejectionCause(
        updateCostCard(tx, second.id, {
          state: "approved",
          approvedBy: randomUUID(),
          approvedAt: new Date(),
        }),
      );
      expect(cause.message).toMatch(/cost_card_approved_scope_key/);
    });
  });

  it("installs the 0015/0016 cost-card and snapshot indexes", async () => {
    const { rows } = await client.pool.query<{ indexname: string }>(
      "select indexname from pg_indexes where indexname = any($1::text[])",
      [["cost_card_approved_scope_key", "calculation_snapshot_cost_card_idx"]],
    );
    expect(rows.map((row) => row.indexname).sort()).toEqual([
      "calculation_snapshot_cost_card_idx",
      "cost_card_approved_scope_key",
    ]);
  });

  it("inserts a snapshot with components and reads them back", async () => {
    await inRollback(client.db, async (tx) => {
      const card = await createCostCard(tx, {
        ...scope(),
        costSelectionPolicy: "latest_approved_price",
      });
      const asOf = new Date("2026-03-01T00:00:00.000Z");
      const snapshot = await createCalculationSnapshot(tx, {
        organizationId: orgId,
        costCardId: card.id,
        costSelectionPolicy: "latest_approved_price",
        asOf,
        ruleVersion: "calc-v1",
        totals: { totalCost: "42.0000" },
      });
      expect(snapshot.costCardId).toBe(card.id);
      expect(snapshot.priceScenarioId).toBeNull();
      expect(snapshot.roundingMethod).toBe("HALF_UP");

      const components = await createSnapshotComponents(tx, [
        {
          snapshotId: snapshot.id,
          componentKind: "ingredient",
          amount: "12.3400",
          roundingBoundary: "B2",
          provenance: { source: "supplier_price" },
        },
        {
          snapshotId: snapshot.id,
          componentKind: "direct_labor",
          amount: "4.5000",
        },
      ]);
      expect(components).toHaveLength(2);

      const readBack = await listSnapshotComponents(tx, snapshot.id);
      expect(readBack.map((component) => component.componentKind).sort()).toEqual([
        "direct_labor",
        "ingredient",
      ]);

      expect((await findCalculationSnapshot(tx, snapshot.id))?.id).toBe(snapshot.id);
      expect(
        (await listCalculationSnapshotsForCostCard(tx, card.id)).map((row) => row.id),
      ).toContain(snapshot.id);
    });
  });

  it("returns an empty list without issuing SQL for no components", async () => {
    await inRollback(client.db, async (tx) => {
      expect(await createSnapshotComponents(tx, [])).toEqual([]);
    });
  });

  it("rejects a snapshot with both parents set", async () => {
    await inRollback(client.db, async (tx) => {
      const card = await createCostCard(tx, {
        ...scope(),
        costSelectionPolicy: "latest_approved_price",
      });
      const cause = await rejectionCause(
        createCalculationSnapshot(tx, {
          organizationId: orgId,
          costCardId: card.id,
          priceScenarioId: randomUUID(),
          costSelectionPolicy: "latest_approved_price",
          asOf: new Date(),
          ruleVersion: "calc-v1",
          totals: {},
        }),
      );
      expect(cause.message).toMatch(/calculation_snapshot_source_check/);
    });
  });

  it("rejects a snapshot with neither parent set", async () => {
    await inRollback(client.db, async (tx) => {
      const cause = await rejectionCause(
        createCalculationSnapshot(tx, {
          organizationId: orgId,
          costSelectionPolicy: "latest_approved_price",
          asOf: new Date(),
          ruleVersion: "calc-v1",
          totals: {},
        }),
      );
      expect(cause.message).toMatch(/calculation_snapshot_source_check/);
    });
  });

  it("refuses to update an immutable calculation snapshot", async () => {
    await inRollback(client.db, async (tx) => {
      const card = await createCostCard(tx, {
        ...scope(),
        costSelectionPolicy: "latest_approved_price",
      });
      const snapshot = await createCalculationSnapshot(tx, {
        organizationId: orgId,
        costCardId: card.id,
        costSelectionPolicy: "latest_approved_price",
        asOf: new Date(),
        ruleVersion: "calc-v1",
        totals: {},
      });
      const cause = await rejectionCause(
        tx
          .update(calculationSnapshot)
          .set({ ruleVersion: "calc-v2" })
          .where(eq(calculationSnapshot.id, snapshot.id)),
      );
      expect(cause.message).toMatch(/append-only/);
    });
  });

  it("rejects an unknown snapshot component kind", async () => {
    await inRollback(client.db, async (tx) => {
      const card = await createCostCard(tx, {
        ...scope(),
        costSelectionPolicy: "latest_approved_price",
      });
      const snapshot = await createCalculationSnapshot(tx, {
        organizationId: orgId,
        costCardId: card.id,
        costSelectionPolicy: "latest_approved_price",
        asOf: new Date(),
        ruleVersion: "calc-v1",
        totals: {},
      });
      const cause = await rejectionCause(
        createSnapshotComponents(tx, [{ snapshotId: snapshot.id, componentKind: "not_a_kind" }]),
      );
      expect(cause.message).toMatch(/snapshot_component_kind_check/);
    });
  });
});
