import { DomainError, NotFoundError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { compareCompetitorPrices } from "./compare-competitor-prices";
import { listCompetitorObservations } from "./list-competitor-observations";
import { listCompetitors } from "./list-competitors";
import { recordCompetitorObservation } from "./record-competitor-observation";
import { registerCompetitor } from "./register-competitor";
import { reviewCompetitorObservation } from "./review-competitor-observation";
import { FakeCompetitorStore } from "./test-support";

const ORG = "org-1";
const OTHER_ORG = "org-2";
const ACTOR = "actor-1";
const OBSERVED_AT = "2026-03-05T09:30:00.000Z";

describe("registerCompetitor", () => {
  it("registers a competitor and audits it", async () => {
    const store = new FakeCompetitorStore();
    const competitor = await registerCompetitor(store, {
      organizationId: ORG,
      actorId: ACTOR,
      name: "  Rival Cafe  ",
    });

    expect(competitor.name).toBe("Rival Cafe");
    expect(store.audits).toHaveLength(1);
    expect(store.audits[0]?.action).toBe("competitors.competitor.registered");
  });

  it("is idempotent on (organization, name) and writes no second fact", async () => {
    const store = new FakeCompetitorStore();
    const first = await registerCompetitor(store, {
      organizationId: ORG,
      actorId: ACTOR,
      name: "Rival Cafe",
      notes: "first",
    });
    const second = await registerCompetitor(store, {
      organizationId: ORG,
      actorId: ACTOR,
      name: "Rival Cafe",
      notes: "ignored",
    });

    expect(second.id).toBe(first.id);
    expect(second.notes).toBe("first");
    expect(store.competitors.size).toBe(1);
    expect(store.audits).toHaveLength(1);
  });

  it("scopes idempotency to the organization", async () => {
    const store = new FakeCompetitorStore();
    const a = await registerCompetitor(store, { organizationId: ORG, actorId: ACTOR, name: "X" });
    const b = await registerCompetitor(store, {
      organizationId: OTHER_ORG,
      actorId: ACTOR,
      name: "X",
    });

    expect(b.id).not.toBe(a.id);
    expect(store.competitors.size).toBe(2);
  });

  it("rejects a blank name", async () => {
    const store = new FakeCompetitorStore();
    await expect(
      registerCompetitor(store, { organizationId: ORG, actorId: ACTOR, name: "   " }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(store.audits).toHaveLength(0);
  });
});

describe("recordCompetitorObservation", () => {
  async function withCompetitor(): Promise<{ store: FakeCompetitorStore; competitorId: string }> {
    const store = new FakeCompetitorStore();
    const competitor = await registerCompetitor(store, {
      organizationId: ORG,
      actorId: ACTOR,
      name: "Rival Cafe",
    });
    return { store, competitorId: competitor.id };
  }

  it("records a pending observation, trims its text and audits it", async () => {
    const { store, competitorId } = await withCompetitor();
    const observation = await recordCompetitorObservation(store, {
      organizationId: ORG,
      actorId: ACTOR,
      competitorId,
      observedAt: OBSERVED_AT,
      source: "  menu photo  ",
      externalName: "  Flat White  ",
      price: "42.5",
      currency: "nok",
    });

    expect(observation.reviewStatus).toBe("pending");
    expect(observation.source).toBe("menu photo");
    expect(observation.externalName).toBe("Flat White");
    expect(observation.price).toBe("42.5000");
    expect(observation.currency).toBe("NOK");
    expect(observation.reviewedBy).toBeNull();
    expect(observation.reviewedAt).toBeNull();
    expect(store.audits.at(-1)?.action).toBe("competitors.observation.recorded");
  });

  it("rejects a competitor that is not in the organization", async () => {
    const { store } = await withCompetitor();
    await expect(
      recordCompetitorObservation(store, {
        organizationId: ORG,
        actorId: ACTOR,
        competitorId: "does-not-exist",
        observedAt: OBSERVED_AT,
        source: "note",
        externalName: "Flat White",
      }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(
      store.audits.filter((a) => a.action === "competitors.observation.recorded"),
    ).toHaveLength(0);
  });

  it("rejects a negative price", async () => {
    const { store, competitorId } = await withCompetitor();
    await expect(
      recordCompetitorObservation(store, {
        organizationId: ORG,
        actorId: ACTOR,
        competitorId,
        observedAt: OBSERVED_AT,
        source: "note",
        externalName: "Flat White",
        price: "-1",
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("rejects a malformed currency", async () => {
    const { store, competitorId } = await withCompetitor();
    await expect(
      recordCompetitorObservation(store, {
        organizationId: ORG,
        actorId: ACTOR,
        competitorId,
        observedAt: OBSERVED_AT,
        source: "note",
        externalName: "Flat White",
        currency: "NO",
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("rejects a non-instant observedAt and a blank externalName", async () => {
    const { store, competitorId } = await withCompetitor();
    await expect(
      recordCompetitorObservation(store, {
        organizationId: ORG,
        actorId: ACTOR,
        competitorId,
        observedAt: "2026-03-05",
        source: "note",
        externalName: "Flat White",
      }),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      recordCompetitorObservation(store, {
        organizationId: ORG,
        actorId: ACTOR,
        competitorId,
        observedAt: OBSERVED_AT,
        source: "note",
        externalName: "  ",
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});

describe("reviewCompetitorObservation (the DEC-020 gate)", () => {
  async function seedPending(): Promise<{ store: FakeCompetitorStore; observationId: string }> {
    const store = new FakeCompetitorStore();
    const competitor = store.seedCompetitor({ organizationId: ORG, name: "Rival Cafe" });
    const observation = store.seedObservation({
      organizationId: ORG,
      competitorId: competitor.id,
      observedAt: OBSERVED_AT,
      externalName: "Flat White",
    });
    return { store, observationId: observation.id };
  }

  it("moves pending → reviewed once, with a named reviewer and a timestamp", async () => {
    const { store, observationId } = await seedPending();
    const reviewed = await reviewCompetitorObservation(store, {
      organizationId: ORG,
      actorId: ACTOR,
      observationId,
      decision: "reviewed",
    });

    expect(reviewed.reviewStatus).toBe("reviewed");
    expect(reviewed.reviewedBy).toBe(ACTOR);
    expect(reviewed.reviewedAt).not.toBeNull();
    expect(store.audits.at(-1)?.action).toBe("competitors.observation.reviewed");
  });

  it("moves pending → rejected once", async () => {
    const { store, observationId } = await seedPending();
    const rejected = await reviewCompetitorObservation(store, {
      organizationId: ORG,
      actorId: ACTOR,
      observationId,
      decision: "rejected",
    });

    expect(rejected.reviewStatus).toBe("rejected");
    expect(store.audits.at(-1)?.action).toBe("competitors.observation.rejected");
  });

  it("rejects a second decision with a message-only DomainError and no new fact", async () => {
    const { store, observationId } = await seedPending();
    await reviewCompetitorObservation(store, {
      organizationId: ORG,
      actorId: ACTOR,
      observationId,
      decision: "reviewed",
    });
    const factsBefore = store.audits.length;

    await expect(
      reviewCompetitorObservation(store, {
        organizationId: ORG,
        actorId: "other-actor",
        observationId,
        decision: "rejected",
      }),
    ).rejects.toBeInstanceOf(DomainError);

    expect(store.observations.get(observationId)?.reviewStatus).toBe("reviewed");
    expect(store.audits).toHaveLength(factsBefore);
  });

  it("throws NotFoundError for an observation outside the organization", async () => {
    const { store, observationId } = await seedPending();
    await expect(
      reviewCompetitorObservation(store, {
        organizationId: OTHER_ORG,
        actorId: ACTOR,
        observationId,
        decision: "reviewed",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("the reads", () => {
  function seeded(): FakeCompetitorStore {
    const store = new FakeCompetitorStore();
    const competitor = store.seedCompetitor({ organizationId: ORG, name: "Rival Cafe" });
    store.seedObservation({
      organizationId: ORG,
      competitorId: competitor.id,
      observedAt: OBSERVED_AT,
      externalName: "reviewed one",
      reviewStatus: "reviewed",
    });
    store.seedObservation({
      organizationId: ORG,
      competitorId: competitor.id,
      observedAt: "2026-03-06T09:30:00.000Z",
      externalName: "pending one",
      reviewStatus: "pending",
    });
    store.seedObservation({
      organizationId: ORG,
      competitorId: competitor.id,
      observedAt: "2026-03-07T09:30:00.000Z",
      externalName: "rejected one",
      reviewStatus: "rejected",
    });
    return store;
  }

  it("defaults the observation read to reviewed (pending is not intelligence)", async () => {
    const store = seeded();
    const rows = await listCompetitorObservations(store, { organizationId: ORG });
    expect(rows.map((row) => row.externalName)).toEqual(["reviewed one"]);
  });

  it("exposes the pending rows only behind an explicit filter", async () => {
    const store = seeded();
    const pending = await listCompetitorObservations(store, {
      organizationId: ORG,
      status: "pending",
    });
    expect(pending.map((row) => row.externalName)).toEqual(["pending one"]);

    const all = await listCompetitorObservations(store, { organizationId: ORG, status: "all" });
    expect(all).toHaveLength(3);
  });

  it("rejects a bogus status filter", async () => {
    const store = seeded();
    await expect(
      listCompetitorObservations(store, { organizationId: ORG, status: "bogus" as never }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("never reads another organization's observations", async () => {
    const store = seeded();
    const rows = await listCompetitorObservations(store, {
      organizationId: OTHER_ORG,
      status: "all",
    });
    expect(rows).toHaveLength(0);
  });

  it("lists competitors organization-scoped, name-ascending", async () => {
    const store = new FakeCompetitorStore();
    store.seedCompetitor({ organizationId: ORG, name: "Zeta" });
    store.seedCompetitor({ organizationId: ORG, name: "Alpha" });
    store.seedCompetitor({ organizationId: OTHER_ORG, name: "Beta" });

    const rows = await listCompetitors(store, { organizationId: ORG });
    expect(rows.map((row) => row.name)).toEqual(["Alpha", "Zeta"]);
  });
});

describe("compareCompetitorPrices", () => {
  const ITEM = "item-1";
  const FROM = "2026-03-01T00:00:00.000Z";
  const TO = "2026-04-01T00:00:00.000Z";

  function seeded(): FakeCompetitorStore {
    const store = new FakeCompetitorStore();
    store.organizationCurrencies.set(ORG, "NOK");
    store.itemVariants.set(`${ORG}:${ITEM}`, "variant-1");
    store.effectivePrices.push({
      organizationId: ORG,
      productVariantId: "variant-1",
      priceVersionId: "price-1",
      netPrice: "40.0000",
      grossPrice: "50.0000",
      effectiveFrom: "2026-03-02T00:00:00.000Z",
      effectiveTo: null,
    });
    const competitor = store.seedCompetitor({ organizationId: ORG, name: "Rival Cafe" });
    store.seedObservation({
      organizationId: ORG,
      competitorId: competitor.id,
      observedAt: OBSERVED_AT,
      externalName: "Flat White",
      itemId: ITEM,
      price: "45.0000",
      currency: "NOK",
      reviewStatus: "reviewed",
    });
    return store;
  }

  it("pairs a reviewed observation with our effective price, basis and date gap", async () => {
    const store = seeded();
    const rows = await compareCompetitorPrices(store, { organizationId: ORG, from: FROM, to: TO });

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.comparable).toBe(true);
    if (!row.comparable) return;
    expect(row.competitorPrice).toBe("45.0000");
    expect(row.ourPrice).toBe("40.0000");
    expect(row.ourPriceBasis).toBe("net");
    expect(row.ourPriceEffectiveFrom).toBe("2026-03-02T00:00:00.000Z");
    expect(row.difference).toBe("5.0000");
    expect(row.ratio).toBe("1.125000");
    expect(row.dateGapDays).toBe(3);
  });

  it("reports an observation with no item_id as not comparable rather than matching by name", async () => {
    const store = seeded();
    const competitor = [...store.competitors.values()][0]!;
    store.seedObservation({
      organizationId: ORG,
      competitorId: competitor.id,
      observedAt: "2026-03-10T09:30:00.000Z",
      externalName: "Flat White",
      itemId: null,
      price: "45.0000",
      reviewStatus: "reviewed",
    });

    const rows = await compareCompetitorPrices(store, { organizationId: ORG, from: FROM, to: TO });
    const withNoItem = rows.find((row) => !row.comparable && row.reason === "no_item") ?? undefined;
    expect(withNoItem).toBeDefined();
  });

  it("excludes an unreviewed observation", async () => {
    const store = seeded();
    const competitor = [...store.competitors.values()][0]!;
    store.seedObservation({
      organizationId: ORG,
      competitorId: competitor.id,
      observedAt: "2026-03-11T09:30:00.000Z",
      externalName: "pending Flat White",
      itemId: ITEM,
      price: "45.0000",
      reviewStatus: "pending",
    });

    const rows = await compareCompetitorPrices(store, { organizationId: ORG, from: FROM, to: TO });
    expect(rows).toHaveLength(1);
    expect(rows.every((row) => row.comparable)).toBe(true);
  });

  it("reports no_effective_price when our price has no version at the instant", async () => {
    const store = new FakeCompetitorStore();
    store.organizationCurrencies.set(ORG, "NOK");
    store.itemVariants.set(`${ORG}:${ITEM}`, "variant-1");
    const competitor = store.seedCompetitor({ organizationId: ORG, name: "Rival Cafe" });
    store.seedObservation({
      organizationId: ORG,
      competitorId: competitor.id,
      observedAt: OBSERVED_AT,
      externalName: "Flat White",
      itemId: ITEM,
      price: "45.0000",
      reviewStatus: "reviewed",
    });

    const rows = await compareCompetitorPrices(store, { organizationId: ORG, from: FROM, to: TO });
    expect(rows[0]).toMatchObject({ comparable: false, reason: "no_effective_price" });
  });

  it("reports currency_mismatch rather than comparing across currencies", async () => {
    const store = seeded();
    store.observations.clear();
    const competitor = [...store.competitors.values()][0]!;
    store.seedObservation({
      organizationId: ORG,
      competitorId: competitor.id,
      observedAt: OBSERVED_AT,
      externalName: "Flat White",
      itemId: ITEM,
      price: "45.0000",
      currency: "SEK",
      reviewStatus: "reviewed",
    });

    const rows = await compareCompetitorPrices(store, { organizationId: ORG, from: FROM, to: TO });
    expect(rows[0]).toMatchObject({ comparable: false, reason: "currency_mismatch" });
  });
});
