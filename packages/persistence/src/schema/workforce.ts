import { sql } from "drizzle-orm";
import { check, date, index, integer, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";

import { auditColumns, enumCheck, money, orgId, rangeCheck, tstz, uuidPk } from "./columns";
import { appUser } from "./identity";
import { location, organization } from "./organization";
import { fileObject } from "./platform";
import {
  EMPLOYEE_DOCUMENT_KIND,
  EMPLOYMENT_TYPE,
  SHIFT_ASSIGNMENT_STATE,
  SHIFT_STATE,
} from "./vocabularies";

/*
 * `DEC-087` (`WF-007`): the workforce slice's parent entity. One `employee` row
 * is one organization-scoped person who can be scheduled (the `shift`
 * vocabulary arrives with the scheduling slice, which is out of scope here).
 * `name` is personal data (`07_SECURITY_AND_NFR.md`); the entity is registered
 * so scheduling and personnel documents have a person to hang off.
 *
 * `(organization_id, ...)` scoping is per `DEC-061`. Employees are **retired,
 * never deleted** (`03.10`): `retired_at` records the retirement tombstone and
 * the repository exposes no delete command. `user_id` is the optional link to an
 * authenticated identity and may be null — an employee can exist without a login
 * (`03_DOMAIN_MODEL.md` §3.9, `WF-001`). `app_user` exists in this schema, so
 * the draft's real single-column FK is used rather than a plain uuid.
 *
 * `role_code` is deliberately **free text** (the draft has no CHECK): the shift
 * matching this column feeds is a later slice and the accepted `role_code`
 * vocabulary is a *platform role* list, not the employment role set. Constants:
 * `employment_type` is checked against the `employment_type` vocabulary;
 * `base_hourly_rate` is `numeric(19,4)` (money, decimal-only — never floats) and
 * must be non-negative; `cost_center_id` stays a **plain uuid** because the
 * cost-centre FK is a deferred slice (the draft's forward-reference note);
 * `active_to is null or active_to > active_from` is a database check.
 */
export const employee = pgTable(
  "employee",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    userId: uuid("user_id").references(() => appUser.id),
    name: text("name").notNull(),
    roleCode: text("role_code").notNull(),
    employmentType: text("employment_type").notNull(),
    baseHourlyRate: money("base_hourly_rate").notNull(),
    costCenterId: uuid("cost_center_id"),
    primaryLocationId: uuid("primary_location_id").references(() => location.id),
    activeFrom: date("active_from").notNull(),
    activeTo: date("active_to"),
    retiredAt: tstz("retired_at"),
    ...auditColumns(),
  },
  (t) => [
    check("employee_employment_type_check", enumCheck(t.employmentType, EMPLOYMENT_TYPE)),
    check("employee_base_hourly_rate_check", sql`${t.baseHourlyRate} >= 0`),
    check("employee_active_range_check", rangeCheck(t.activeFrom, t.activeTo)),
    // `active` is the not-retired filter, so both list filters ride this index.
    index("employee_org_active_idx").on(t.organizationId, t.retiredAt),
    index("employee_org_primary_location_idx").on(t.organizationId, t.primaryLocationId),
  ],
);

/*
 * `DEC-087` (`DOC-001`…`DOC-004`): a personnel document on the employee profile
 * — a contract, a certificate, an id document or another document class. The
 * `kind` is checked against the `employee_document_kind` vocabulary; `title` is
 * required. `file_object_id` is a **nullable real FK** to `file_object.id` (the
 * `DEC-085` platform table), so the row can record the document metadata before
 * any bytes are attached (the storage/upload path stays deferred, `DEC-085`);
 * a null reference is accepted.
 *
 * `issued_at` and `expires_at` are nullable `date`s — the certificate
 * validity window. `retention_policy` is intentionally not a column here: the
 * exact retention period per file class is a privacy-review input (`DEC-087`)
 * and must not be resolved silently. Deliberately **no revision model**: no
 * version/revision column and no `supersedes_id` — `DEC-087` defines none, and a
 * revision chain is a recorded open point. Visibility
 * (owner + general_manager + admin, finance excluded) is an access-matrix rule
 * enforced above this layer.
 */
export const employeeDocument = pgTable(
  "employee_document",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employee.id),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    fileObjectId: uuid("file_object_id").references(() => fileObject.id),
    issuedAt: date("issued_at"),
    expiresAt: date("expires_at"),
    ...auditColumns(),
  },
  (t) => [
    check("employee_document_kind_check", enumCheck(t.kind, EMPLOYEE_DOCUMENT_KIND)),
    index("employee_document_org_employee_idx").on(t.organizationId, t.employeeId),
    index("employee_document_org_kind_idx").on(t.organizationId, t.kind),
    index("employee_document_org_expires_idx").on(t.organizationId, t.expiresAt),
  ],
);

/*
 * `DEC-037`/`DEC-038` (`WF-002`): the shift-scheduling slice's parent entity.
 * One `shift` row is one organization-scoped, **location-scoped** block of work
 * with a start and end instant. `(organization_id, ...)` scoping is per
 * `DEC-061`, and `location_id` is a NOT NULL FK to `location.id`; the
 * `shift_location_org_guard` trigger (`0052`) keeps that reference in the
 * shift's own organization.
 *
 * `role_code` is deliberately nullable **free text**: the draft has no CHECK
 * and null means "any role" (the `employee.role_code` free-text precedent — the
 * accepted `role_code` vocabulary is a *platform* role list, not the employment
 * role set). `state` is checked against the `shift_state` vocabulary and
 * defaults to `open`; the state machine (`open` → `published` → `assigned`,
 * with `cancelled`/`completed` terminal) is documented **provisionally** — the
 * transitions are not yet frozen, see `DEC-102`. `break_minutes` must be
 * non-negative, `ends_at > starts_at`, and the reserved actual-time pair
 * (`actual_start`/`actual_end`, `DEC-038`) must be ordered when both are set.
 * `published_at` is set when the shift is published.
 *
 * The spec's `created_by`/`created_at` are supplied by `auditColumns()` — there
 * is deliberately **no** duplicate business `created_by`/`created_at` column, so
 * `created_by` is the plain-uuid audit actor (the `app_user` FK is deferred
 * repo-wide, like `employee.created_by`) and `created_at`/`updated_at` are the
 * standard audit instants.
 *
 * Worked hours (`shift_adjustment`) and `payroll_report` are the **next**
 * scheduling slice (`WF-004`/`WF-005`); this file does not model them.
 */
export const shift = pgTable(
  "shift",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => location.id),
    roleCode: text("role_code"),
    startsAt: tstz("starts_at").notNull(),
    endsAt: tstz("ends_at").notNull(),
    breakMinutes: integer("break_minutes").notNull().default(0),
    state: text("state").notNull().default("open"),
    publishedAt: tstz("published_at"),
    actualStart: tstz("actual_start"),
    actualEnd: tstz("actual_end"),
    ...auditColumns(),
  },
  (t) => [
    check("shift_state_check", enumCheck(t.state, SHIFT_STATE)),
    check("shift_time_range_check", sql`${t.endsAt} > ${t.startsAt}`),
    check("shift_break_minutes_check", sql`${t.breakMinutes} >= 0`),
    check(
      "shift_actual_range_check",
      sql`${t.actualEnd} is null or ${t.actualStart} is null or ${t.actualEnd} > ${t.actualStart}`,
    ),
    index("shift_org_location_starts_idx").on(t.organizationId, t.locationId, t.startsAt),
    index("shift_org_state_idx").on(t.organizationId, t.state),
  ],
);

/*
 * `DEC-037`/`DEC-038` (`WF-003`): one employee's assignment to one shift. The
 * row is organization-scoped per `DEC-061`; `shift_id` and `employee_id` are
 * NOT NULL FKs guarded same-organization by `0052`. `state` is checked against
 * the `shift_assignment_state` vocabulary (`self_assigned` → `pending_approval`
 * → `approved`, with `withdrawn`/`rejected`; the transitions are documented
 * provisionally, see `DEC-102`).
 *
 * `assigned_by` is a nullable plain uuid: null means **self-assigned** (the
 * `app_user` FK is deferred repo-wide, so no FK is declared). Self-service
 * assignment itself is **deferred pending the `WF-003` login model** — this
 * layer only stores the fact and its actor. `unique (shift_id, employee_id)`
 * allows at most one assignment per employee per shift. `assigned_at` records
 * the assignment instant.
 */
export const shiftAssignment = pgTable(
  "shift_assignment",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    shiftId: uuid("shift_id")
      .notNull()
      .references(() => shift.id),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employee.id),
    state: text("state").notNull(),
    assignedBy: uuid("assigned_by"),
    assignedAt: tstz("assigned_at").notNull(),
    ...auditColumns(),
  },
  (t) => [
    check("shift_assignment_state_check", enumCheck(t.state, SHIFT_ASSIGNMENT_STATE)),
    unique("shift_assignment_shift_employee_key").on(t.shiftId, t.employeeId),
    index("shift_assignment_org_shift_idx").on(t.organizationId, t.shiftId),
    index("shift_assignment_org_employee_idx").on(t.organizationId, t.employeeId),
  ],
);
