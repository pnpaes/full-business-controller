import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";

import { auditColumns, enumCheck, orgId, tstz, uuidPk } from "./columns";
import { organization } from "./organization";
import { fileObject } from "./platform";
import { DOCUMENT_AUDIENCE, DOCUMENT_CATEGORY, STAFF_DOCUMENT_STATUS } from "./vocabularies";

/*
 * `DEC-088` (`DOC-001`…`DOC-004`): the staff document library — internal
 * routines, guidelines, policies and forms with versions and per-user
 * acknowledgement tracking. One `document` row is one organization-scoped
 * document; `(organization_id, ...)` scoping is per `DEC-061`.
 *
 * `category` and `audience` are checked against the `document_category` /
 * `document_audience` vocabularies and `status` against `staff_document_status`
 * (`draft` → `published` → `archived`, defaulting to `draft`). `owner_id` is a
 * **plain uuid** rather than an `app_user` FK, deferred repo-wide (the
 * `hms_incident.owner_id` / `DEC-095` precedent). Visibility (all staff may read
 * a published `all_staff` document; managers publish) is an access-matrix rule
 * enforced above this layer — the schema stores the audience only.
 *
 * `status` is a `staff_document_status` value, deliberately **not** the generic
 * `DOCUMENT_STATUS` (`draft`/`submitted`/`approved`/`rejected`/`retired`) that
 * `recipe_version` uses; the two vocabularies are distinct yaml keys.
 */
export const document = pgTable(
  "document",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    title: text("title").notNull(),
    category: text("category").notNull(),
    audience: text("audience").notNull(),
    status: text("status").notNull().default("draft"),
    ownerId: uuid("owner_id"),
    ...auditColumns(),
  },
  (t) => [
    check("document_category_check", enumCheck(t.category, DOCUMENT_CATEGORY)),
    check("document_audience_check", enumCheck(t.audience, DOCUMENT_AUDIENCE)),
    check("document_status_check", enumCheck(t.status, STAFF_DOCUMENT_STATUS)),
    index("document_org_status_idx").on(t.organizationId, t.status),
    index("document_org_audience_idx").on(t.organizationId, t.audience),
  ],
);

/*
 * `DEC-088` (`DOC-002`): one version of a `document`. `version_no` is a manual,
 * per-document counter (`unique (document_id, version_no)`), deliberately named
 * `version_no` and **not** `version` because `auditColumns()` already owns a
 * `version` row counter — mirrors `recipe_version.version_no`.
 *
 * `file_object_id` is a **nullable real FK** to `file_object.id` (the `DEC-085`
 * platform table): the version metadata can be recorded before any bytes are
 * attached, and the storage/upload path stays deferred (`DEC-085`); a null
 * reference is accepted. `published_at`/`published_by` are an all-or-nothing
 * pair — both null (draft) or both set (published) — enforced by
 * `document_version_published_check`; publishing also stamps the audit columns
 * (`updated_at`/`updated_by`) at the repository layer.
 */
export const documentVersion = pgTable(
  "document_version",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    documentId: uuid("document_id")
      .notNull()
      .references(() => document.id),
    versionNo: integer("version_no").notNull(),
    fileObjectId: uuid("file_object_id").references(() => fileObject.id),
    notes: text("notes"),
    publishedAt: tstz("published_at"),
    publishedBy: uuid("published_by"),
    ...auditColumns(),
  },
  (t) => [
    check("document_version_version_no_check", sql`${t.versionNo} > 0`),
    check(
      "document_version_published_check",
      sql`(${t.publishedAt} is null and ${t.publishedBy} is null) or (${t.publishedAt} is not null and ${t.publishedBy} is not null)`,
    ),
    unique("document_version_document_version_key").on(t.documentId, t.versionNo),
    index("document_version_org_document_idx").on(t.organizationId, t.documentId),
  ],
);

/*
 * `DEC-088` (`DOC-004`): the per-user acknowledgement fact — one row records
 * that one user acknowledged one version at one instant. Acknowledgement
 * tracking is optional per document (an application concern); the schema only
 * stores the facts.
 *
 * Like the `import_disposition` fact-table precedent, this table carries **no
 * `auditColumns()`**: the row itself holds its actor (`acknowledged_by`) and
 * instant (`acknowledged_at`), so `created_by`/`version` would be redundant.
 * `acknowledged_by` is a plain uuid (the `app_user` FK is deferred repo-wide).
 * `unique (document_version_id, acknowledged_by)` makes an acknowledgement
 * idempotent per user per version.
 */
export const documentAcknowledgement = pgTable(
  "document_acknowledgement",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => documentVersion.id),
    acknowledgedBy: uuid("acknowledged_by").notNull(),
    acknowledgedAt: tstz("acknowledged_at").notNull(),
  },
  (t) => [
    unique("document_acknowledgement_version_user_key").on(t.documentVersionId, t.acknowledgedBy),
    index("document_acknowledgement_org_version_idx").on(t.organizationId, t.documentVersionId),
    index("document_acknowledgement_org_user_idx").on(t.organizationId, t.acknowledgedBy),
  ],
);
