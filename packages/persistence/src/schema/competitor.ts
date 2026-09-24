import { sql } from "drizzle-orm";
import { char, check, index, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";

import { item } from "./catalog";
import { enumCheck, money, orgId, tstz, uuidPk } from "./columns";
import { organization } from "./organization";
import { COMPETITOR_REVIEW_STATUS } from "./vocabularies";

/*
 * `DEC-126` (`COMP-001…COMP-004`, Phase 4 intelligence): competitor
 * observations behind a **human-review gate** (`DEC-020`).
 *
 * `competitor` is a per-organization register of who we compare against; one
 * row per `(organization_id, name)` so `registerCompetitor` is idempotent on
 * that key. `competitor_observation` is a dated observation of one competitor's
 * named offer for a comparable we sell: `observed_at` (when it was seen),
 * `source` (a receipt, a menu photo, a website, a staff note — free text),
 * the optional `source_url`, the optional comparable `item_id` (our own
 * ingredient/finished good; nullable, because an observation may not map to a
 * comparable), the competitor's own `external_name` for it, the optional
 * `price` (`numeric(19,4)`, never float) and `currency` and the optional
 * `offer_notes`.
 *
 * The **review gate** is the point of the slice: an observation opens as
 * `pending` and may only become `reviewed` or `rejected` **once**, by a named
 * reviewer with a timestamp. `competitor_observation_review_gate_check`
 * enforces that a non-`pending` status carries both `reviewed_by` and
 * `reviewed_at`; the application forbids a second decision. Only `reviewed`
 * observations are read as intelligence (the reads default to that status).
 *
 * `currency` is a plain `char(3)` with **no default and no `NOT NULL`** (unlike
 * the shared `currency()` helper): an observation's currency is stated or
 * absent, never silently assumed to be the organization's. `(organization_id,
 * observed_at)` and `(competitor_id, observed_at)` index the two read orders.
 */
export const competitor = pgTable(
  "competitor",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    name: text("name").notNull(),
    notes: text("notes"),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [unique("competitor_organization_id_name_key").on(t.organizationId, t.name)],
);

export const competitorObservation = pgTable(
  "competitor_observation",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    competitorId: uuid("competitor_id")
      .notNull()
      .references(() => competitor.id),
    observedAt: tstz("observed_at").notNull(),
    /** Free text: a receipt, a menu photo, a website, a staff note. */
    source: text("source").notNull(),
    sourceUrl: text("source_url"),
    /** Our comparable (`item.id`); null when the offer maps to nothing we sell. */
    itemId: uuid("item_id").references(() => item.id),
    /** What the competitor calls this offer. */
    externalName: text("external_name").notNull(),
    price: money("price"),
    currency: char("currency", { length: 3 }),
    offerNotes: text("offer_notes"),
    reviewStatus: text("review_status").notNull().default("pending"),
    reviewedBy: uuid("reviewed_by"),
    reviewedAt: tstz("reviewed_at"),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "competitor_observation_review_status_check",
      enumCheck(t.reviewStatus, COMPETITOR_REVIEW_STATUS),
    ),
    check("competitor_observation_price_check", sql`${t.price} is null or ${t.price} >= 0`),
    check(
      "competitor_observation_review_gate_check",
      sql`${t.reviewStatus} = 'pending' or (${t.reviewedBy} is not null and ${t.reviewedAt} is not null)`,
    ),
    index("competitor_observation_org_observed_idx").on(t.organizationId, t.observedAt),
    index("competitor_observation_competitor_observed_idx").on(t.competitorId, t.observedAt),
  ],
);
