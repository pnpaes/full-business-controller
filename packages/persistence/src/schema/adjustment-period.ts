import { sql } from "drizzle-orm";
import { check, date, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { auditColumns, enumCheck, orgId, tstz, uuidPk } from "./columns";
import { organization } from "./organization";
import { ADJUSTMENT_PERIOD_STATUS } from "./vocabularies";

/*
 * `REC-006`, `DEC-027` (row 13b): the adjustment-period slice's only table. An
 * `adjustment_period` is a **management-declared correction window** — a date
 * range (`opened_from`…`opened_to`) during which otherwise locked periods may be
 * corrected — with a required `reason` and a single-stage approval. It is
 * organization-scoped, not location-scoped (`DATA_DICTIONARY` §8 has no
 * `location_id`), so `(organization_id, ...)` scoping is per `DEC-061`.
 *
 * `status` is checked against the `adjustment_period_status` vocabulary and
 * defaults to `open`; the machine is `open` → `closed` and both states are
 * reachable through the API. `approved_by`/`approved_at` are a nullable
 * plain-uuid actor and instant (the `app_user` FK is deferred repo-wide, the
 * `period_close.locked_by` precedent), kept **all-or-nothing** by a database
 * check; opening records the actor and `now()` in one stage (the single-stage
 * approval recorded provisionally, mirroring `DEC-103`'s worked-hours
 * adjustment).
 *
 * `opened_to >= opened_from` is checked so an inverted window is a database
 * error, not a silently empty range. The **partial unique**
 * `adjustment_period_open_key` on `(organization_id) WHERE status = 'open'`
 * enforces at most one open adjustment period per organization at a time — the
 * race-safe backstop for `openAdjustmentPeriod`, which refuses a second open
 * period in the application.
 */
export const adjustmentPeriod = pgTable(
  "adjustment_period",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    openedFrom: date("opened_from").notNull(),
    openedTo: date("opened_to").notNull(),
    reason: text("reason").notNull(),
    approvedBy: uuid("approved_by"),
    approvedAt: tstz("approved_at"),
    status: text("status").notNull().default("open"),
    ...auditColumns(),
  },
  (t) => [
    check("adjustment_period_status_check", enumCheck(t.status, ADJUSTMENT_PERIOD_STATUS)),
    check("adjustment_period_range_check", sql`${t.openedTo} >= ${t.openedFrom}`),
    check(
      "adjustment_period_approved_check",
      sql`(${t.approvedBy} is null and ${t.approvedAt} is null) or (${t.approvedBy} is not null and ${t.approvedAt} is not null)`,
    ),
    uniqueIndex("adjustment_period_open_key")
      .on(t.organizationId)
      .where(sql`${t.status} = 'open'`),
    index("adjustment_period_org_status_idx").on(t.organizationId, t.status),
    index("adjustment_period_org_opened_idx").on(t.organizationId, t.openedFrom),
  ],
);
