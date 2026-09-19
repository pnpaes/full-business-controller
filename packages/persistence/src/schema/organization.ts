import { sql } from "drizzle-orm";
import { boolean, check, date, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";

import { currency, enumCheck, jsonObject, orgId, rangeCheck, tstz, uuidPk } from "./columns";
import { COST_CENTER_KIND, LOCATION_KIND, STORAGE_AREA_KIND } from "./vocabularies";

export const organization = pgTable("organization", {
  id: uuidPk(),
  legalName: text("legal_name").notNull(),
  currency: currency().notNull(),
  timezone: text("timezone").notNull().default("Europe/Oslo"),
  settings: jsonObject("settings"),
  createdAt: tstz("created_at").notNull().defaultNow(),
});

export const location = pgTable(
  "location",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull().default("operating"),
    address: text("address"),
    activeFrom: date("active_from")
      .notNull()
      .default(sql`current_date`),
    activeTo: date("active_to"),
  },
  (t) => [
    unique("location_organization_id_code_key").on(t.organizationId, t.code),
    check("location_kind_check", enumCheck(t.kind, LOCATION_KIND)),
    check("location_active_range_check", rangeCheck(t.activeFrom, t.activeTo)),
  ],
);

export const storageArea = pgTable(
  "storage_area",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => location.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    isTransit: boolean("is_transit").notNull().default(false),
  },
  (t) => [
    unique("storage_area_location_id_code_key").on(t.locationId, t.code),
    check("storage_area_kind_check", enumCheck(t.kind, STORAGE_AREA_KIND)),
  ],
);

export const channel = pgTable(
  "channel",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    isDelivery: boolean("is_delivery").notNull().default(false),
  },
  (t) => [unique("channel_organization_id_code_key").on(t.organizationId, t.code)],
);

/** `cost_center` (`DATA_DICTIONARY` §1): null `location_id` = company shared. */
export const costCenter = pgTable(
  "cost_center",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    locationId: uuid("location_id").references(() => location.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
  },
  (t) => [
    unique("cost_center_organization_id_code_key").on(t.organizationId, t.code),
    check("cost_center_kind_check", enumCheck(t.kind, COST_CENTER_KIND)),
  ],
);
