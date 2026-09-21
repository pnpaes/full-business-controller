import { sql } from "drizzle-orm";
import { boolean, check, index, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";

import { auditColumns, enumCheck, orgId, quantity, tstz, uuidPk } from "./columns";
import { location, organization, storageArea } from "./organization";
import { CHECK_FREQUENCY, MONITORING_POINT_KIND } from "./vocabularies";

/*
 * `DEC-089` (`HMS-002`): the HMS & food-safety (IK-mat) monitoring slice. One
 * `monitoring_point` row is one place whose temperature (or similar measure) is
 * checked on a cadence — a fridge, freezer, cooler or hot-holding unit — with a
 * target range and a check frequency. A point belongs to an organization
 * (`DEC-061`) and a location, and optionally to a storage area inside it.
 *
 * `(organization_id, code)` is unique, so a code identifies exactly one point
 * within an organization (the `location`/`file_object` precedent). The target
 * bounds are `numeric(19,6)` (quantity scale, decimal only — never floats,
 * `13_AGENT_BUILD_BRIEF.md`) and `target_min <= target_max` is a database check,
 * so an inverted range cannot be stored. `kind` and `check_frequency` are
 * constrained against the `monitoring_point_kind` / `check_frequency`
 * vocabularies; `unit` stays provisional free text (e.g. `celsius`) because the
 * measured-unit set has no closed vocabulary yet (the `DEC-071` precedent).
 */
export const monitoringPoint = pgTable(
  "monitoring_point",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => location.id),
    storageAreaId: uuid("storage_area_id").references(() => storageArea.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    unit: text("unit").notNull(),
    targetMin: quantity("target_min").notNull(),
    targetMax: quantity("target_max").notNull(),
    checkFrequency: text("check_frequency").notNull(),
    active: boolean("active").notNull().default(true),
    ...auditColumns(),
  },
  (t) => [
    unique("monitoring_point_organization_id_code_key").on(t.organizationId, t.code),
    check("monitoring_point_kind_check", enumCheck(t.kind, MONITORING_POINT_KIND)),
    check("monitoring_point_check_frequency_check", enumCheck(t.checkFrequency, CHECK_FREQUENCY)),
    check("monitoring_point_target_range_check", sql`${t.targetMin} <= ${t.targetMax}`),
  ],
);

/*
 * `DEC-089` (`HMS-002`): the append-only monitoring fact. One row is one
 * recorded reading — the value, its unit, the measurement instant, the operator
 * and the derived `in_range` flag (`isReadingInRange`, `packages/domain`). The
 * fact is append-only: the `0038` trigger rejects an UPDATE of `value`, `unit`,
 * `measured_at`, `monitoring_point_id` or `organization_id` and rejects a
 * DELETE; only `notes` may be amended (with the audit columns recording it).
 *
 * `recorded_by` is a plain uuid (the `app_user` FK is deferred, like
 * `created_by`). The `(organization_id, monitoring_point_id, measured_at)`
 * index covers the per-point time-series read. `in_range` is stored (not
 * computed on read) so the range verdict at record time is preserved even if a
 * point's targets later change; the application derives it through the domain
 * primitive before writing.
 */
export const monitoringReading = pgTable(
  "monitoring_reading",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    monitoringPointId: uuid("monitoring_point_id")
      .notNull()
      .references(() => monitoringPoint.id),
    value: quantity("value").notNull(),
    unit: text("unit").notNull(),
    measuredAt: tstz("measured_at").notNull(),
    recordedBy: uuid("recorded_by"),
    inRange: boolean("in_range").notNull(),
    notes: text("notes"),
    ...auditColumns(),
  },
  (t) => [
    index("monitoring_reading_org_point_measured_idx").on(
      t.organizationId,
      t.monitoringPointId,
      t.measuredAt,
    ),
  ],
);
