CREATE TABLE "price_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_variant_id" uuid NOT NULL,
	"location_id" uuid,
	"channel_id" uuid,
	"gross_price" numeric(19, 4) NOT NULL,
	"net_price" numeric(19, 4) NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"approved_by" uuid NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"source_scenario_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_version_price_check" CHECK ("price_version"."gross_price" >= 0 and "price_version"."net_price" >= 0),
	CONSTRAINT "price_version_effective_range_check" CHECK ("price_version"."effective_to" is null or "price_version"."effective_to" > "price_version"."effective_from")
);
--> statement-breakpoint
ALTER TABLE "price_version" ADD CONSTRAINT "price_version_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_version" ADD CONSTRAINT "price_version_product_variant_id_product_variant_id_fk" FOREIGN KEY ("product_variant_id") REFERENCES "public"."product_variant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_version" ADD CONSTRAINT "price_version_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_version" ADD CONSTRAINT "price_version_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_version" ADD CONSTRAINT "price_version_source_scenario_id_price_scenario_id_fk" FOREIGN KEY ("source_scenario_id") REFERENCES "public"."price_scenario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "price_version_scope_idx" ON "price_version" USING btree ("organization_id","product_variant_id","location_id","channel_id","effective_from");--> statement-breakpoint
-- Hand-written invariants (mirrors 0002 / 0005 / 0010 / 0012 / 0016 / 0017 /
-- 0020 / 0021 / 0023 / 0024).
-- DEC-077: an approved price version is effective for exactly one
-- (organization_id, product_variant_id, location_id, channel_id) scope over a
-- half-open [effective_from, effective_to) window, and two windows for the same
-- scope must not overlap (an overlapping approval is rejected, never silently
-- superseded). `effective_to` null means the window is open-ended; `[)` means the
-- `effective_to` instant belongs to the next window, so adjacent windows sharing
-- a boundary are legal while a true overlap is not -- the same effective-dating
-- rule as the slice-6 cost-allocation exclusions (0012) and the DEC-072
-- tolerance exclusion (0024).
--
-- The COALESCE sentinel is what makes a null `location_id`/`channel_id` ONE
-- "any location"/"any channel" scope rather than an unlimited number of scopes:
-- in an EXCLUDE constraint a null is never equal to anything (not even another
-- null), so without normalization two rows that both mean "any channel" would
-- both be allowed and the rule could be bypassed by leaving the columns null.
-- Normalizing null to the all-zero uuid treats every null as the same value, so
-- the `=` comparison sees one scope and the `&&` overlap is rejected. (This is
-- the EXCLUDE-constraint equivalent of the `NULLS NOT DISTINCT` partial unique
-- index in 0016.)
--
-- Emitted here rather than in the generated CREATE TABLE because drizzle-kit has
-- no representation for `EXCLUDE USING gist`: the columns stay plain
-- `uuid`/`timestamptz` in the TypeScript schema, so `generate` never sees or
-- fights this constraint (hand-written invariants convention).
--
-- `btree_gist` is already enabled in `0000_enable_extensions.sql`; the `=`
-- operators on `uuid` and the `&&` operator on `tstzrange` in an EXCLUDE
-- constraint require it.
ALTER TABLE "price_version" ADD CONSTRAINT "price_version_no_overlap"
  EXCLUDE USING gist (
    "organization_id" WITH =,
    "product_variant_id" WITH =,
    COALESCE("location_id", '00000000-0000-0000-0000-000000000000'::uuid) WITH =,
    COALESCE("channel_id", '00000000-0000-0000-0000-000000000000'::uuid) WITH =,
    tstzrange("effective_from", "effective_to", '[)') WITH &&
  );