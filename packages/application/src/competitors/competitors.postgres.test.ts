import { DomainError } from "@aquarela/domain";
import {
  competitor as competitorTable,
  competitorObservation as competitorObservationTable,
  createDb,
  type DatabaseTransaction,
  type DbClient,
  type NodeDatabase,
} from "@aquarela/persistence";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresCompetitorStore } from "./postgres-store";
import { recordCompetitorObservation } from "./record-competitor-observation";
import { registerCompetitor } from "./register-competitor";
import { reviewCompetitorObservation } from "./review-competitor-observation";

const databaseUrl = process.env.DATABASE_URL;
const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
const OBSERVED_AT = "2026-03-05T09:30:00.000Z";

class RollbackSignal extends Error {}

/** Runs `fn` in a transaction and always rolls it back (the register rows stay clean). */
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

describe.skipIf(!databaseUrl)("competitor observations against PostgreSQL", () => {
  let client: DbClient;
  let orgId: string;
  let otherOrgId: string;
  let actorId: string;

  beforeAll(async () => {
    client = createDb(databaseUrl!);
    const first = await client.pool.query<{ id: string }>(
      "insert into organization (legal_name) values ($1) returning id",
      [`Competitor IT ${suffix}`],
    );
    orgId = first.rows[0]!.id;
    const second = await client.pool.query<{ id: string }>(
      "insert into organization (legal_name) values ($1) returning id",
      [`Competitor IT other ${suffix}`],
    );
    otherOrgId = second.rows[0]!.id;
    actorId = randomUUID();
  });

  afterAll(async () => {
    if (client) {
      await client.pool.query("delete from organization where id = any($1::uuid[])", [
        [orgId, otherOrgId],
      ]);
      await client.close();
    }
  });

  it("registers idempotently on (organization, name), scoped by organization", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresCompetitorStore(tx);
      const first = await registerCompetitor(store, {
        organizationId: orgId,
        actorId,
        name: `Rival ${suffix}`,
      });
      const second = await registerCompetitor(store, {
        organizationId: orgId,
        actorId,
        name: `Rival ${suffix}`,
      });
      expect(second.id).toBe(first.id);

      // The same name is a distinct row in another organization.
      const other = await registerCompetitor(store, {
        organizationId: otherOrgId,
        actorId,
        name: `Rival ${suffix}`,
      });
      expect(other.id).not.toBe(first.id);

      // A raw duplicate insert races the unique key rather than duplicating.
      await expect(
        tx.insert(competitorTable).values({ organizationId: orgId, name: `Rival ${suffix}` }),
      ).rejects.toThrow();
    });
  });

  it("opens an observation pending and reviews it once", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresCompetitorStore(tx);
      const competitor = await registerCompetitor(store, {
        organizationId: orgId,
        actorId,
        name: `Review Rival ${suffix}`,
      });
      const observation = await recordCompetitorObservation(store, {
        organizationId: orgId,
        actorId,
        competitorId: competitor.id,
        observedAt: OBSERVED_AT,
        source: "menu photo",
        externalName: "Flat White",
        price: "42.5",
        currency: "NOK",
      });
      expect(observation.reviewStatus).toBe("pending");
      expect(observation.price).toBe("42.5000");

      const reviewed = await reviewCompetitorObservation(store, {
        organizationId: orgId,
        actorId,
        observationId: observation.id,
        decision: "reviewed",
      });
      expect(reviewed.reviewStatus).toBe("reviewed");
      expect(reviewed.reviewedBy).toBe(actorId);
      expect(reviewed.reviewedAt).not.toBeNull();

      await expect(
        reviewCompetitorObservation(store, {
          organizationId: orgId,
          actorId: randomUUID(),
          observationId: observation.id,
          decision: "rejected",
        }),
      ).rejects.toBeInstanceOf(DomainError);
    });
  });

  it("never reads or reviews another organization's observation", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresCompetitorStore(tx);
      const competitor = await registerCompetitor(store, {
        organizationId: orgId,
        actorId,
        name: `Scoped Rival ${suffix}`,
      });
      const observation = await recordCompetitorObservation(store, {
        organizationId: orgId,
        actorId,
        competitorId: competitor.id,
        observedAt: OBSERVED_AT,
        source: "note",
        externalName: "Flat White",
      });

      const rows = await store.listObservations({ organizationId: otherOrgId, status: "all" });
      expect(rows).toHaveLength(0);

      await expect(
        reviewCompetitorObservation(store, {
          organizationId: otherOrgId,
          actorId,
          observationId: observation.id,
          decision: "reviewed",
        }),
      ).rejects.toBeInstanceOf(DomainError);
    });
  });

  it("rejects a non-pending observation without a reviewer and timestamp at the database", async () => {
    // Each raw insert runs in its own rolled-back transaction: a constraint
    // violation aborts the surrounding transaction, so the checks cannot share one.
    const seedCompetitorRow = async (tx: DatabaseTransaction): Promise<string> => {
      const rows = await tx
        .insert(competitorTable)
        .values({ organizationId: orgId, name: `Check Rival ${randomUUID()}` })
        .returning();
      return rows[0]!.id;
    };

    await inRollback(client.db, async (tx) => {
      // A pending row needs neither reviewer nor timestamp.
      const competitorId = await seedCompetitorRow(tx);
      await expect(
        tx.insert(competitorObservationTable).values({
          organizationId: orgId,
          competitorId,
          observedAt: new Date(OBSERVED_AT),
          source: "note",
          externalName: "Flat White",
        }),
      ).resolves.toBeDefined();
    });

    await inRollback(client.db, async (tx) => {
      // A non-pending row without them violates the review-gate check.
      const competitorId = await seedCompetitorRow(tx);
      await expect(
        tx.insert(competitorObservationTable).values({
          organizationId: orgId,
          competitorId,
          observedAt: new Date(OBSERVED_AT),
          source: "note",
          externalName: "Flat White",
          reviewStatus: "reviewed",
        }),
      ).rejects.toThrow();
    });

    await inRollback(client.db, async (tx) => {
      // With both it is accepted.
      const competitorId = await seedCompetitorRow(tx);
      await expect(
        tx.insert(competitorObservationTable).values({
          organizationId: orgId,
          competitorId,
          observedAt: new Date(OBSERVED_AT),
          source: "note",
          externalName: "Flat White",
          reviewStatus: "reviewed",
          reviewedBy: actorId,
          reviewedAt: new Date(OBSERVED_AT),
        }),
      ).resolves.toBeDefined();
    });

    await inRollback(client.db, async (tx) => {
      // A negative price violates the price check.
      const competitorId = await seedCompetitorRow(tx);
      await expect(
        tx.insert(competitorObservationTable).values({
          organizationId: orgId,
          competitorId,
          observedAt: new Date(OBSERVED_AT),
          source: "note",
          externalName: "Flat White",
          price: "-1",
        }),
      ).rejects.toThrow();
    });
  });
});
