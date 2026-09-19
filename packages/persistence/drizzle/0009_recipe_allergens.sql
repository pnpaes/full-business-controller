CREATE TABLE "allergen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_derived" boolean DEFAULT false NOT NULL,
	CONSTRAINT "allergen_organization_id_code_key" UNIQUE("organization_id","code")
);
--> statement-breakpoint
CREATE TABLE "recipe_allergen" (
	"recipe_version_id" uuid NOT NULL,
	"allergen_id" uuid NOT NULL,
	"source" text NOT NULL,
	"verified_by" uuid,
	CONSTRAINT "recipe_allergen_recipe_version_id_allergen_id_pk" PRIMARY KEY("recipe_version_id","allergen_id"),
	CONSTRAINT "recipe_allergen_source_check" CHECK ("recipe_allergen"."source" in ('derived', 'verified')),
	CONSTRAINT "recipe_allergen_verified_check" CHECK ("recipe_allergen"."source" <> 'verified' or "recipe_allergen"."verified_by" is not null)
);
--> statement-breakpoint
ALTER TABLE "allergen" ADD CONSTRAINT "allergen_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_allergen" ADD CONSTRAINT "recipe_allergen_recipe_version_id_recipe_version_id_fk" FOREIGN KEY ("recipe_version_id") REFERENCES "public"."recipe_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_allergen" ADD CONSTRAINT "recipe_allergen_allergen_id_allergen_id_fk" FOREIGN KEY ("allergen_id") REFERENCES "public"."allergen"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recipe_allergen_allergen_idx" ON "recipe_allergen" USING btree ("allergen_id");