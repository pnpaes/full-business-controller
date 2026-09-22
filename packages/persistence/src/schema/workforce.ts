import { sql } from "drizzle-orm";
import { check, date, index, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { auditColumns, enumCheck, money, orgId, rangeCheck, tstz, uuidPk } from "./columns";
import { appUser } from "./identity";
import { location, organization } from "./organization";
import { fileObject } from "./platform";
import { EMPLOYEE_DOCUMENT_KIND, EMPLOYMENT_TYPE } from "./vocabularies";

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
