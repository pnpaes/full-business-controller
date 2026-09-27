import { sql } from "drizzle-orm";
import { char, check, date, index, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";

import { item } from "./catalog";
import {
  auditColumns,
  enumCheck,
  jsonObject,
  money,
  orgId,
  rangeCheck,
  tstz,
  uuidPk,
} from "./columns";
import { organization } from "./organization";
import {
  COMPETITOR_COLLECTION_MODE,
  COMPETITOR_REVIEW_STATUS,
  COMPETITOR_SOURCE_TYPE,
  COMPETITOR_TERMS_STATUS,
} from "./vocabularies";

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
 *
 * `ADR-0010` (accepted 2026-09-27) / `DEC-143` (row 18a, `DEC-149`) adds the
 * `competitor_source` table and **extends** the existing `competitor_observation`
 * additively (nullable columns only; migration `0076`). Automated collection is
 * permitted only for an approved, permitted source: the
 * `competitor_source_automation_requires_approval_check` is the structural
 * backstop, and every terms decision records who decided and when. The §4C
 * `review_state` **is** the existing `review_status` (no second state column).
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

/*
 * `ADR-0010` / `DEC-143` (`COMP-001`): one approved **source** of competitor
 * intelligence. `competitor_name` is the competitor label (several sources may
 * share it); `competitor_id` is a nullable plain uuid link to the internal
 * `competitor` master, deliberately without an FK while that link is deferred.
 *
 * The two invariants are structural. `collection_mode = 'automated'` requires
 * `terms_status = 'approved'` (automation is never enabled before the source's
 * terms are approved), and any non-`pending` terms decision must record both
 * `approved_by` and `approved_at` (no silent decision). `approved_by` is a plain
 * uuid (the deferred `app_user` FK convention, the `ai_suggestion.decided_by`
 * precedent). One source per `(organization_id, url_or_identifier)`.
 *
 * The `active_from`/`active_to` window is `date`-typed; a source ends by setting
 * `active_to` (deactivation is a range edit, not a delete).
 */
export const competitorSource = pgTable(
  "competitor_source",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    /** The competitor label; a competitor may have several sources. */
    competitorName: text("competitor_name").notNull(),
    /** Optional link to the internal competitor master (deferred slice; no FK). */
    competitorId: uuid("competitor_id"),
    /** A `COMPETITOR_SOURCE_TYPE` value (`instagram_manual` is never scraped). */
    sourceType: text("source_type").notNull(),
    /** The public URL or a source-specific identifier. */
    urlOrIdentifier: text("url_or_identifier").notNull(),
    /** A `COMPETITOR_COLLECTION_MODE` value; `automated` requires `approved`. */
    collectionMode: text("collection_mode").notNull(),
    /** A `COMPETITOR_TERMS_STATUS` value; `pending` on capture. */
    termsStatus: text("terms_status").notNull().default("pending"),
    /** Who decided the terms (plain uuid, deferred `app_user` FK). */
    approvedBy: uuid("approved_by"),
    /** When the terms were decided. */
    approvedAt: tstz("approved_at"),
    /** `robots.txt`/rate-limit and collection config notes. */
    rateLimitNote: text("rate_limit_note"),
    activeFrom: date("active_from").notNull(),
    activeTo: date("active_to"),
    ...auditColumns(),
  },
  (t) => [
    check("competitor_source_source_type_check", enumCheck(t.sourceType, COMPETITOR_SOURCE_TYPE)),
    check(
      "competitor_source_collection_mode_check",
      enumCheck(t.collectionMode, COMPETITOR_COLLECTION_MODE),
    ),
    check(
      "competitor_source_terms_status_check",
      enumCheck(t.termsStatus, COMPETITOR_TERMS_STATUS),
    ),
    check("competitor_source_name_check", sql`length(btrim(${t.competitorName})) > 0`),
    check("competitor_source_url_check", sql`length(btrim(${t.urlOrIdentifier})) > 0`),
    check(
      "competitor_source_automation_requires_approval_check",
      sql`${t.collectionMode} <> 'automated' or ${t.termsStatus} = 'approved'`,
    ),
    check(
      "competitor_source_terms_decision_check",
      sql`${t.termsStatus} = 'pending' or (${t.approvedBy} is not null and ${t.approvedAt} is not null)`,
    ),
    check("competitor_source_active_range_check", rangeCheck(t.activeFrom, t.activeTo)),
    unique("competitor_source_organization_id_url_key").on(t.organizationId, t.urlOrIdentifier),
    index("competitor_source_org_idx").on(t.organizationId),
  ],
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
    /** `ADR-0010`/`DEC-143`: the source this observation was captured from. */
    competitorSourceId: uuid("competitor_source_id").references(() => competitorSource.id),
    /** `ADR-0010`/`DEC-143`: a `COMPETITOR_COLLECTION_MODE` value, or null. */
    captureMethod: text("capture_method"),
    productCategory: text("product_category"),
    season: text("season"),
    /** URL, capture time, method and any content hash (§4C); never personal data. */
    provenance: jsonObject("provenance").$type<Record<string, unknown>>(),
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
    check(
      "competitor_observation_capture_method_check",
      sql`${t.captureMethod} is null or ${enumCheck(t.captureMethod, COMPETITOR_COLLECTION_MODE)}`,
    ),
    index("competitor_observation_org_observed_idx").on(t.organizationId, t.observedAt),
    index("competitor_observation_competitor_observed_idx").on(t.competitorId, t.observedAt),
    index("competitor_observation_source_idx").on(t.competitorSourceId),
  ],
);
