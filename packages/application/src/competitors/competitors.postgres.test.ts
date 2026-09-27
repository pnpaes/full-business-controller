import { DomainError } from "@aquarela/domain";
import {
  competitor as competitorTable,
  competitorObservation as competitorObservationTable,
  competitorSource as competitorSourceTable,
  createDb,
  type DatabaseTransaction,
  type DbClient,
  type NodeDatabase,
} from "@aquarela/persistence";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { approveCompetitorSourceTerms } from "./decide-competitor-source-terms";
import { deactivateCompetitorSource } from "./deactivate-competitor-source";
import { createPostgresCompetitorStore } from "./postgres-store";
import { recordCompetitorObservation } from "./record-competitor-observation";
import { registerCompetitor } from "./register-competitor";
import { registerCompetitorSource } from "./register-competitor-source";
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

  it("registers a manual source pending and an automated source already approved", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresCompetitorStore(tx);
      const manual = await registerCompetitorSource(store, {
        organizationId: orgId,
        actorId,
        competitorName: `Manual ${suffix}`,
        sourceType: "website",
        urlOrIdentifier: `https://manual.example/${suffix}`,
        collectionMode: "manual",
        activeFrom: "2026-09-01",
      });
      expect(manual.termsStatus).toBe("pending");
      expect(manual.approvedBy).toBeNull();

      const automated = await registerCompetitorSource(store, {
        organizationId: orgId,
        actorId,
        competitorName: `Auto ${suffix}`,
        sourceType: "wolt",
        urlOrIdentifier: `https://wolt.example/${suffix}`,
        collectionMode: "automated",
        activeFrom: "2026-09-01",
      });
      expect(automated.collectionMode).toBe("automated");
      expect(automated.termsStatus).toBe("approved");
      expect(automated.approvedBy).toBe(actorId);
      expect(automated.approvedAt).not.toBeNull();

      // A duplicate URL is refused at the application (and by the unique key).
      await expect(
        registerCompetitorSource(store, {
          organizationId: orgId,
          actorId,
          competitorName: `Manual ${suffix}`,
          sourceType: "website",
          urlOrIdentifier: `https://manual.example/${suffix}`,
          collectionMode: "manual",
          activeFrom: "2026-09-01",
        }),
      ).rejects.toBeInstanceOf(DomainError);

      // The organization dimension scopes the URL uniqueness.
      const other = await registerCompetitorSource(store, {
        organizationId: otherOrgId,
        actorId,
        competitorName: `Manual ${suffix}`,
        sourceType: "website",
        urlOrIdentifier: `https://manual.example/${suffix}`,
        collectionMode: "manual",
        activeFrom: "2026-09-01",
      });
      expect(other.id).not.toBe(manual.id);
    });
  });

  it("enforces the source invariants at the database", async () => {
    // Each raw insert runs in its own rolled-back transaction: a constraint
    // violation aborts the surrounding transaction.
    await inRollback(client.db, async (tx) => {
      // An automated source with pending terms violates the automation check.
      await expect(
        tx.insert(competitorSourceTable).values({
          organizationId: orgId,
          competitorName: "Raw Auto",
          sourceType: "website",
          urlOrIdentifier: `https://raw-auto.example/${randomUUID()}`,
          collectionMode: "automated",
          termsStatus: "pending",
          activeFrom: "2026-09-01",
        }),
      ).rejects.toThrow();

      // A non-pending terms status without an approver/instant is refused.
      await expect(
        tx.insert(competitorSourceTable).values({
          organizationId: orgId,
          competitorName: "Raw Approved",
          sourceType: "website",
          urlOrIdentifier: `https://raw-approved.example/${randomUUID()}`,
          collectionMode: "manual",
          termsStatus: "approved",
          activeFrom: "2026-09-01",
        }),
      ).rejects.toThrow();

      // A blank URL or competitor name is refused.
      await expect(
        tx.insert(competitorSourceTable).values({
          organizationId: orgId,
          competitorName: " ",
          sourceType: "website",
          urlOrIdentifier: `https://raw-blank.example/${randomUUID()}`,
          collectionMode: "manual",
          activeFrom: "2026-09-01",
        }),
      ).rejects.toThrow();
    });
  });

  it("decides terms, refuses rejecting an automated source, and deactivates", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresCompetitorStore(tx);
      const manual = await registerCompetitorSource(store, {
        organizationId: orgId,
        actorId,
        competitorName: `Decide ${suffix}`,
        sourceType: "website",
        urlOrIdentifier: `https://decide.example/${suffix}`,
        collectionMode: "manual",
        activeFrom: "2026-09-01",
      });

      const approved = await approveCompetitorSourceTerms(store, {
        organizationId: orgId,
        actorId,
        sourceId: manual.id,
      });
      expect(approved.termsStatus).toBe("approved");
      expect(approved.approvedBy).toBe(actorId);
      expect(approved.approvedAt).not.toBeNull();

      // A foreign-organization decision is a NotFound (surfaced as the domain's
      // NotFoundError, which extends DomainError).
      await expect(
        approveCompetitorSourceTerms(store, {
          organizationId: otherOrgId,
          actorId,
          sourceId: manual.id,
        }),
      ).rejects.toBeInstanceOf(DomainError);

      await expect(
        deactivateCompetitorSource(store, {
          organizationId: orgId,
          actorId,
          sourceId: manual.id,
          activeTo: "2026-08-01",
        }),
      ).rejects.toBeInstanceOf(DomainError);

      const ended = await deactivateCompetitorSource(store, {
        organizationId: orgId,
        actorId,
        sourceId: manual.id,
        activeTo: "2026-12-31",
      });
      expect(ended.activeTo).toBe("2026-12-31");
    });
  });

  it("links an observation to a source and refuses a foreign source", async () => {
    await inRollback(client.db, async (tx) => {
      const store = createPostgresCompetitorStore(tx);
      const competitor = await registerCompetitor(store, {
        organizationId: orgId,
        actorId,
        name: `Sourced Rival ${suffix}`,
      });
      const source = await registerCompetitorSource(store, {
        organizationId: orgId,
        actorId,
        competitorName: `Sourced Rival ${suffix}`,
        competitorId: competitor.id,
        sourceType: "website",
        urlOrIdentifier: `https://sourced.example/${suffix}`,
        collectionMode: "automated",
        activeFrom: "2026-09-01",
      });

      const observation = await recordCompetitorObservation(store, {
        organizationId: orgId,
        actorId,
        competitorId: competitor.id,
        observedAt: OBSERVED_AT,
        source: "website",
        externalName: "Flat White",
        competitorSourceId: source.id,
        captureMethod: "automated",
        productCategory: "coffee",
        season: "autumn",
        provenance: { url: "https://sourced.example/menu" },
      });
      expect(observation.competitorSourceId).toBe(source.id);
      expect(observation.captureMethod).toBe("automated");
      expect(observation.provenance).toMatchObject({ url: "https://sourced.example/menu" });

      // A source in another organization is refused before the write.
      const foreignCompetitor = await registerCompetitor(store, {
        organizationId: otherOrgId,
        actorId,
        name: `Foreign Rival ${suffix}`,
      });
      await expect(
        recordCompetitorObservation(store, {
          organizationId: otherOrgId,
          actorId,
          competitorId: foreignCompetitor.id,
          observedAt: OBSERVED_AT,
          source: "website",
          externalName: "Flat White",
          competitorSourceId: source.id,
        }),
      ).rejects.toBeInstanceOf(DomainError);
    });
  });
});
