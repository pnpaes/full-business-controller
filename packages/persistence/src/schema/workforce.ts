import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { auditColumns, enumCheck, money, orgId, rangeCheck, tstz, uuidPk } from "./columns";
import { appUser, role } from "./identity";
import { location, organization } from "./organization";
import { fileObject } from "./platform";
import {
  EMPLOYEE_DOCUMENT_KIND,
  EMPLOYMENT_TYPE,
  PAYROLL_REPORT_STATUS,
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
 * `role_code` (**`DEC-151`**, 2026-09-28) is the employee's **access level**: a
 * validated reference to the organization's fixed, scoped `role` row
 * (`role(organization_id, code)` — the same rows `user_role` grants access
 * with). It is a **composite FK** `(organization_id, role_code)` because a
 * single-column FK could not keep the referenced role in the employee's own
 * organization. The column name and its values are unchanged, so the costing
 * labour-rate paths and payroll/worked-hours reads that key on the role code keep
 * working: the family of values is still the `ROLE_CODE` vocabulary, now enforced
 * structurally instead of by convention. The free employment-language aliases
 * (`kitchen staff`, `coffee shop staff`/`barista`, `manager`) are normalised to
 * their role codes by migration `0080`. Constants: `employment_type` is checked
 * against the `employment_type` vocabulary; `base_hourly_rate` is
 * `numeric(19,4)` (money, decimal-only — never floats) and must be non-negative;
 * `cost_center_id` stays a **plain uuid** because the cost-centre FK is a
 * deferred slice (the draft's forward-reference note); `active_to is null or
 * active_to > active_from` is a database check.
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
    // `DEC-151`: the employee's role is their access level — a same-organization
    // reference to the fixed, scoped `role` row. Composite because the target's
    // key is `(organization_id, code)`.
    foreignKey({
      name: "employee_organization_id_role_code_fk",
      columns: [t.organizationId, t.roleCode],
      foreignColumns: [role.organizationId, role.code],
    }),
    // `active` is the not-retired filter, so both list filters ride this index.
    index("employee_org_active_idx").on(t.organizationId, t.retiredAt),
    index("employee_org_primary_location_idx").on(t.organizationId, t.primaryLocationId),
    index("employee_org_role_code_idx").on(t.organizationId, t.roleCode),
  ],
);

/*
 * `DEC-151` (2026-09-28): the **position** catalogue — a free, organization-scoped
 * list of the jobs an employee may hold (`barista`, `cook`, `helper`, `cleaner`
 * and any others the owner adds). Unlike the fixed `role` access vocabulary, the
 * position list is open: `code` is unique **per organization** and there is no
 * closed vocabulary. `active_from`/`active_to` are the effective window (the
 * `rangeCheck` companion), so a position is deactivated rather than deleted and
 * the historical assignments keep their meaning. Positions are the staffing
 * match: a shift carries one and only an employee who holds it may take it.
 */
export const position = pgTable(
  "position",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    activeFrom: date("active_from").notNull(),
    activeTo: date("active_to"),
    ...auditColumns(),
  },
  (t) => [
    check("position_active_range_check", rangeCheck(t.activeFrom, t.activeTo)),
    unique("position_organization_id_code_key").on(t.organizationId, t.code),
    index("position_org_active_idx").on(t.organizationId, t.activeTo),
  ],
);

/*
 * `DEC-151`: the many-to-many between an employee and the positions they hold.
 * Both references are weighted organization-scoped (the `0080` guard triggers
 * mirror `0047`/`0052`); the unique pair keeps one grant, and the set is
 * **replaced** by the employee commands (`setEmployeePositions`), so the join
 * row carries only the audit pair. An employee with no positions may be
 * scheduled for nothing and self-assign nothing.
 */
export const employeePosition = pgTable(
  "employee_position",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employee.id),
    positionId: uuid("position_id")
      .notNull()
      .references(() => position.id),
    ...auditColumns(),
  },
  (t) => [
    unique("employee_position_employee_id_position_id_key").on(t.employeeId, t.positionId),
    index("employee_position_org_employee_idx").on(t.organizationId, t.employeeId),
    index("employee_position_org_position_idx").on(t.organizationId, t.positionId),
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
 * Worked hours (`shift_adjustment`, `WF-004`) and the monthly payroll-**input**
 * report (`payroll_report`, `WF-005`, `DEC-037`) are modelled below.
 */
export const shift = pgTable(
  "shift",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => location.id),
    /**
     * `DEC-151`: the position the shift is staffed for — the matching key for
     * self-assignment and the manager's assign path. Nullable: `null` means "any
     * position" (the pre-`DEC-151` null-role semantics). Expanded in `0080`;
     * `role_code` is retained beside it for now (contract later).
     */
    positionId: uuid("position_id").references(() => position.id),
    /** Legacy free-text employment role; superseded by `position_id` (`DEC-151`). */
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
    index("shift_org_position_idx").on(t.organizationId, t.positionId),
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

/*
 * `DEC-038` (`WF-004`): a manual correction to one shift assignment's derived
 * worked hours. Worked hours are derived from the registered shift; a correction
 * is recorded as a `shift_adjustment` row and **never** by editing the shift
 * (`DATA_DICTIONARY` §4A, `DEC-038`). The row is organization-scoped per
 * `DEC-061`; `shift_assignment_id` is a NOT NULL FK guarded same-organization by
 * `0054`. `adjusted_hours` is `numeric(9,2)` (hours, decimal-only — never
 * floats) and must be non-negative (`shift_adjustment_adjusted_hours_check`).
 *
 * `approved_by`/`approved_at` are a nullable plain-uuid/instant pair: the
 * `app_user` FK is deferred repo-wide, so no FK is declared, and the
 * `shift_adjustment_approved_check` enforces the all-or-nothing manager approval
 * (both set or both null). `reason` is required free text. The spec's
 * `created_at` is the `auditColumns()` one; the audit columns also supply
 * `created_by`/`updated_*`/`version`.
 */
export const shiftAdjustment = pgTable(
  "shift_adjustment",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    shiftAssignmentId: uuid("shift_assignment_id")
      .notNull()
      .references(() => shiftAssignment.id),
    adjustedHours: numeric("adjusted_hours", { precision: 9, scale: 2 }).notNull(),
    reason: text("reason").notNull(),
    approvedBy: uuid("approved_by"),
    approvedAt: tstz("approved_at"),
    ...auditColumns(),
  },
  (t) => [
    check("shift_adjustment_adjusted_hours_check", sql`${t.adjustedHours} >= 0`),
    check(
      "shift_adjustment_approved_check",
      sql`(${t.approvedBy} is null and ${t.approvedAt} is null) or (${t.approvedBy} is not null and ${t.approvedAt} is not null)`,
    ),
    index("shift_adjustment_org_assignment_idx").on(t.organizationId, t.shiftAssignmentId),
  ],
);

/*
 * `DEC-037` (`WF-005`): the monthly payroll-**input** report for the accountant,
 * produced from registered shifts plus the assumption that the remaining planned
 * shifts run as scheduled (`03_DOMAIN_MODEL.md`, `DATA_DICTIONARY` §4A). This is
 * a payroll-*input* report only: statutory payroll processing, tax withholding
 * and payslips stay out of scope. `snapshot` is the **frozen, reproducible**
 * set of lines (employee, hours, hourly rate, expected pay) captured when the
 * report is generated, so a later shift or adjustment edit cannot rewrite an
 * already-issued report; the report is generated **on demand** by the
 * application (`generatePayrollReport`), and the spec's "about 3 days before
 * month-end" trigger is an `ADR-0004`-gated job that is **not built** here.
 *
 * `(organization_id, ...)` scoping is per `DEC-061`. `generated_by` is a
 * nullable plain uuid: the `app_user` FK is deferred repo-wide (the `employee`/
 * `shift.created_by` precedent), and null means the generating actor was not
 * recorded. `status` is checked against the `payroll_report_status` vocabulary
 * and defaults to `draft`; its lifecycle is **provisional** (`DEC-104`).
 *
 * `export_file_id` is a **nullable real FK** to `file_object.id` (`DEC-085`):
 * the platform table exists now, so the reference is closed, but the storage
 * bytes / signed-URL export stays deferred — only the FK column exists.
 *
 * `unique (organization_id, period_start)` is a **provisional** rule
 * (`DEC-104`): at most one live report per organization per period start, so a
 * regeneration must supersede the prior same-period report first. It is a
 * **partial** unique index (`WHERE status <> 'superseded'`), because a plain
 * unique would keep the superseded row occupying the key and make the
 * "supersede then insert" flow impossible; superseded reports are retained as
 * history and excluded from the key. The contract's literal "one report per
 * organization per period start" is thus enforced over the *live* reports.
 * `period_end` is not part of the key because the period start identifies the
 * payroll month. `payroll_report_period_check` keeps `period_end > period_start`.
 */
export const payrollReport = pgTable(
  "payroll_report",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    generatedAt: tstz("generated_at").notNull().defaultNow(),
    generatedBy: uuid("generated_by"),
    status: text("status").notNull().default("draft"),
    snapshot: jsonb("snapshot")
      .notNull()
      .default(sql`'{}'::jsonb`),
    exportFileId: uuid("export_file_id").references(() => fileObject.id),
    ...auditColumns(),
  },
  (t) => [
    check("payroll_report_status_check", enumCheck(t.status, PAYROLL_REPORT_STATUS)),
    check("payroll_report_period_check", sql`${t.periodEnd} > ${t.periodStart}`),
    uniqueIndex("payroll_report_org_period_key")
      .on(t.organizationId, t.periodStart)
      .where(sql`${t.status} <> 'superseded'`),
    index("payroll_report_org_status_idx").on(t.organizationId, t.status),
    index("payroll_report_org_period_idx").on(t.organizationId, t.periodStart, t.periodEnd),
  ],
);
