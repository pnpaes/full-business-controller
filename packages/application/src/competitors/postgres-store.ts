import * as repo from "@aquarela/persistence";
import type { Database, NodeDatabase } from "@aquarela/persistence";

import type {
  CompetitorEffectivePrice,
  CompetitorObservationRecord,
  CompetitorRecord,
  CompetitorStore,
  NewCompetitorObservationRecord,
  NewCompetitorRecord,
  UpdateCompetitorObservationReviewRecord,
} from "./types";

/** A transaction handle has no `transaction` method of its own. */
function isNodeDatabase(db: Database): db is NodeDatabase {
  return typeof (db as NodeDatabase).transaction === "function";
}

/** `timestamptz`, ISO, or `null` — the adapter's read-side convention. */
function toIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function toCompetitor(row: repo.Competitor): CompetitorRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}

function toObservation(row: repo.CompetitorObservation): CompetitorObservationRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    competitorId: row.competitorId,
    observedAt: row.observedAt.toISOString(),
    source: row.source,
    sourceUrl: row.sourceUrl,
    itemId: row.itemId,
    externalName: row.externalName,
    price: row.price,
    currency: row.currency,
    offerNotes: row.offerNotes,
    reviewStatus: row.reviewStatus,
    reviewedBy: row.reviewedBy,
    reviewedAt: toIso(row.reviewedAt),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Adapts the persistence competitor repository to the `CompetitorStore` port:
 * `timestamptz` columns become ISO strings on read and `Date`s on write, and
 * every read/write passes the organization through so the adapter cannot escape
 * the `DEC-061` row scope.
 *
 * The comparison reads reuse the existing persistence functions: the
 * `item`→variant bridge is `findProductVariantForFinishedGoodItem` and our own
 * price is the existing `findEffectivePriceVersion`, called in the
 * organization-wide exact scope (`null` location, `null` channel) because an
 * observation carries neither dimension.
 */
export function createPostgresCompetitorStore(db: Database): CompetitorStore {
  return {
    withTransaction: async (fn) => {
      if (!isNodeDatabase(db)) {
        return fn(createPostgresCompetitorStore(db));
      }
      return db.transaction((tx) => fn(createPostgresCompetitorStore(tx)));
    },
    writeAudit: async (input) => {
      await repo.writeAuditEvent(db, input);
    },
    createCompetitor: async (input: NewCompetitorRecord) =>
      toCompetitor(
        await repo.createCompetitor(db, {
          organizationId: input.organizationId,
          name: input.name,
          notes: input.notes,
        }),
      ),
    findCompetitor: async (query) => {
      const row = await repo.findCompetitor(db, {
        organizationId: query.organizationId,
        competitorId: query.competitorId,
      });
      return row === undefined ? undefined : toCompetitor(row);
    },
    findCompetitorByName: async (query) => {
      const row = await repo.findCompetitorByName(db, {
        organizationId: query.organizationId,
        name: query.name,
      });
      return row === undefined ? undefined : toCompetitor(row);
    },
    listCompetitors: async (query) => {
      const rows = await repo.listCompetitors(db, {
        organizationId: query.organizationId,
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.offset === undefined ? {} : { offset: query.offset }),
      });
      return rows.map(toCompetitor);
    },
    createObservation: async (input: NewCompetitorObservationRecord) =>
      toObservation(
        await repo.createCompetitorObservation(db, {
          organizationId: input.organizationId,
          competitorId: input.competitorId,
          observedAt: new Date(input.observedAt),
          source: input.source,
          sourceUrl: input.sourceUrl,
          itemId: input.itemId,
          externalName: input.externalName,
          price: input.price,
          currency: input.currency,
          offerNotes: input.offerNotes,
        }),
      ),
    findObservation: async (query) => {
      const row = await repo.findCompetitorObservation(db, {
        organizationId: query.organizationId,
        observationId: query.observationId,
      });
      return row === undefined ? undefined : toObservation(row);
    },
    lockObservation: async (query) => {
      const row = await repo.lockCompetitorObservation(db, {
        organizationId: query.organizationId,
        observationId: query.observationId,
      });
      return row === undefined ? undefined : toObservation(row);
    },
    updateObservationReview: async (input: UpdateCompetitorObservationReviewRecord) => {
      const row = await repo.updateCompetitorObservationReview(db, {
        organizationId: input.organizationId,
        observationId: input.observationId,
        status: input.status,
        reviewedBy: input.reviewedBy,
        reviewedAt: new Date(input.reviewedAt),
      });
      return row === undefined ? undefined : toObservation(row);
    },
    listObservations: async (query) => {
      const rows = await repo.listCompetitorObservations(db, {
        organizationId: query.organizationId,
        ...(query.competitorId === undefined ? {} : { competitorId: query.competitorId }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.from === undefined ? {} : { from: new Date(query.from) }),
        ...(query.to === undefined ? {} : { to: new Date(query.to) }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.offset === undefined ? {} : { offset: query.offset }),
      });
      return rows.map(toObservation);
    },
    findProductVariantForItem: async (query) =>
      repo.findProductVariantForFinishedGoodItem(db, {
        organizationId: query.organizationId,
        itemId: query.itemId,
      }),
    findEffectivePriceVersion: async (query): Promise<CompetitorEffectivePrice | undefined> => {
      const row = await repo.findEffectivePriceVersion(db, {
        organizationId: query.organizationId,
        productVariantId: query.productVariantId,
        locationId: null,
        channelId: null,
        asOf: new Date(query.asOf),
      });
      if (row === undefined) {
        return undefined;
      }
      return {
        priceVersionId: row.id,
        productVariantId: row.productVariantId,
        netPrice: row.netPrice,
        grossPrice: row.grossPrice,
        effectiveFrom: row.effectiveFrom.toISOString(),
      };
    },
    findOrganizationCurrency: async (query) =>
      repo.findOrganizationCurrency(db, { organizationId: query.organizationId }),
  };
}
