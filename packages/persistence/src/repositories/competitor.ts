import { and, asc, desc, eq, gte, isNotNull, isNull, lt } from "drizzle-orm";

import type { Database } from "../client";
import {
  competitor,
  competitorObservation,
  competitorSource,
  organization,
  productVariant,
} from "../schema";

export type Competitor = typeof competitor.$inferSelect;
export type NewCompetitor = typeof competitor.$inferInsert;
export type CompetitorObservation = typeof competitorObservation.$inferSelect;
export type NewCompetitorObservation = typeof competitorObservation.$inferInsert;
export type CompetitorSource = typeof competitorSource.$inferSelect;
export type NewCompetitorSource = typeof competitorSource.$inferInsert;

/*
 * `DEC-126` (`COMP-001…COMP-004`): the competitor-observation repository.
 *
 * Both tables carry `organization_id` directly, so every read and write that
 * takes the organization is scoped by it (`DEC-061`): a row in another
 * organization is invisible, and a scoped miss returns `undefined` rather than
 * surfacing another tenant's row. `competitor_observation.competitor_id` and
 * `.item_id` are real FKs, so an out-of-organization competitor is rejected by
 * the application before the write (the trigger-free FK does not carry the
 * organization dimension on its own).
 *
 * This layer writes **no** `audit_event` (the rows are mutable register facts,
 * not append-only): the application writes the facts. The review-status
 * vocabulary, the non-negative price and the review-gate checks are
 * database-backed, so this layer does not re-validate them; the application
 * validates first so a caller sees a `DomainError`.
 */

export interface CreateCompetitorInput {
  readonly organizationId: string;
  readonly name: string;
  readonly notes: string | null;
}

/** Creates one `competitor` row (`(organization_id, name)` is unique). */
export async function createCompetitor(
  db: Database,
  input: CreateCompetitorInput,
): Promise<Competitor> {
  const rows = await db
    .insert(competitor)
    .values({
      organizationId: input.organizationId,
      name: input.name,
      notes: input.notes,
    })
    .returning();
  return rows[0]!;
}

export interface FindCompetitorQuery {
  readonly organizationId: string;
  readonly competitorId: string;
}

/** One competitor by id, organization-scoped (`DEC-061`), or `undefined`. */
export async function findCompetitor(
  db: Database,
  query: FindCompetitorQuery,
): Promise<Competitor | undefined> {
  const rows = await db
    .select()
    .from(competitor)
    .where(
      and(
        eq(competitor.id, query.competitorId),
        eq(competitor.organizationId, query.organizationId),
      ),
    )
    .limit(1);
  return rows[0];
}

export interface FindCompetitorByNameQuery {
  readonly organizationId: string;
  readonly name: string;
}

/**
 * One competitor by its `(organization_id, name)` unique key, or `undefined`.
 * Backs the idempotent `registerCompetitor`.
 */
export async function findCompetitorByName(
  db: Database,
  query: FindCompetitorByNameQuery,
): Promise<Competitor | undefined> {
  const rows = await db
    .select()
    .from(competitor)
    .where(
      and(eq(competitor.organizationId, query.organizationId), eq(competitor.name, query.name)),
    )
    .limit(1);
  return rows[0];
}

export interface ListCompetitorsQuery {
  readonly organizationId: string;
  readonly limit?: number;
  readonly offset?: number;
}

/** Competitors for one organization, name-ascending (then id), paged. */
export async function listCompetitors(
  db: Database,
  query: ListCompetitorsQuery,
): Promise<readonly Competitor[]> {
  const statement = db
    .select()
    .from(competitor)
    .where(eq(competitor.organizationId, query.organizationId))
    .orderBy(asc(competitor.name), asc(competitor.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}

export interface CreateCompetitorObservationInput {
  readonly organizationId: string;
  readonly competitorId: string;
  /** `timestamptz`. */
  readonly observedAt: Date;
  readonly source: string;
  readonly sourceUrl: string | null;
  readonly itemId: string | null;
  readonly externalName: string;
  readonly price: string | null;
  readonly currency: string | null;
  readonly offerNotes: string | null;
  /** `ADR-0010`/`DEC-143`: the source this observation was captured from. */
  readonly competitorSourceId?: string | null;
  /** A `COMPETITOR_COLLECTION_MODE` value, or null. */
  readonly captureMethod?: string | null;
  readonly productCategory?: string | null;
  readonly season?: string | null;
  /** URL/capture time/method/content hash; defaults to `{}`. */
  readonly provenance?: Record<string, unknown>;
  /** `pending` at capture (the column default); the review command sets the rest. */
  readonly reviewStatus?: string;
}

/** Creates one `competitor_observation` row; opens `pending` by default. */
export async function createCompetitorObservation(
  db: Database,
  input: CreateCompetitorObservationInput,
): Promise<CompetitorObservation> {
  const rows = await db
    .insert(competitorObservation)
    .values({
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
      competitorSourceId: input.competitorSourceId ?? null,
      captureMethod: input.captureMethod ?? null,
      productCategory: input.productCategory ?? null,
      season: input.season ?? null,
      ...(input.provenance === undefined ? {} : { provenance: input.provenance }),
      ...(input.reviewStatus === undefined ? {} : { reviewStatus: input.reviewStatus }),
    })
    .returning();
  return rows[0]!;
}

export interface FindCompetitorObservationQuery {
  readonly organizationId: string;
  readonly observationId: string;
}

/** One observation by id, organization-scoped (`DEC-061`), or `undefined`. */
export async function findCompetitorObservation(
  db: Database,
  query: FindCompetitorObservationQuery,
): Promise<CompetitorObservation | undefined> {
  const rows = await db
    .select()
    .from(competitorObservation)
    .where(
      and(
        eq(competitorObservation.id, query.observationId),
        eq(competitorObservation.organizationId, query.organizationId),
      ),
    )
    .limit(1);
  return rows[0];
}

/**
 * The same org-scoped id select as `findCompetitorObservation`, taking the row's
 * write lock (`SELECT … FOR UPDATE`) for the rest of the surrounding
 * transaction, so two concurrent review decisions serialise instead of both
 * passing the `pending` check and both writing an audit fact.
 */
export async function lockCompetitorObservation(
  db: Database,
  query: FindCompetitorObservationQuery,
): Promise<CompetitorObservation | undefined> {
  const rows = await db
    .select()
    .from(competitorObservation)
    .where(
      and(
        eq(competitorObservation.id, query.observationId),
        eq(competitorObservation.organizationId, query.organizationId),
      ),
    )
    .for("update")
    .limit(1);
  return rows[0];
}

export interface UpdateCompetitorObservationReviewInput {
  readonly organizationId: string;
  readonly observationId: string;
  /** `reviewed` or `rejected`. */
  readonly status: string;
  readonly reviewedBy: string;
  /** `timestamptz`. */
  readonly reviewedAt: Date;
}

/**
 * Sets the one-shot review decision on a `pending` observation,
 * organization-scoped (`DEC-061`). The `WHERE … review_status = 'pending'`
 * guard makes the transition single-shot at the database: a second decision
 * matches nothing and returns `undefined`, so concurrent reviewers cannot both
 * win (even without the row lock).
 */
export async function updateCompetitorObservationReview(
  db: Database,
  input: UpdateCompetitorObservationReviewInput,
): Promise<CompetitorObservation | undefined> {
  const rows = await db
    .update(competitorObservation)
    .set({
      reviewStatus: input.status,
      reviewedBy: input.reviewedBy,
      reviewedAt: input.reviewedAt,
    })
    .where(
      and(
        eq(competitorObservation.id, input.observationId),
        eq(competitorObservation.organizationId, input.organizationId),
        eq(competitorObservation.reviewStatus, "pending"),
      ),
    )
    .returning();
  return rows[0];
}

export interface ListCompetitorObservationsQuery {
  readonly organizationId: string;
  readonly competitorId?: string;
  /** One of `COMPETITOR_REVIEW_STATUS`, exact match. */
  readonly status?: string;
  /** Inclusive lower bound on `observed_at` (`>= from`). */
  readonly from?: Date;
  /** Exclusive upper bound on `observed_at` (`< to`) — a half-open window. */
  readonly to?: Date;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * `competitor_observation` rows for one organization, newest `observed_at`
 * first (then id), with optional competitor/status/`observed_at` filters. The
 * window is **half-open** `[from, to)` (`from <= observed_at < to`), matching
 * the flow-window convention. The organization filter is never optional
 * (`DEC-061`); paging is applied after the ordering.
 */
export async function listCompetitorObservations(
  db: Database,
  query: ListCompetitorObservationsQuery,
): Promise<readonly CompetitorObservation[]> {
  const statement = db
    .select()
    .from(competitorObservation)
    .where(
      and(
        eq(competitorObservation.organizationId, query.organizationId),
        query.competitorId === undefined
          ? undefined
          : eq(competitorObservation.competitorId, query.competitorId),
        query.status === undefined
          ? undefined
          : eq(competitorObservation.reviewStatus, query.status),
        query.from === undefined ? undefined : gte(competitorObservation.observedAt, query.from),
        query.to === undefined ? undefined : lt(competitorObservation.observedAt, query.to),
      ),
    )
    .orderBy(desc(competitorObservation.observedAt), asc(competitorObservation.id))
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}

export interface FindProductVariantForFinishedGoodItemQuery {
  readonly organizationId: string;
  readonly itemId: string;
}

/**
 * The `product_variant` whose `finished_good_item_id` is `itemId`, in the same
 * organization, or `undefined`. The comparison read's bridge from an
 * observation's comparable `item_id` to the `price_version` scope (which is
 * keyed by variant). A variant is chosen deterministically (id-ascending) when
 * an item backs more than one.
 */
export async function findProductVariantForFinishedGoodItem(
  db: Database,
  query: FindProductVariantForFinishedGoodItemQuery,
): Promise<{ readonly id: string } | undefined> {
  const rows = await db
    .select({ id: productVariant.id })
    .from(productVariant)
    .where(
      and(
        eq(productVariant.organizationId, query.organizationId),
        eq(productVariant.finishedGoodItemId, query.itemId),
      ),
    )
    .orderBy(asc(productVariant.id))
    .limit(1);
  return rows[0];
}

/** The organization's ISO currency (`organization.currency`), or `undefined`. */
export async function findOrganizationCurrency(
  db: Database,
  query: { readonly organizationId: string },
): Promise<string | undefined> {
  const rows = await db
    .select({ currency: organization.currency })
    .from(organization)
    .where(eq(organization.id, query.organizationId))
    .limit(1);
  return rows[0]?.currency;
}

/*
 * `ADR-0010` / `DEC-143` (`COMP-001`): the `competitor_source` repository.
 *
 * Every read/write is organization-scoped (`DEC-061`); a cross-organization id
 * is an org-scoped miss. The two structural invariants
 * (`collection_mode = 'automated'` requires `terms_status = 'approved'`, and a
 * non-`pending` terms decision records `approved_by`/`approved_at`) are
 * database-backed, so this layer does not re-validate them; the application
 * validates first so a caller sees a `DomainError`. Like the rest of this
 * module, no `audit_event` is written here — the application writes the facts.
 */

export interface CreateCompetitorSourceInput {
  readonly organizationId: string;
  readonly competitorName: string;
  readonly competitorId: string | null;
  readonly sourceType: string;
  readonly urlOrIdentifier: string;
  readonly collectionMode: string;
  readonly termsStatus: string;
  readonly approvedBy: string | null;
  /** `timestamptz`. */
  readonly approvedAt: Date | null;
  readonly rateLimitNote: string | null;
  /** ISO date (`YYYY-MM-DD`). */
  readonly activeFrom: string;
  readonly createdBy: string | null;
}

/** Creates one `competitor_source` row; `(organization_id, url_or_identifier)` is unique. */
export async function createCompetitorSource(
  db: Database,
  input: CreateCompetitorSourceInput,
): Promise<CompetitorSource> {
  const rows = await db
    .insert(competitorSource)
    .values({
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
      createdBy: input.createdBy,
    })
    .returning();
  return rows[0]!;
}

export interface FindCompetitorSourceQuery {
  readonly organizationId: string;
  readonly sourceId: string;
}

/** One source by id, organization-scoped (`DEC-061`), or `undefined`. */
export async function findCompetitorSource(
  db: Database,
  query: FindCompetitorSourceQuery,
): Promise<CompetitorSource | undefined> {
  const rows = await db
    .select()
    .from(competitorSource)
    .where(
      and(
        eq(competitorSource.id, query.sourceId),
        eq(competitorSource.organizationId, query.organizationId),
      ),
    )
    .limit(1);
  return rows[0];
}

/** The same org-scoped id select, taking the row's write lock for the transaction. */
export async function lockCompetitorSource(
  db: Database,
  query: FindCompetitorSourceQuery,
): Promise<CompetitorSource | undefined> {
  const rows = await db
    .select()
    .from(competitorSource)
    .where(
      and(
        eq(competitorSource.id, query.sourceId),
        eq(competitorSource.organizationId, query.organizationId),
      ),
    )
    .for("update")
    .limit(1);
  return rows[0];
}

/** One source by its `(organization_id, url_or_identifier)` unique key, or `undefined`. */
export async function findCompetitorSourceByUrl(
  db: Database,
  query: { readonly organizationId: string; readonly urlOrIdentifier: string },
): Promise<CompetitorSource | undefined> {
  const rows = await db
    .select()
    .from(competitorSource)
    .where(
      and(
        eq(competitorSource.organizationId, query.organizationId),
        eq(competitorSource.urlOrIdentifier, query.urlOrIdentifier),
      ),
    )
    .limit(1);
  return rows[0];
}

export interface UpdateCompetitorSourceTermsInput {
  readonly organizationId: string;
  readonly sourceId: string;
  /** `approved` or `rejected`. */
  readonly termsStatus: string;
  readonly approvedBy: string;
  /** `timestamptz`. */
  readonly approvedAt: Date;
  readonly updatedBy: string;
}

/** Sets the terms decision (and its actor/instant) on one org-scoped source. */
export async function updateCompetitorSourceTerms(
  db: Database,
  input: UpdateCompetitorSourceTermsInput,
): Promise<CompetitorSource | undefined> {
  const rows = await db
    .update(competitorSource)
    .set({
      termsStatus: input.termsStatus,
      approvedBy: input.approvedBy,
      approvedAt: input.approvedAt,
      updatedAt: new Date(),
      updatedBy: input.updatedBy,
    })
    .where(
      and(
        eq(competitorSource.id, input.sourceId),
        eq(competitorSource.organizationId, input.organizationId),
      ),
    )
    .returning();
  return rows[0];
}

export interface DeactivateCompetitorSourceInput {
  readonly organizationId: string;
  readonly sourceId: string;
  /** ISO date (`YYYY-MM-DD`). */
  readonly activeTo: string;
  readonly updatedBy: string;
}

/** Ends one org-scoped source's active window by setting `active_to`. */
export async function deactivateCompetitorSource(
  db: Database,
  input: DeactivateCompetitorSourceInput,
): Promise<CompetitorSource | undefined> {
  const rows = await db
    .update(competitorSource)
    .set({
      activeTo: input.activeTo,
      updatedAt: new Date(),
      updatedBy: input.updatedBy,
    })
    .where(
      and(
        eq(competitorSource.id, input.sourceId),
        eq(competitorSource.organizationId, input.organizationId),
      ),
    )
    .returning();
  return rows[0];
}

export interface ListCompetitorSourcesQuery {
  readonly organizationId: string;
  /** `true` → open-ended (`active_to is null`); `false` → ended. */
  readonly active?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

/** Sources for one organization, competitor-name then url ascending, paged. */
export async function listCompetitorSources(
  db: Database,
  query: ListCompetitorSourcesQuery,
): Promise<readonly CompetitorSource[]> {
  const statement = db
    .select()
    .from(competitorSource)
    .where(
      and(
        eq(competitorSource.organizationId, query.organizationId),
        query.active === undefined
          ? undefined
          : query.active
            ? isNull(competitorSource.activeTo)
            : isNotNull(competitorSource.activeTo),
      ),
    )
    .orderBy(
      asc(competitorSource.competitorName),
      asc(competitorSource.urlOrIdentifier),
      asc(competitorSource.id),
    )
    .$dynamic();
  if (query.limit !== undefined) {
    statement.limit(query.limit);
  }
  if (query.offset !== undefined) {
    statement.offset(query.offset);
  }
  return statement;
}
