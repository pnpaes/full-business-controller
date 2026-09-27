import { DomainError, NotFoundError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { compareCompetitorPrices } from "./compare-competitor-prices";
import {
  approveCompetitorSourceTerms,
  rejectCompetitorSourceTerms,
} from "./decide-competitor-source-terms";
import { deactivateCompetitorSource } from "./deactivate-competitor-source";
import { findCompetitorSource } from "./find-competitor-source";
import { listCompetitorObservations } from "./list-competitor-observations";
import { listCompetitorSources } from "./list-competitor-sources";
import { listCompetitors } from "./list-competitors";
import { recordCompetitorObservation } from "./record-competitor-observation";
import { registerCompetitor } from "./register-competitor";
import { registerCompetitorSource } from "./register-competitor-source";
import { reviewCompetitorObservation } from "./review-competitor-observation";
import { FakeCompetitorStore } from "./test-support";
import { updateCompetitorSource } from "./update-competitor-source";

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
    const observation = (await recordCompetitorObservation(store, {
      organizationId: ORG,
      actorId: ACTOR,
      competitorId,
      observedAt: OBSERVED_AT,
      source: "  menu photo  ",
      externalName: "  Flat White  ",
      price: "42.5",
      currency: "nok",
    }))!;

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

describe("competitor sources (ADR-0010 / DEC-143)", () => {
  const SOURCE_URL = "https://rival.example/menu";

  it("registers a manual source pending, trims its text and audits it", async () => {
    const store = new FakeCompetitorStore();
    const source = await registerCompetitorSource(store, {
      organizationId: ORG,
      actorId: ACTOR,
      competitorName: "  Rival Cafe  ",
      sourceType: "website",
      urlOrIdentifier: `  ${SOURCE_URL}  `,
      collectionMode: "manual",
      activeFrom: "2026-09-01",
    });

    expect(source.competitorName).toBe("Rival Cafe");
    expect(source.urlOrIdentifier).toBe(SOURCE_URL);
    expect(source.termsStatus).toBe("pending");
    expect(source.approvedBy).toBeNull();
    expect(source.approvedAt).toBeNull();
    expect(store.audits.map((a) => a.action)).toEqual(["competitors.source.registered"]);
  });

  it("registers an automated source already approved, recording the actor", async () => {
    const store = new FakeCompetitorStore();
    const source = await registerCompetitorSource(store, {
      organizationId: ORG,
      actorId: ACTOR,
      competitorName: "Rival Cafe",
      sourceType: "wolt",
      urlOrIdentifier: SOURCE_URL,
      collectionMode: "automated",
      activeFrom: "2026-09-01",
    });

    expect(source.collectionMode).toBe("automated");
    expect(source.termsStatus).toBe("approved");
    expect(source.approvedBy).toBe(ACTOR);
    expect(source.approvedAt).not.toBeNull();
    // The registration and the higher-bar terms approval are separate facts.
    expect(store.audits.map((a) => a.action)).toEqual([
      "competitors.source.registered",
      "competitors.source.terms_approved",
    ]);
  });

  it("rejects a duplicate url within the organization and scopes it per organization", async () => {
    const store = new FakeCompetitorStore();
    await registerCompetitorSource(store, {
      organizationId: ORG,
      actorId: ACTOR,
      competitorName: "Rival Cafe",
      sourceType: "website",
      urlOrIdentifier: SOURCE_URL,
      collectionMode: "manual",
      activeFrom: "2026-09-01",
    });
    await expect(
      registerCompetitorSource(store, {
        organizationId: ORG,
        actorId: ACTOR,
        competitorName: "Rival Cafe",
        sourceType: "website",
        urlOrIdentifier: SOURCE_URL,
        collectionMode: "manual",
        activeFrom: "2026-09-01",
      }),
    ).rejects.toBeInstanceOf(DomainError);

    const other = await registerCompetitorSource(store, {
      organizationId: OTHER_ORG,
      actorId: ACTOR,
      competitorName: "Rival Cafe",
      sourceType: "website",
      urlOrIdentifier: SOURCE_URL,
      collectionMode: "manual",
      activeFrom: "2026-09-01",
    });
    expect(other.organizationId).toBe(OTHER_ORG);
  });

  it("rejects a bad sourceType, collectionMode and activeFrom", async () => {
    const store = new FakeCompetitorStore();
    const base = {
      organizationId: ORG,
      actorId: ACTOR,
      competitorName: "Rival Cafe",
      sourceType: "website",
      urlOrIdentifier: SOURCE_URL,
      collectionMode: "manual",
      activeFrom: "2026-09-01",
    } as const;
    await expect(
      registerCompetitorSource(store, { ...base, sourceType: "bogus" }),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      registerCompetitorSource(store, { ...base, collectionMode: "bogus" }),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      registerCompetitorSource(store, { ...base, activeFrom: "2026-09" }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("approves and rejects terms on a pending manual source, with actor and instant", async () => {
    const store = new FakeCompetitorStore();
    const source = await registerCompetitorSource(store, {
      organizationId: ORG,
      actorId: ACTOR,
      competitorName: "Rival Cafe",
      sourceType: "website",
      urlOrIdentifier: SOURCE_URL,
      collectionMode: "manual",
      activeFrom: "2026-09-01",
    });

    const approved = await approveCompetitorSourceTerms(store, {
      organizationId: ORG,
      actorId: "owner-1",
      sourceId: source.id,
    });
    expect(approved.termsStatus).toBe("approved");
    expect(approved.approvedBy).toBe("owner-1");
    expect(approved.approvedAt).not.toBeNull();
    expect(store.audits.at(-1)?.action).toBe("competitors.source.terms_approved");

    const rejected = await rejectCompetitorSourceTerms(store, {
      organizationId: ORG,
      actorId: "owner-1",
      sourceId: source.id,
    });
    expect(rejected.termsStatus).toBe("rejected");
    expect(store.audits.at(-1)?.action).toBe("competitors.source.terms_rejected");
  });

  it("refuses to reject an automated source (deactivate instead)", async () => {
    const store = new FakeCompetitorStore();
    const source = await registerCompetitorSource(store, {
      organizationId: ORG,
      actorId: ACTOR,
      competitorName: "Rival Cafe",
      sourceType: "wolt",
      urlOrIdentifier: SOURCE_URL,
      collectionMode: "automated",
      activeFrom: "2026-09-01",
    });
    await expect(
      rejectCompetitorSourceTerms(store, {
        organizationId: ORG,
        actorId: ACTOR,
        sourceId: source.id,
      }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(store.sources.get(source.id)?.termsStatus).toBe("approved");
  });

  it("throws NotFoundError for a source outside the organization", async () => {
    const store = new FakeCompetitorStore();
    const source = store.seedCompetitorSource({
      organizationId: ORG,
      competitorName: "Rival Cafe",
      urlOrIdentifier: SOURCE_URL,
    });
    await expect(
      approveCompetitorSourceTerms(store, {
        organizationId: OTHER_ORG,
        actorId: ACTOR,
        sourceId: source.id,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      deactivateCompetitorSource(store, {
        organizationId: OTHER_ORG,
        actorId: ACTOR,
        sourceId: source.id,
        activeTo: "2026-12-31",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("deactivates by setting active_to, refusing a date not after active_from", async () => {
    const store = new FakeCompetitorStore();
    const source = await registerCompetitorSource(store, {
      organizationId: ORG,
      actorId: ACTOR,
      competitorName: "Rival Cafe",
      sourceType: "website",
      urlOrIdentifier: SOURCE_URL,
      collectionMode: "manual",
      activeFrom: "2026-09-01",
    });

    await expect(
      deactivateCompetitorSource(store, {
        organizationId: ORG,
        actorId: ACTOR,
        sourceId: source.id,
        activeTo: "2026-08-31",
      }),
    ).rejects.toBeInstanceOf(DomainError);

    const ended = await deactivateCompetitorSource(store, {
      organizationId: ORG,
      actorId: ACTOR,
      sourceId: source.id,
      activeTo: "2026-12-31",
    });
    expect(ended.activeTo).toBe("2026-12-31");
    expect(store.audits.at(-1)?.action).toBe("competitors.source.deactivated");
  });

  it("lists sources organization-scoped with the active filter", async () => {
    const store = new FakeCompetitorStore();
    store.seedCompetitorSource({
      organizationId: ORG,
      competitorName: "Zeta",
      urlOrIdentifier: "https://zeta.example",
    });
    store.seedCompetitorSource({
      organizationId: ORG,
      competitorName: "Alpha",
      urlOrIdentifier: "https://alpha.example",
      activeTo: "2026-01-01",
    });
    store.seedCompetitorSource({
      organizationId: OTHER_ORG,
      competitorName: "Beta",
      urlOrIdentifier: "https://beta.example",
    });

    const all = await listCompetitorSources(store, { organizationId: ORG });
    expect(all.map((row) => row.competitorName)).toEqual(["Alpha", "Zeta"]);

    const active = await listCompetitorSources(store, { organizationId: ORG, active: true });
    expect(active.map((row) => row.competitorName)).toEqual(["Zeta"]);

    const ended = await listCompetitorSources(store, { organizationId: ORG, active: false });
    expect(ended.map((row) => row.competitorName)).toEqual(["Alpha"]);
  });

  it("finds a source organization-scoped and rejects a non-uuid id", async () => {
    const store = new FakeCompetitorStore();
    const source = store.seedCompetitorSource({
      organizationId: ORG,
      competitorName: "Rival Cafe",
      urlOrIdentifier: SOURCE_URL,
    });
    expect(
      (await findCompetitorSource(store, { organizationId: ORG, sourceId: source.id }))?.id,
    ).toBe(source.id);
    expect(
      await findCompetitorSource(store, { organizationId: OTHER_ORG, sourceId: source.id }),
    ).toBeUndefined();
    await expect(
      findCompetitorSource(store, { organizationId: ORG, sourceId: "nope" }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});

describe("recordCompetitorObservation with a source (ADR-0010)", () => {
  async function seeded(): Promise<{
    store: FakeCompetitorStore;
    competitorId: string;
    sourceId: string;
  }> {
    const store = new FakeCompetitorStore();
    const competitor = store.seedCompetitor({ organizationId: ORG, name: "Rival Cafe" });
    const source = store.seedCompetitorSource({
      organizationId: ORG,
      competitorName: "Rival Cafe",
      competitorId: competitor.id,
      urlOrIdentifier: "https://rival.example/menu",
      collectionMode: "automated",
      termsStatus: "approved",
    });
    return { store, competitorId: competitor.id, sourceId: source.id };
  }

  it("stores the source link, capture method, category, season and provenance", async () => {
    const { store, competitorId, sourceId } = await seeded();
    const observation = (await recordCompetitorObservation(store, {
      organizationId: ORG,
      actorId: ACTOR,
      competitorId,
      observedAt: OBSERVED_AT,
      source: "website",
      externalName: "Flat White",
      competitorSourceId: sourceId,
      captureMethod: "automated",
      productCategory: "coffee",
      season: "autumn",
      provenance: { url: "https://rival.example/menu", captured_at: OBSERVED_AT },
    }))!;

    expect(observation.competitorSourceId).toBe(sourceId);
    expect(observation.captureMethod).toBe("automated");
    expect(observation.productCategory).toBe("coffee");
    expect(observation.season).toBe("autumn");
    expect(observation.provenance).toMatchObject({ url: "https://rival.example/menu" });
  });

  it("rejects a source that is not in the organization", async () => {
    const { store, competitorId, sourceId } = await seeded();
    await expect(
      recordCompetitorObservation(store, {
        organizationId: OTHER_ORG,
        actorId: ACTOR,
        competitorId,
        observedAt: OBSERVED_AT,
        source: "website",
        externalName: "Flat White",
        competitorSourceId: sourceId,
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("rejects a source linked to a different competitor", async () => {
    const { store, competitorId, sourceId } = await seeded();
    const other = store.seedCompetitor({ organizationId: ORG, name: "Another Cafe" });
    await expect(
      recordCompetitorObservation(store, {
        organizationId: ORG,
        actorId: ACTOR,
        competitorId: other.id,
        observedAt: OBSERVED_AT,
        source: "website",
        externalName: "Flat White",
        competitorSourceId: sourceId,
      }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(competitorId).toBeDefined();
  });

  it("rejects a bad capture method and a non-object provenance", async () => {
    const { store, competitorId } = await seeded();
    await expect(
      recordCompetitorObservation(store, {
        organizationId: ORG,
        actorId: ACTOR,
        competitorId,
        observedAt: OBSERVED_AT,
        source: "website",
        externalName: "Flat White",
        captureMethod: "bogus",
      }),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      recordCompetitorObservation(store, {
        organizationId: ORG,
        actorId: ACTOR,
        competitorId,
        observedAt: OBSERVED_AT,
        source: "website",
        externalName: "Flat White",
        provenance: [] as unknown as Record<string, unknown>,
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});

describe("recordCompetitorObservation dedupe (DEC-149 follow-up)", () => {
  async function seeded(): Promise<{
    store: FakeCompetitorStore;
    competitorId: string;
    sourceId: string;
  }> {
    const store = new FakeCompetitorStore();
    const competitor = store.seedCompetitor({ organizationId: ORG, name: "Rival Cafe" });
    const source = store.seedCompetitorSource({
      organizationId: ORG,
      competitorName: "Rival Cafe",
      competitorId: competitor.id,
      urlOrIdentifier: "https://rival.example/menu",
      collectionMode: "automated",
      termsStatus: "approved",
    });
    return { store, competitorId: competitor.id, sourceId: source.id };
  }

  it("skips a re-captured automated fact and writes no second fact", async () => {
    const { store, competitorId, sourceId } = await seeded();
    const base = {
      organizationId: ORG,
      actorId: null,
      competitorId,
      observedAt: OBSERVED_AT,
      source: "website",
      externalName: "Flat White",
      competitorSourceId: sourceId,
      captureMethod: "automated",
      contentHash: "hash-1",
    } as const;

    const first = await recordCompetitorObservation(store, base);
    const second = await recordCompetitorObservation(store, base);

    expect(first).toBeDefined();
    expect(second).toBeUndefined();
    expect(store.observations.size).toBe(1);
    expect(
      store.audits.filter((audit) => audit.action === "competitors.observation.recorded"),
    ).toHaveLength(1);
  });

  it("records a different hash, and a manual capture ignores the hash (never deduped)", async () => {
    const { store, competitorId, sourceId } = await seeded();
    await recordCompetitorObservation(store, {
      organizationId: ORG,
      actorId: null,
      competitorId,
      observedAt: OBSERVED_AT,
      source: "website",
      externalName: "Flat White",
      competitorSourceId: sourceId,
      captureMethod: "automated",
      contentHash: "hash-a",
    });
    const different = await recordCompetitorObservation(store, {
      organizationId: ORG,
      actorId: null,
      competitorId,
      observedAt: OBSERVED_AT,
      source: "website",
      externalName: "Flat White",
      competitorSourceId: sourceId,
      captureMethod: "automated",
      contentHash: "hash-b",
    });
    expect(different).toBeDefined();

    const manualBase = {
      organizationId: ORG,
      actorId: ACTOR,
      competitorId,
      observedAt: OBSERVED_AT,
      source: "staff note",
      externalName: "Flat White",
      competitorSourceId: sourceId,
      captureMethod: "manual",
      contentHash: "same-page-hash",
    } as const;
    const manualFirst = await recordCompetitorObservation(store, manualBase);
    const manualSecond = await recordCompetitorObservation(store, manualBase);

    expect(manualFirst).toBeDefined();
    expect(manualSecond).toBeDefined();
    // A manual capture ignores the hash: the column stays null and it is never deduped.
    expect(manualFirst?.contentHash).toBeNull();
    expect(store.observations.size).toBe(4);
  });
});

describe("updateCompetitorSource (DEC-149 follow-up)", () => {
  it("switches a terms-approved source to automated and audits it", async () => {
    const store = new FakeCompetitorStore();
    const source = store.seedCompetitorSource({
      organizationId: ORG,
      competitorName: "Rival Cafe",
      urlOrIdentifier: "https://rival.example/menu",
      collectionMode: "manual",
      termsStatus: "approved",
      approvedBy: ACTOR,
      approvedAt: OBSERVED_AT,
    });

    const updated = await updateCompetitorSource(store, {
      organizationId: ORG,
      actorId: ACTOR,
      sourceId: source.id,
      collectionMode: "automated",
    });

    expect(updated.collectionMode).toBe("automated");
    expect(updated.termsStatus).toBe("approved");
    expect(store.audits.at(-1)?.action).toBe("competitors.source.updated");
  });

  it("refuses automated while terms are pending or rejected", async () => {
    for (const termsStatus of ["pending", "rejected"] as const) {
      const store = new FakeCompetitorStore();
      const source = store.seedCompetitorSource({
        organizationId: ORG,
        competitorName: "Rival Cafe",
        urlOrIdentifier: "https://rival.example/menu",
        collectionMode: "manual",
        termsStatus,
      });
      await expect(
        updateCompetitorSource(store, {
          organizationId: ORG,
          actorId: ACTOR,
          sourceId: source.id,
          collectionMode: "automated",
        }),
      ).rejects.toBeInstanceOf(DomainError);
      expect(store.audits).toHaveLength(0);
    }
  });

  it("allows a switch to manual and refuses a duplicate URL", async () => {
    const store = new FakeCompetitorStore();
    store.seedCompetitorSource({
      organizationId: ORG,
      competitorName: "A",
      urlOrIdentifier: "https://a.example/menu",
    });
    const second = store.seedCompetitorSource({
      organizationId: ORG,
      competitorName: "B",
      urlOrIdentifier: "https://b.example/menu",
      collectionMode: "automated",
      termsStatus: "approved",
    });

    const demoted = await updateCompetitorSource(store, {
      organizationId: ORG,
      actorId: ACTOR,
      sourceId: second.id,
      collectionMode: "manual",
    });
    expect(demoted.collectionMode).toBe("manual");

    await expect(
      updateCompetitorSource(store, {
        organizationId: ORG,
        actorId: ACTOR,
        sourceId: second.id,
        urlOrIdentifier: "https://a.example/menu",
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("updates the URL and note, and rejects an empty edit or a missing source", async () => {
    const store = new FakeCompetitorStore();
    const source = store.seedCompetitorSource({
      organizationId: ORG,
      competitorName: "Rival Cafe",
      urlOrIdentifier: "https://rival.example/menu",
    });

    const updated = await updateCompetitorSource(store, {
      organizationId: ORG,
      actorId: ACTOR,
      sourceId: source.id,
      urlOrIdentifier: "https://rival.example/updated",
      rateLimitNote: "1 req/s",
    });
    expect(updated.urlOrIdentifier).toBe("https://rival.example/updated");
    expect(updated.rateLimitNote).toBe("1 req/s");
    expect(updated.updatedBy).toBe(ACTOR);

    await expect(
      updateCompetitorSource(store, { organizationId: ORG, actorId: ACTOR, sourceId: source.id }),
    ).rejects.toBeInstanceOf(DomainError);

    await expect(
      updateCompetitorSource(store, {
        organizationId: ORG,
        actorId: ACTOR,
        sourceId: "11111111-1111-4111-8111-111111111111",
        rateLimitNote: "x",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
