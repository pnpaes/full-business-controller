import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { auditColumns, enumCheck, orgId, quantity, tstz, uuidPk } from "./columns";
import { location, organization, storageArea } from "./organization";
import { fileObject } from "./platform";
import {
  CHECK_FREQUENCY,
  CHECKLIST_CATEGORY,
  CHECKLIST_RUN_STATUS,
  CORRECTIVE_ACTION_STATUS,
  INCIDENT_CATEGORY,
  INCIDENT_SEVERITY,
  INCIDENT_STATUS,
  MAINTENANCE_KIND,
  MONITORING_POINT_KIND,
} from "./vocabularies";

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

/*
 * `DEC-090` (`HMS-003`): the HMS incident register. One row is one reported
 * incident — an accident, an electrical/equipment/fire event or a near miss —
 * at a location, with when it happened and when it was reported, who reported
 * it and (per the `DEC-095` clarification) an optional owner and due date.
 * `severity` uses the `DEC-095` `incident_severity` vocabulary (NOT NULL, no
 * default); `category` and `status` are checked against their vocabularies too.
 *
 * `reported_by` and `owner_id` are plain uuids: the `app_user` FK is deferred
 * repo-wide (the `monitoring_reading.recorded_by` precedent), and `owner_id` is
 * nullable because the `DEC-095` clarification adds it to satisfy `HMS-003`'s
 * incident owner/due-date screen. `involves_personal_data` flags the privacy
 * review `DEC-090` records (the register may hold personal data). The incident
 * is not append-only, so it carries `auditColumns()` with no trigger, and the
 * `(organization_id, status, occurred_at)` index covers the register read.
 */
export const hmsIncident = pgTable(
  "hms_incident",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => location.id),
    category: text("category").notNull(),
    severity: text("severity").notNull(),
    occurredAt: tstz("occurred_at").notNull(),
    reportedAt: tstz("reported_at").notNull(),
    reportedBy: uuid("reported_by").notNull(),
    ownerId: uuid("owner_id"),
    title: text("title").notNull(),
    description: text("description"),
    dueDate: date("due_date"),
    involvesPersonalData: boolean("involves_personal_data").notNull(),
    status: text("status").notNull(),
    closedAt: tstz("closed_at"),
    ...auditColumns(),
  },
  (t) => [
    check("hms_incident_category_check", enumCheck(t.category, INCIDENT_CATEGORY)),
    check("hms_incident_severity_check", enumCheck(t.severity, INCIDENT_SEVERITY)),
    check("hms_incident_status_check", enumCheck(t.status, INCIDENT_STATUS)),
    index("hms_incident_org_status_occurred_idx").on(t.organizationId, t.status, t.occurredAt),
    index("hms_incident_org_location_idx").on(t.organizationId, t.locationId),
  ],
);

/*
 * `DEC-090` (`HMS-004`): the corrective actions raised from an incident or from
 * an out-of-range monitoring reading. Both links are nullable and independent,
 * so an action can hang off an incident, a reading, or neither (a standalone
 * improvement action); `incident_id` FKs `hms_incident` and
 * `monitoring_reading_id` FKs `monitoring_reading`. `owner_id` and `verified_by`
 * are plain uuids (the deferred `app_user` FK), `due_date` is the target date,
 * and the `open → in_progress → done → verified` lifecycle is checked against
 * `CORRECTIVE_ACTION_STATUS`.
 *
 * Evidence/photos ride the existing polymorphic `file_object` link rather than a
 * second FK column (`DEC-090`, `DEC-085`), and like the incident the table is
 * not append-only: it carries `auditColumns()` with no trigger.
 */
export const correctiveAction = pgTable(
  "corrective_action",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    incidentId: uuid("incident_id").references(() => hmsIncident.id),
    monitoringReadingId: uuid("monitoring_reading_id").references(() => monitoringReading.id),
    description: text("description").notNull(),
    ownerId: uuid("owner_id"),
    dueDate: date("due_date"),
    status: text("status").notNull(),
    completedAt: tstz("completed_at"),
    verifiedBy: uuid("verified_by"),
    verifiedAt: tstz("verified_at"),
    ...auditColumns(),
  },
  (t) => [
    check("corrective_action_status_check", enumCheck(t.status, CORRECTIVE_ACTION_STATUS)),
    index("corrective_action_org_incident_idx").on(t.organizationId, t.incidentId),
    index("corrective_action_org_status_due_idx").on(t.organizationId, t.status, t.dueDate),
  ],
);

/*
 * `DEC-091` (`HMS-005`): the IK-mat checklist slice. One `checklist_template`
 * row is one reusable checklist — its name, what kind of routine it covers
 * (`category`, where cleaning and hygiene are categories rather than separate
 * tables, the `period_close.checklist` precedent), how often it is due
 * (`frequency`, the shared `CHECK_FREQUENCY` vocabulary) and its ordered items
 * (`items` jsonb, an array). `active` retires a template without deleting it.
 *
 * `supersedes_id` satisfies `HMS-005`'s "version checklist templates": a new
 * revision is a new row that supersedes the previous one (`nullable` self-FK),
 * so every run stays pinned to the exact template row it used and a historical
 * run never silently changes meaning. A row may not supersede itself
 * (`checklist_template_supersedes_self_check`). The name is deliberately **not**
 * unique per organization — a revision legitimately reuses its predecessor's
 * name. `items` is checked to be a jsonb array; neither this table nor
 * `checklist_run` is append-only (both carry `auditColumns()`, no trigger).
 */
export const checklistTemplate = pgTable(
  "checklist_template",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    name: text("name").notNull(),
    category: text("category").notNull(),
    frequency: text("frequency").notNull(),
    items: jsonb("items")
      .notNull()
      .default(sql`'[]'::jsonb`),
    active: boolean("active").notNull().default(true),
    supersedesId: uuid("supersedes_id").references((): AnyPgColumn => checklistTemplate.id),
    ...auditColumns(),
  },
  (t) => [
    check("checklist_template_category_check", enumCheck(t.category, CHECKLIST_CATEGORY)),
    check("checklist_template_frequency_check", enumCheck(t.frequency, CHECK_FREQUENCY)),
    check("checklist_template_items_array_check", sql`jsonb_typeof(${t.items}) = 'array'`),
    check("checklist_template_supersedes_self_check", sql`${t.supersedesId} <> ${t.id}`),
    index("checklist_template_org_category_idx").on(t.organizationId, t.category),
  ],
);

/*
 * `DEC-091` (`HMS-005`): one completed (or in-progress) checklist run — the
 * fact that a template was walked at a location at an instant, by whom, with
 * the per-item outcomes (`results` jsonb, an array of
 * `CHECKLIST_ITEM_OUTCOME`-valued entries) and optional `notes`. `status`
 * defaults `in_progress` and moves to `completed`; `performed_by` is a plain
 * uuid (the `app_user` FK is deferred repo-wide, the
 * `monitoring_reading.recorded_by` precedent). There is deliberately no
 * evidence/`file_object` column (`DEC-091` does not name one).
 */
export const checklistRun = pgTable(
  "checklist_run",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    templateId: uuid("template_id")
      .notNull()
      .references(() => checklistTemplate.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => location.id),
    runAt: tstz("run_at").notNull(),
    performedBy: uuid("performed_by").notNull(),
    status: text("status").notNull().default("in_progress"),
    results: jsonb("results")
      .notNull()
      .default(sql`'[]'::jsonb`),
    notes: text("notes"),
    ...auditColumns(),
  },
  (t) => [
    check("checklist_run_status_check", enumCheck(t.status, CHECKLIST_RUN_STATUS)),
    check("checklist_run_results_array_check", sql`jsonb_typeof(${t.results}) = 'array'`),
    index("checklist_run_org_location_run_idx").on(t.organizationId, t.locationId, t.runAt),
    index("checklist_run_org_template_idx").on(t.organizationId, t.templateId),
    index("checklist_run_org_status_idx").on(t.organizationId, t.status),
  ],
);

/*
 * `DEC-092` (`HMS-006`): the equipment register and its maintenance log. One
 * `equipment` row is one registered machine or fixture at a location — its code,
 * name, free-text `kind` (`DEC-092` names no vocabulary, so the column stays
 * free text with no CHECK — the `DEC-071` precedent), optional serial number and
 * install/warranty dates. `(organization_id, code)` is unique, so a code
 * identifies exactly one equipment row within an organization (the
 * `monitoring_point`/`location` precedent); `serial_no` is nullable and **not**
 * unique. `active` retires a row without deleting it, and the non-empty checks
 * keep a blank `code`/`name` out of the register.
 *
 * This is **not** the deferred finance `asset` register: equipment is the
 * operational machine list the maintenance log hangs off.
 */
export const equipment = pgTable(
  "equipment",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => location.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    serialNo: text("serial_no"),
    installedAt: date("installed_at"),
    warrantyUntil: date("warranty_until"),
    active: boolean("active").notNull().default(true),
    ...auditColumns(),
  },
  (t) => [
    unique("equipment_organization_id_code_key").on(t.organizationId, t.code),
    check("equipment_code_nonempty_check", sql`length(btrim(${t.code})) > 0`),
    check("equipment_name_nonempty_check", sql`length(btrim(${t.name})) > 0`),
    index("equipment_org_location_idx").on(t.organizationId, t.locationId),
    index("equipment_org_active_idx").on(t.organizationId, t.active),
  ],
);

/*
 * `DEC-092` (`HMS-006`): the equipment maintenance fact log. One row is one
 * service, repair or inspection performed at an instant by an operator
 * (`performed_by` is a plain uuid — the `app_user` FK is deferred repo-wide).
 * `equipment_id` is NOT NULL, so an unregistered-equipment maintenance is
 * rejected by the FK rather than accepted as free text. `kind` is checked
 * against the `maintenance_kind` vocabulary (service/repair/inspection), and the
 * optional `file_object_id` is a **real** FK (deliberately unlike the incident
 * slice's polymorphic evidence link) so a maintenance record can carry a
 * document. The table is a fact log — the repository exposes create + read only
 * — and `DEC-092` declares neither this table nor `equipment` append-only, so
 * there is no append-only trigger (only the cross-organization guards of
 * `0045`).
 */
export const maintenanceLog = pgTable(
  "maintenance_log",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    equipmentId: uuid("equipment_id")
      .notNull()
      .references(() => equipment.id),
    kind: text("kind").notNull(),
    performedAt: tstz("performed_at").notNull(),
    performedBy: uuid("performed_by").notNull(),
    notes: text("notes"),
    fileObjectId: uuid("file_object_id").references(() => fileObject.id),
    ...auditColumns(),
  },
  (t) => [
    check("maintenance_log_kind_check", enumCheck(t.kind, MAINTENANCE_KIND)),
    index("maintenance_log_org_equipment_performed_idx").on(
      t.organizationId,
      t.equipmentId,
      t.performedAt,
    ),
    index("maintenance_log_org_kind_idx").on(t.organizationId, t.kind),
  ],
);
