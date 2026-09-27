import {
  COMPETITOR_COLLECTION_MODE,
  COMPETITOR_REVIEW_STATUS,
  COMPETITOR_SOURCE_TYPE,
  COMPETITOR_TERMS_STATUS,
} from "@aquarela/persistence";

import type { AuditInput } from "../auth";

/**
 * Application-level ports and DTOs for the competitor-observation slice
 * (`DEC-126`, `COMP-001…COMP-004`).
 *
 * Both tables carry `organization_id` directly, so every read and write takes
 * the organization and is scoped by it (`DEC-061`); a row in another
 * organization is invisible at this scope. Instants (`observedAt`/`reviewedAt`/
 * `createdAt`) cross the port as ISO strings; `price` is a decimal
 * string (`numeric(19,4)`, never a float).
 *
 * The review vocabulary is the persistence `competitor_review_status` enum
 * (`pending`/`reviewed`/`rejected`), so there is one source of truth.
 */

/** The `competitor_review_status` vocabulary (`COMPETITOR_REVIEW_STATUS`). */
export const COMPETITOR_REVIEW_STATUSES: readonly string[] = COMPETITOR_REVIEW_STATUS;

/** Narrow type for `competitor_observation.review_status`, so comparisons cannot drift. */
export type CompetitorReviewStatus = (typeof COMPETITOR_REVIEW_STATUS)[number];

/** The `competitor_source_type` vocabulary (`ADR-0010`/`DEC-143`). */
export const COMPETITOR_SOURCE_TYPES: readonly string[] = COMPETITOR_SOURCE_TYPE;

/** The `competitor_collection_mode` vocabulary. */
export const COMPETITOR_COLLECTION_MODES: readonly string[] = COMPETITOR_COLLECTION_MODE;

/** The `competitor_terms_status` vocabulary. */
export const COMPETITOR_TERMS_STATUSES: readonly string[] = COMPETITOR_TERMS_STATUS;

/** A `competitor_source.source_type` value. */
export type CompetitorSourceType = (typeof COMPETITOR_SOURCE_TYPE)[number];

/** A `competitor_source.collection_mode` value. */
export type CompetitorCollectionMode = (typeof COMPETITOR_COLLECTION_MODE)[number];

/** A `competitor_source.terms_status` value. */
export type CompetitorTermsStatus = (typeof COMPETITOR_TERMS_STATUS)[number];

/** One `competitor` row (`DEC-126`). */
export interface CompetitorRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly notes: string | null;
  /** `timestamptz`, ISO. */
  readonly createdAt: string;
}

/** A competitor to create. `(organizationId, name)` is unique. */
export interface NewCompetitorRecord {
  readonly organizationId: string;
  readonly name: string;
  readonly notes: string | null;
}

/** One `competitor_observation` row (`DEC-126`). */
export interface CompetitorObservationRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly competitorId: string;
  /** `timestamptz`, ISO. */
  readonly observedAt: string;
  readonly source: string;
  readonly sourceUrl: string | null;
  readonly itemId: string | null;
  readonly externalName: string;
  /** `numeric(19,4)` decimal string, or null. */
  readonly price: string | null;
  readonly currency: string | null;
  readonly offerNotes: string | null;
  /** One of `COMPETITOR_REVIEW_STATUSES`. */
  readonly reviewStatus: string;
  readonly reviewedBy: string | null;
  /** `timestamptz`, ISO; null until reviewed. */
  readonly reviewedAt: string | null;
  /** `ADR-0010`/`DEC-143`: the source captured from, or null. */
  readonly competitorSourceId: string | null;
  /** A `COMPETITOR_COLLECTION_MODES` value, or null. */
  readonly captureMethod: string | null;
  readonly productCategory: string | null;
  readonly season: string | null;
  /** URL/capture time/method/content hash; `{}` when unknown. */
  readonly provenance: Record<string, unknown>;
  /** `timestamptz`, ISO. */
  readonly createdAt: string;
}

/** An observation to capture. It always opens `pending` (the table default). */
export interface NewCompetitorObservationRecord {
  readonly organizationId: string;
  readonly competitorId: string;
  /** `timestamptz`, ISO. */
  readonly observedAt: string;
  readonly source: string;
  readonly sourceUrl: string | null;
  readonly itemId: string | null;
  readonly externalName: string;
  readonly price: string | null;
  readonly currency: string | null;
  readonly offerNotes: string | null;
  /** `ADR-0010`/`DEC-143`: the source captured from, or null. */
  readonly competitorSourceId: string | null;
  /** A `COMPETITOR_COLLECTION_MODES` value, or null. */
  readonly captureMethod: string | null;
  readonly productCategory: string | null;
  readonly season: string | null;
  /** URL/capture time/method/content hash; `{}` when unknown. */
  readonly provenance: Record<string, unknown>;
}

/** One `competitor_source` row (`ADR-0010`/`DEC-143`, `COMP-001`). */
export interface CompetitorSourceRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly competitorName: string;
  /** Optional link to the internal competitor master (deferred); null until set. */
  readonly competitorId: string | null;
  /** One of `COMPETITOR_SOURCE_TYPES`. */
  readonly sourceType: string;
  readonly urlOrIdentifier: string;
  /** One of `COMPETITOR_COLLECTION_MODES`. */
  readonly collectionMode: string;
  /** One of `COMPETITOR_TERMS_STATUSES`. */
  readonly termsStatus: string;
  readonly approvedBy: string | null;
  /** `timestamptz`, ISO; null until a terms decision. */
  readonly approvedAt: string | null;
  readonly rateLimitNote: string | null;
  /** ISO date (`YYYY-MM-DD`). */
  readonly activeFrom: string;
  /** ISO date (`YYYY-MM-DD`), or null while open-ended. */
  readonly activeTo: string | null;
  /** `timestamptz`, ISO. */
  readonly createdAt: string;
  readonly createdBy: string | null;
  /** `timestamptz`, ISO; null until first mutation. */
  readonly updatedAt: string | null;
  readonly updatedBy: string | null;
  readonly version: number;
}

/** A source to register. */
export interface NewCompetitorSourceRecord {
  readonly organizationId: string;
  readonly competitorName: string;
  readonly competitorId: string | null;
  readonly sourceType: string;
  readonly urlOrIdentifier: string;
  readonly collectionMode: string;
  readonly termsStatus: string;
  readonly approvedBy: string | null;
  /** `timestamptz`, ISO. */
  readonly approvedAt: string | null;
  readonly rateLimitNote: string | null;
  /** ISO date (`YYYY-MM-DD`). */
  readonly activeFrom: string;
  readonly createdBy: string | null;
}

/** The terms decision the port writes (`approved` or `rejected`). */
export interface UpdateCompetitorSourceTermsRecord {
  readonly organizationId: string;
  readonly sourceId: string;
  /** `approved` or `rejected`. */
  readonly termsStatus: string;
  readonly approvedBy: string;
  /** `timestamptz`, ISO. */
  readonly approvedAt: string;
  readonly updatedBy: string;
}

/** The deactivation the port writes (sets `active_to`). */
export interface UpdateCompetitorSourceActiveToRecord {
  readonly organizationId: string;
  readonly sourceId: string;
  /** ISO date (`YYYY-MM-DD`). */
  readonly activeTo: string;
  readonly updatedBy: string;
}

/** Source filters for the store read. */
export interface CompetitorSourceListQuery {
  readonly organizationId: string;
  /** `true` → open-ended (`active_to is null`); `false` → ended. */
  readonly active?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

/** The one-shot review decision the port writes. */
export interface UpdateCompetitorObservationReviewRecord {
  readonly organizationId: string;
  readonly observationId: string;
  /** `reviewed` or `rejected`. */
  readonly status: string;
  readonly reviewedBy: string;
  /** `timestamptz`, ISO. */
  readonly reviewedAt: string;
}

/** Competitor filters for the store read. */
export interface CompetitorListQuery {
  readonly organizationId: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Observation filters for the store read. `status` is an exact match on the
 * stored vocabulary; the **command** decides the default (`reviewed`), so this
 * port never silently broadens a read.
 */
export interface CompetitorObservationListQuery {
  readonly organizationId: string;
  readonly competitorId?: string;
  /** One of `COMPETITOR_REVIEW_STATUSES`, exact match. */
  readonly status?: string;
  /** Half-open window lower bound on `observedAt` (`>= from`); ISO. */
  readonly from?: string;
  /** Half-open window upper bound on `observedAt` (`< to`); ISO. */
  readonly to?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/** A product variant resolved from a comparable item (the price-version scope key). */
export interface CompetitorItemVariant {
  readonly id: string;
}

/** The effective `price_version` snapshot the comparison read compares against. */
export interface CompetitorEffectivePrice {
  readonly priceVersionId: string;
  readonly productVariantId: string;
  /** `numeric(19,4)` decimal string. */
  readonly netPrice: string;
  /** `numeric(19,4)` decimal string. */
  readonly grossPrice: string;
  /** `timestamptz`, ISO. */
  readonly effectiveFrom: string;
}

/**
 * The persistence port for the competitor-observation slice. One port covers
 * the two tables plus the two reads the comparison needs: the variant that a
 * comparable `item_id` maps to (via `product_variant.finished_good_item_id`),
 * the effective `price_version` for that variant at the observation instant
 * (the existing effective-price read), and the organization's own currency.
 *
 * `lockCompetitorObservation` takes the observation row's write lock so two
 * concurrent review decisions serialise; the store's review write is itself a
 * single-shot `pending`-guarded update, so the lock is belt-and-braces.
 */
export interface CompetitorStore {
  /**
   * Binds `fn` to one transaction so a write and its audit fact commit or roll
   * back together.
   */
  withTransaction<T>(fn: (store: CompetitorStore) => Promise<T>): Promise<T>;
  /** Append-only audit fact; the caller must not pass secrets (ADR-0003 convention). */
  writeAudit(input: AuditInput): Promise<void>;
  createCompetitor(input: NewCompetitorRecord): Promise<CompetitorRecord>;
  /** One competitor by id, organization-scoped (`DEC-061`), or `undefined`. */
  findCompetitor(query: {
    readonly organizationId: string;
    readonly competitorId: string;
  }): Promise<CompetitorRecord | undefined>;
  /** One competitor by its `(organizationId, name)` unique key, or `undefined`. */
  findCompetitorByName(query: {
    readonly organizationId: string;
    readonly name: string;
  }): Promise<CompetitorRecord | undefined>;
  listCompetitors(query: CompetitorListQuery): Promise<readonly CompetitorRecord[]>;
  /** Creates one source (`(organizationId, urlOrIdentifier)` is unique). */
  createCompetitorSource(input: NewCompetitorSourceRecord): Promise<CompetitorSourceRecord>;
  /** One source by id, organization-scoped (`DEC-061`), or `undefined`. */
  findCompetitorSource(query: {
    readonly organizationId: string;
    readonly sourceId: string;
  }): Promise<CompetitorSourceRecord | undefined>;
  /** One source by its `(organizationId, urlOrIdentifier)` unique key, or `undefined`. */
  findCompetitorSourceByUrl(query: {
    readonly organizationId: string;
    readonly urlOrIdentifier: string;
  }): Promise<CompetitorSourceRecord | undefined>;
  /** The same id read, taking the row's write lock (`SELECT … FOR UPDATE`). */
  lockCompetitorSource(query: {
    readonly organizationId: string;
    readonly sourceId: string;
  }): Promise<CompetitorSourceRecord | undefined>;
  /** Sets the terms decision and its actor/instant on one org-scoped source. */
  updateCompetitorSourceTerms(
    input: UpdateCompetitorSourceTermsRecord,
  ): Promise<CompetitorSourceRecord | undefined>;
  /** Ends one org-scoped source's active window (`active_to`). */
  updateCompetitorSourceActiveTo(
    input: UpdateCompetitorSourceActiveToRecord,
  ): Promise<CompetitorSourceRecord | undefined>;
  listCompetitorSources(
    query: CompetitorSourceListQuery,
  ): Promise<readonly CompetitorSourceRecord[]>;
  /** Creates one observation; it opens `pending`. */
  createObservation(input: NewCompetitorObservationRecord): Promise<CompetitorObservationRecord>;
  /** One observation by id, organization-scoped (`DEC-061`), or `undefined`. */
  findObservation(query: {
    readonly organizationId: string;
    readonly observationId: string;
  }): Promise<CompetitorObservationRecord | undefined>;
  /** The same id read, taking the row's write lock (`SELECT … FOR UPDATE`). */
  lockObservation(query: {
    readonly organizationId: string;
    readonly observationId: string;
  }): Promise<CompetitorObservationRecord | undefined>;
  /**
   * Sets the one-shot review decision on a `pending` observation,
   * organization-scoped; `undefined` when no `pending` row matches (a second
   * decision loses).
   */
  updateObservationReview(
    input: UpdateCompetitorObservationReviewRecord,
  ): Promise<CompetitorObservationRecord | undefined>;
  listObservations(
    query: CompetitorObservationListQuery,
  ): Promise<readonly CompetitorObservationRecord[]>;
  /**
   * The variant whose `finished_good_item_id` is `itemId`, in the same
   * organization, or `undefined`. The bridge from an observation's comparable
   * item to the `price_version` scope.
   */
  findProductVariantForItem(query: {
    readonly organizationId: string;
    readonly itemId: string;
  }): Promise<CompetitorItemVariant | undefined>;
  /**
   * The effective `price_version` for one variant at `asOf` (half-open
   * `[effective_from, effective_to)`), or `undefined`. The organization-wide
   * exact scope (`null` location, `null` channel) is used, because an
   * observation carries neither.
   */
  findEffectivePriceVersion(query: {
    readonly organizationId: string;
    readonly productVariantId: string;
    readonly asOf: string;
  }): Promise<CompetitorEffectivePrice | undefined>;
  /** The organization's ISO currency (`organization.currency`), or `undefined`. */
  findOrganizationCurrency(query: { readonly organizationId: string }): Promise<string | undefined>;
}
