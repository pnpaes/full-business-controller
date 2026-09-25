import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";

import { auditColumns, enumCheck, orgId, rate, tstz, uuidPk } from "./columns";
import { channel, location, organization } from "./organization";
import { productVariant } from "./products";
import { FORECAST_GRAIN } from "./vocabularies";

/*
 * `DEC-011` / `FCST-001`–`FCST-002` (row 15): forecast-vs-actual tracking.
 *
 * `forecast_snapshot` is one recorded `computeForecast` output — a **model**,
 * not a fact — kept so it can be compared against what actually happened. It is
 * a **narrow tracking slice**: metric `revenue` (net sales) at grain
 * `day_location`. The `grain` column reuses the declared `forecast_grain`
 * allow-list, but only `day_location` is writeable today (see the ceiling note
 * below); the scope columns `location_id`/`channel_id` and the
 * `category`/`product_variant_id` pair are the grain's scope dimensions. The
 * projection is stored verbatim as a JSONB **array** of
 * `{period, value, lower, upper}` points, guarded by a `jsonb_typeof = 'array'`
 * check; the in-sample backtest accuracy is stored alongside as **nullable**
 * columns (an insufficient-history result carries none).
 *
 * `DEC-011` ceiling (recorded, not silently dropped): `DEC-011` accepted
 * forecasting at **daily location/category** grain auto-promoting to product
 * grain, while the reporting read underneath (`computeForecast` →
 * `summarizeSales`) can scope by location and channel only — it has no
 * category/product filter. So this slice implements `day_location` and
 * deliberately refuses `day_location_category`/`day_location_product` in the
 * command rather than store a snapshot that silently dropped its category or
 * product scope. The columns and the vocabulary stay in place for the wave that
 * adds the read.
 *
 * `metric` stays provisional free text (the `DEC-071` precedent): the analytics
 * metric vocabulary lives in the application, and persistence cannot import it
 * without inverting the dependency.
 *
 * Uniqueness: one row per `(organization_id, metric, grain, scope, as_of)`.
 * `NULLS NOT DISTINCT` makes the null scope a single addressable value (the
 * `unit_conversion_version_key` / `cost_card_approved_scope_key` precedent), so
 * a re-record at the same `as_of` instant collides while a later snapshot of the
 * same scope is kept as history.
 */
export const forecastSnapshot = pgTable(
  "forecast_snapshot",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    /** The analytics metric; `revenue` (net sales) for this slice. Free text. */
    metric: text("metric").notNull(),
    /** A `FORECAST_GRAIN` value; only `day_location` is writeable today. */
    grain: text("grain").notNull(),
    /** The scope location; null = organization-wide (the repo convention). */
    locationId: uuid("location_id").references(() => location.id),
    channelId: uuid("channel_id").references(() => channel.id),
    /** Populated only for `day_location_category`. */
    category: text("category"),
    /** Populated only for `day_location_product`. */
    productVariantId: uuid("product_variant_id").references(() => productVariant.id),
    /** The instant the model was fit; `computeForecast.asOf`. */
    asOf: tstz("as_of").notNull(),
    generatedAt: tstz("generated_at").notNull().defaultNow(),
    /** The stated model id (e.g. `least_squares_linear`); never a fact. */
    model: text("model").notNull(),
    /** The projected points, stored verbatim as a JSONB array. */
    projection: jsonb("projection")
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** The in-sample backtest method (`mape`), or null when not computed. */
    accuracyMethod: text("accuracy_method"),
    /** MAPE as a fraction at 6 dp (`numeric(9,6)`), never a float. */
    accuracyMape: rate("accuracy_mape"),
    accuracyPoints: integer("accuracy_points"),
    ...auditColumns(),
  },
  (t) => [
    check("forecast_snapshot_metric_check", sql`length(btrim(${t.metric})) > 0`),
    check("forecast_snapshot_grain_check", enumCheck(t.grain, FORECAST_GRAIN)),
    check(
      "forecast_snapshot_grain_scope_check",
      sql`(${t.grain} <> 'day_location_category' or ${t.category} is not null) and (${t.grain} <> 'day_location_product' or ${t.productVariantId} is not null)`,
    ),
    check("forecast_snapshot_projection_check", sql`jsonb_typeof(${t.projection}) = 'array'`),
    check(
      "forecast_snapshot_accuracy_check",
      sql`(${t.accuracyMape} is null or ${t.accuracyMape} >= 0) and (${t.accuracyPoints} is null or ${t.accuracyPoints} >= 0)`,
    ),
    unique("forecast_snapshot_org_scope_asof_key")
      .on(
        t.organizationId,
        t.metric,
        t.grain,
        t.locationId,
        t.channelId,
        t.category,
        t.productVariantId,
        t.asOf,
      )
      .nullsNotDistinct(),
    index("forecast_snapshot_org_metric_grain_idx").on(t.organizationId, t.metric, t.grain, t.asOf),
  ],
);

/*
 * `DEC-011`: one **append-only**, human-recorded override/annotation of a
 * forecast projection period. A reason is mandatory (there is no silent
 * override), the actor is a plain uuid (the deferred `app_user` FK, the
 * `monitoring_reading.recorded_by` precedent), and the row may point at the
 * `forecast_snapshot` it annotates (nullable: an override may be recorded for a
 * scope/period without a stored snapshot). It is advisory only — the tracking
 * read reports it next to the projection and **nothing auto-applies** it.
 *
 * Immutability is enforced by the `0070` trigger
 * (`forecast_override_immutable` / `forecast_override_no_truncate`, reusing the
 * shared `reject_immutable_change()` from `0002_invariants.sql`), the
 * `stock_movement`/`calculation_snapshot`/`audit_event` precedent: a correction
 * is a new row, never an edit or a delete.
 */
export const forecastOverride = pgTable(
  "forecast_override",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    /** The annotated snapshot; null when the override stands alone. */
    snapshotId: uuid("snapshot_id").references(() => forecastSnapshot.id),
    /** The analytics metric; `revenue` (net sales) for this slice. Free text. */
    metric: text("metric").notNull(),
    grain: text("grain").notNull(),
    /** The grain bucket being overridden (e.g. `2026-09-25`). */
    period: text("period").notNull(),
    locationId: uuid("location_id").references(() => location.id),
    channelId: uuid("channel_id").references(() => channel.id),
    category: text("category"),
    productVariantId: uuid("product_variant_id").references(() => productVariant.id),
    /** The acting actor; a plain uuid (the deferred `app_user` FK). */
    actorId: uuid("actor_id").notNull(),
    /** Mandatory: there is no silent override. Non-empty, enforced here and in the app. */
    reason: text("reason").notNull(),
    ...auditColumns(),
  },
  (t) => [
    check("forecast_override_metric_check", sql`length(btrim(${t.metric})) > 0`),
    check("forecast_override_grain_check", enumCheck(t.grain, FORECAST_GRAIN)),
    check(
      "forecast_override_grain_scope_check",
      sql`(${t.grain} <> 'day_location_category' or ${t.category} is not null) and (${t.grain} <> 'day_location_product' or ${t.productVariantId} is not null)`,
    ),
    check("forecast_override_period_check", sql`length(btrim(${t.period})) > 0`),
    check("forecast_override_reason_check", sql`length(btrim(${t.reason})) > 0`),
    index("forecast_override_org_metric_grain_period_idx").on(
      t.organizationId,
      t.metric,
      t.grain,
      t.period,
    ),
  ],
);
