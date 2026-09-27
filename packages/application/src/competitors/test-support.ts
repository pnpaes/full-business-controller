import { DomainError } from "@aquarela/domain";

import type { AuditInput } from "../auth";

import type {
  CompetitorEffectivePrice,
  CompetitorItemVariant,
  CompetitorListQuery,
  CompetitorObservationListQuery,
  CompetitorObservationRecord,
  CompetitorRecord,
  CompetitorSourceListQuery,
  CompetitorSourceRecord,
  CompetitorStore,
  NewCompetitorObservationRecord,
  NewCompetitorRecord,
  NewCompetitorSourceRecord,
  UpdateCompetitorObservationReviewRecord,
  UpdateCompetitorSourceActiveToRecord,
  UpdateCompetitorSourceTermsRecord,
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
  readonly sources: Map<string, CompetitorSourceRecord>;
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
  readonly sources = new Map<string, CompetitorSourceRecord>();
  readonly audits: AuditInput[] = [];

  /** `${organizationId}:${itemId}` → the selling variant id. */
  readonly itemVariants = new Map<string, string>();
  readonly effectivePrices: FakeCompetitorEffectivePrice[] = [];
  readonly organizationCurrencies = new Map<string, string>();

  private competitorSequence = 0;
  private observationSequence = 0;
  private sourceSequence = 0;

  private nextCompetitorId(): string {
    this.competitorSequence += 1;
    return fakeId("1", this.competitorSequence);
  }

  private nextObservationId(): string {
    this.observationSequence += 1;
    return fakeId("2", this.observationSequence);
  }

  private nextSourceId(): string {
    this.sourceSequence += 1;
    return fakeId("3", this.sourceSequence);
  }

  async withTransaction<T>(fn: (store: CompetitorStore) => Promise<T>): Promise<T> {
    const snapshot: CompetitorSnapshot = {
      competitors: new Map(this.competitors),
      observations: new Map(this.observations),
      sources: new Map(this.sources),
      audits: [...this.audits],
    };
    try {
      return await fn(this);
    } catch (error) {
      this.competitors.clear();
      for (const [key, value] of snapshot.competitors) this.competitors.set(key, value);
      this.observations.clear();
      for (const [key, value] of snapshot.observations) this.observations.set(key, value);
      this.sources.clear();
      for (const [key, value] of snapshot.sources) this.sources.set(key, value);
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

  async createCompetitorSource(input: NewCompetitorSourceRecord): Promise<CompetitorSourceRecord> {
    const duplicate = await this.findCompetitorSourceByUrl({
      organizationId: input.organizationId,
      urlOrIdentifier: input.urlOrIdentifier,
    });
    if (duplicate !== undefined) {
      throw new DomainError("competitor source already exists for this organization");
    }
    const record: CompetitorSourceRecord = {
      id: this.nextSourceId(),
      organizationId: input.organizationId,
      competitorName: input.competitorName,
      competitorId: input.competitorId,
      sourceType: input.sourceType,
      urlOrIdentifier: input.urlOrIdentifier,
      collectionMode: input.collectionMode,
      termsStatus: input.termsStatus,
      approvedBy: input.approvedBy,
      approvedAt: input.approvedAt,
      rateLimitNote: input.rateLimitNote,
      activeFrom: input.activeFrom,
      activeTo: null,
      createdAt: new Date().toISOString(),
      createdBy: input.createdBy,
      updatedAt: null,
      updatedBy: null,
      version: 1,
    };
    this.sources.set(record.id, record);
    return record;
  }

  async findCompetitorSource(query: {
    readonly organizationId: string;
    readonly sourceId: string;
  }): Promise<CompetitorSourceRecord | undefined> {
    const row = this.sources.get(query.sourceId);
    return row !== undefined && row.organizationId === query.organizationId ? row : undefined;
  }

  async findCompetitorSourceByUrl(query: {
    readonly organizationId: string;
    readonly urlOrIdentifier: string;
  }): Promise<CompetitorSourceRecord | undefined> {
    return [...this.sources.values()].find(
      (row) =>
        row.organizationId === query.organizationId &&
        row.urlOrIdentifier === query.urlOrIdentifier,
    );
  }

  /** The fake has no row locks, so locking is the same id read. */
  async lockCompetitorSource(query: {
    readonly organizationId: string;
    readonly sourceId: string;
  }): Promise<CompetitorSourceRecord | undefined> {
    return this.findCompetitorSource(query);
  }

  async updateCompetitorSourceTerms(
    input: UpdateCompetitorSourceTermsRecord,
  ): Promise<CompetitorSourceRecord | undefined> {
    const existing = await this.findCompetitorSource({
      organizationId: input.organizationId,
      sourceId: input.sourceId,
    });
    if (existing === undefined) {
      return undefined;
    }
    const record: CompetitorSourceRecord = {
      ...existing,
      termsStatus: input.termsStatus,
      approvedBy: input.approvedBy,
      approvedAt: input.approvedAt,
      updatedAt: new Date().toISOString(),
      updatedBy: input.updatedBy,
      version: existing.version + 1,
    };
    this.sources.set(record.id, record);
    return record;
  }

  async updateCompetitorSourceActiveTo(
    input: UpdateCompetitorSourceActiveToRecord,
  ): Promise<CompetitorSourceRecord | undefined> {
    const existing = await this.findCompetitorSource({
      organizationId: input.organizationId,
      sourceId: input.sourceId,
    });
    if (existing === undefined) {
      return undefined;
    }
    const record: CompetitorSourceRecord = {
      ...existing,
      activeTo: input.activeTo,
      updatedAt: new Date().toISOString(),
      updatedBy: input.updatedBy,
      version: existing.version + 1,
    };
    this.sources.set(record.id, record);
    return record;
  }

  async listCompetitorSources(
    query: CompetitorSourceListQuery,
  ): Promise<readonly CompetitorSourceRecord[]> {
    const insertionOrder = new Map<string, number>();
    let index = 0;
    for (const id of this.sources.keys()) {
      insertionOrder.set(id, index);
      index += 1;
    }
    const rows = [...this.sources.values()]
      .filter((row) => row.organizationId === query.organizationId)
      .filter((row) =>
        query.active === undefined
          ? true
          : query.active
            ? row.activeTo === null
            : row.activeTo !== null,
      )
      .sort((a, b) => {
        if (a.competitorName !== b.competitorName) {
          return a.competitorName < b.competitorName ? -1 : 1;
        }
        if (a.urlOrIdentifier !== b.urlOrIdentifier) {
          return a.urlOrIdentifier < b.urlOrIdentifier ? -1 : 1;
        }
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
      competitorSourceId: input.competitorSourceId,
      captureMethod: input.captureMethod,
      productCategory: input.productCategory,
      season: input.season,
      provenance: input.provenance,
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

  /** Seeds a competitor source directly (bypassing the commands). */
  seedCompetitorSource(input: {
    readonly organizationId: string;
    readonly id?: string;
    readonly competitorName: string;
    readonly competitorId?: string | null;
    readonly sourceType?: string;
    readonly urlOrIdentifier: string;
    readonly collectionMode?: string;
    readonly termsStatus?: string;
    readonly approvedBy?: string | null;
    readonly approvedAt?: string | null;
    readonly rateLimitNote?: string | null;
    readonly activeFrom?: string;
    readonly activeTo?: string | null;
  }): CompetitorSourceRecord {
    const record: CompetitorSourceRecord = {
      id: input.id ?? this.nextSourceId(),
      organizationId: input.organizationId,
      competitorName: input.competitorName,
      competitorId: input.competitorId ?? null,
      sourceType: input.sourceType ?? "website",
      urlOrIdentifier: input.urlOrIdentifier,
      collectionMode: input.collectionMode ?? "manual",
      termsStatus: input.termsStatus ?? "pending",
      approvedBy: input.approvedBy ?? null,
      approvedAt: input.approvedAt ?? null,
      rateLimitNote: input.rateLimitNote ?? null,
      activeFrom: input.activeFrom ?? "2026-01-01",
      activeTo: input.activeTo ?? null,
      createdAt: new Date().toISOString(),
      createdBy: null,
      updatedAt: null,
      updatedBy: null,
      version: 1,
    };
    this.sources.set(record.id, record);
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
    readonly competitorSourceId?: string | null;
    readonly captureMethod?: string | null;
    readonly productCategory?: string | null;
    readonly season?: string | null;
    readonly provenance?: Record<string, unknown>;
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
      competitorSourceId: input.competitorSourceId ?? null,
      captureMethod: input.captureMethod ?? null,
      productCategory: input.productCategory ?? null,
      season: input.season ?? null,
      provenance: input.provenance ?? {},
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
