import { DomainError } from "@aquarela/domain";

import type { AuditInput } from "../auth";

import type {
  CompetitorEffectivePrice,
  CompetitorItemVariant,
  CompetitorListQuery,
  CompetitorObservationListQuery,
  CompetitorObservationRecord,
  CompetitorRecord,
  CompetitorStore,
  NewCompetitorObservationRecord,
  NewCompetitorRecord,
  UpdateCompetitorObservationReviewRecord,
} from "./types";

/** A seeded effective price version in the fake (half-open `[from, to)` window). */
export interface FakeCompetitorEffectivePrice {
  readonly organizationId: string;
  readonly productVariantId: string;
  readonly priceVersionId: string;
  readonly netPrice: string;
  readonly grossPrice: string;
  /** `timestamptz`, ISO. */
  readonly effectiveFrom: string;
  /** `timestamptz`, ISO; exclusive; null is open-ended. */
  readonly effectiveTo: string | null;
}

/** A shallow copy of every mutable map/array a transaction can touch, to roll back a failure. */
interface CompetitorSnapshot {
  readonly competitors: Map<string, CompetitorRecord>;
  readonly observations: Map<string, CompetitorObservationRecord>;
  readonly audits: AuditInput[];
}

/** A stable uuid-shaped id (`<head>` is an 8-hex prefix, `n` the 12-hex tail). */
function fakeId(head: string, n: number): string {
  const tail = n.toString(16).padStart(12, "0").slice(-12);
  return `${head}0000000-0000-4000-8000-${tail}`;
}

/**
 * In-memory `CompetitorStore` for the unit suite. It mirrors the Postgres
 * adapter's organization scoping, unique-name conflict, single-shot review guard
 * and ordering so the commands and reads can be exercised without a database;
 * `competitors.postgres.test.ts` covers the real adapter.
 */
export class FakeCompetitorStore implements CompetitorStore {
  readonly competitors = new Map<string, CompetitorRecord>();
  readonly observations = new Map<string, CompetitorObservationRecord>();
  readonly audits: AuditInput[] = [];

  /** `${organizationId}:${itemId}` → the selling variant id. */
  readonly itemVariants = new Map<string, string>();
  readonly effectivePrices: FakeCompetitorEffectivePrice[] = [];
  readonly organizationCurrencies = new Map<string, string>();

  private competitorSequence = 0;
  private observationSequence = 0;

  private nextCompetitorId(): string {
    this.competitorSequence += 1;
    return fakeId("1", this.competitorSequence);
  }

  private nextObservationId(): string {
    this.observationSequence += 1;
    return fakeId("2", this.observationSequence);
  }

  async withTransaction<T>(fn: (store: CompetitorStore) => Promise<T>): Promise<T> {
    const snapshot: CompetitorSnapshot = {
      competitors: new Map(this.competitors),
      observations: new Map(this.observations),
      audits: [...this.audits],
    };
    try {
      return await fn(this);
    } catch (error) {
      this.competitors.clear();
      for (const [key, value] of snapshot.competitors) this.competitors.set(key, value);
      this.observations.clear();
      for (const [key, value] of snapshot.observations) this.observations.set(key, value);
      this.audits.length = 0;
      this.audits.push(...snapshot.audits);
      throw error;
    }
  }

  async writeAudit(input: AuditInput): Promise<void> {
    this.audits.push(input);
  }

  async createCompetitor(input: NewCompetitorRecord): Promise<CompetitorRecord> {
    const duplicate = await this.findCompetitorByName({
      organizationId: input.organizationId,
      name: input.name,
    });
    if (duplicate !== undefined) {
      throw new DomainError("competitor already exists for this organization");
    }
    const record: CompetitorRecord = {
      id: this.nextCompetitorId(),
      organizationId: input.organizationId,
      name: input.name,
      notes: input.notes,
      createdAt: new Date().toISOString(),
    };
    this.competitors.set(record.id, record);
    return record;
  }

  async findCompetitor(query: {
    readonly organizationId: string;
    readonly competitorId: string;
  }): Promise<CompetitorRecord | undefined> {
    const row = this.competitors.get(query.competitorId);
    return row !== undefined && row.organizationId === query.organizationId ? row : undefined;
  }

  async findCompetitorByName(query: {
    readonly organizationId: string;
    readonly name: string;
  }): Promise<CompetitorRecord | undefined> {
    return [...this.competitors.values()].find(
      (row) => row.organizationId === query.organizationId && row.name === query.name,
    );
  }

  async listCompetitors(query: CompetitorListQuery): Promise<readonly CompetitorRecord[]> {
    const insertionOrder = new Map<string, number>();
    let index = 0;
    for (const id of this.competitors.keys()) {
      insertionOrder.set(id, index);
      index += 1;
    }
    const rows = [...this.competitors.values()]
      .filter((row) => row.organizationId === query.organizationId)
      .sort((a, b) => {
        if (a.name !== b.name) return a.name < b.name ? -1 : 1;
        return (insertionOrder.get(a.id) ?? 0) - (insertionOrder.get(b.id) ?? 0);
      });
    const offset = query.offset ?? 0;
    return rows.slice(offset, offset + (query.limit ?? rows.length));
  }

  async createObservation(
    input: NewCompetitorObservationRecord,
  ): Promise<CompetitorObservationRecord> {
    const record: CompetitorObservationRecord = {
      id: this.nextObservationId(),
      organizationId: input.organizationId,
      competitorId: input.competitorId,
      observedAt: input.observedAt,
      source: input.source,
      sourceUrl: input.sourceUrl,
      itemId: input.itemId,
      externalName: input.externalName,
      price: input.price,
      currency: input.currency,
      offerNotes: input.offerNotes,
      reviewStatus: "pending",
      reviewedBy: null,
      reviewedAt: null,
      createdAt: new Date().toISOString(),
    };
    this.observations.set(record.id, record);
    return record;
  }

  async findObservation(query: {
    readonly organizationId: string;
    readonly observationId: string;
  }): Promise<CompetitorObservationRecord | undefined> {
    const row = this.observations.get(query.observationId);
    return row !== undefined && row.organizationId === query.organizationId ? row : undefined;
  }

  /** The fake has no row locks, so locking is the same id read. */
  async lockObservation(query: {
    readonly organizationId: string;
    readonly observationId: string;
  }): Promise<CompetitorObservationRecord | undefined> {
    return this.findObservation(query);
  }

  async updateObservationReview(
    input: UpdateCompetitorObservationReviewRecord,
  ): Promise<CompetitorObservationRecord | undefined> {
    const existing = await this.findObservation({
      organizationId: input.organizationId,
      observationId: input.observationId,
    });
    // The single-shot guard: only a `pending` row can be decided.
    if (existing === undefined || existing.reviewStatus !== "pending") {
      return undefined;
    }
    const record: CompetitorObservationRecord = {
      ...existing,
      reviewStatus: input.status,
      reviewedBy: input.reviewedBy,
      reviewedAt: input.reviewedAt,
    };
    this.observations.set(record.id, record);
    return record;
  }

  async listObservations(
    query: CompetitorObservationListQuery,
  ): Promise<readonly CompetitorObservationRecord[]> {
    const insertionOrder = new Map<string, number>();
    let index = 0;
    for (const id of this.observations.keys()) {
      insertionOrder.set(id, index);
      index += 1;
    }
    const rows = [...this.observations.values()]
      .filter((row) => row.organizationId === query.organizationId)
      .filter((row) => query.competitorId === undefined || row.competitorId === query.competitorId)
      .filter((row) => query.status === undefined || row.reviewStatus === query.status)
      .filter((row) => query.from === undefined || row.observedAt >= query.from)
      .filter((row) => query.to === undefined || row.observedAt < query.to)
      .sort((a, b) => {
        if (a.observedAt !== b.observedAt) return a.observedAt < b.observedAt ? 1 : -1;
        return (insertionOrder.get(a.id) ?? 0) - (insertionOrder.get(b.id) ?? 0);
      });
    const offset = query.offset ?? 0;
    return rows.slice(offset, offset + (query.limit ?? rows.length));
  }

  async findProductVariantForItem(query: {
    readonly organizationId: string;
    readonly itemId: string;
  }): Promise<CompetitorItemVariant | undefined> {
    const variantId = this.itemVariants.get(`${query.organizationId}:${query.itemId}`);
    return variantId === undefined ? undefined : { id: variantId };
  }

  async findEffectivePriceVersion(query: {
    readonly organizationId: string;
    readonly productVariantId: string;
    readonly asOf: string;
  }): Promise<CompetitorEffectivePrice | undefined> {
    const candidates = this.effectivePrices
      .filter(
        (row) =>
          row.organizationId === query.organizationId &&
          row.productVariantId === query.productVariantId &&
          row.effectiveFrom <= query.asOf &&
          (row.effectiveTo === null || query.asOf < row.effectiveTo),
      )
      .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
    const row = candidates[0];
    return row === undefined
      ? undefined
      : {
          priceVersionId: row.priceVersionId,
          productVariantId: row.productVariantId,
          netPrice: row.netPrice,
          grossPrice: row.grossPrice,
          effectiveFrom: row.effectiveFrom,
        };
  }

  async findOrganizationCurrency(query: {
    readonly organizationId: string;
  }): Promise<string | undefined> {
    return this.organizationCurrencies.get(query.organizationId);
  }

  /** Seeds an active competitor directly (bypassing the command). */
  seedCompetitor(input: {
    readonly organizationId: string;
    readonly id?: string;
    readonly name: string;
    readonly notes?: string | null;
  }): CompetitorRecord {
    const record: CompetitorRecord = {
      id: input.id ?? this.nextCompetitorId(),
      organizationId: input.organizationId,
      name: input.name,
      notes: input.notes ?? null,
      createdAt: new Date().toISOString(),
    };
    this.competitors.set(record.id, record);
    return record;
  }

  /** Seeds an observation directly (bypassing the commands), any review status. */
  seedObservation(input: {
    readonly organizationId: string;
    readonly id?: string;
    readonly competitorId: string;
    readonly observedAt: string;
    readonly externalName: string;
    readonly itemId?: string | null;
    readonly price?: string | null;
    readonly currency?: string | null;
    readonly source?: string;
    readonly reviewStatus?: string;
  }): CompetitorObservationRecord {
    const record: CompetitorObservationRecord = {
      id: input.id ?? this.nextObservationId(),
      organizationId: input.organizationId,
      competitorId: input.competitorId,
      observedAt: input.observedAt,
      source: input.source ?? "seed",
      sourceUrl: null,
      itemId: input.itemId ?? null,
      externalName: input.externalName,
      price: input.price ?? null,
      currency: input.currency ?? null,
      offerNotes: null,
      reviewStatus: input.reviewStatus ?? "pending",
      reviewedBy:
        input.reviewStatus === "pending" || input.reviewStatus === undefined
          ? null
          : "seed-reviewer",
      reviewedAt:
        input.reviewStatus === "pending" || input.reviewStatus === undefined
          ? null
          : input.observedAt,
      createdAt: new Date().toISOString(),
    };
    this.observations.set(record.id, record);
    return record;
  }
}

export interface CompetitorFixture {
  readonly organizationId: string;
  readonly otherOrganizationId: string;
  readonly actorId: string;
  readonly itemId: string;
  readonly otherItemId: string;
}

/** Seeds the two-organization fixture the competitor tests share. */
export function seedCompetitorFixture(): CompetitorFixture {
  return {
    organizationId: "org-1",
    otherOrganizationId: "org-2",
    actorId: "actor-1",
    itemId: "item-1",
    otherItemId: "item-2",
  };
}
