-- `DEC-146` (`WF-003` slice A): employee account provisioning + invite. Employees
-- log in for their own shifts; a manager provisions the account and an invite
-- email lets the employee set their own password. Expand-only: one new table plus
-- two nullable `app_user` columns, no existing column or constraint is changed
-- (`app_user.password_hash` stays `NOT NULL` — an invited account stores a
-- non-verifying placeholder, never a NULL).
--
-- `user_invite` stores only `hashInviteToken(token)` (single-use, TTL-bounded,
-- revocable); the plaintext is delivered out of band and never stored, logged or
-- placed in a URL (`ADR-0003`). The partial unique index allows at most one live
-- invite per user (live = neither accepted nor revoked), so a re-invite revokes
-- the prior row first. `issued_by` is a plain uuid (the repo-wide deferred
-- `app_user` FK convention).
--
-- The cross-organization guard for `user_invite.user_id` is **hand-written**
-- (drizzle-kit cannot express triggers; a single-column FK cannot express the
-- organization match): the referenced `app_user.organization_id` must equal the
-- invite's `organization_id`. Mirrors `0047_workforce_org_guard.sql`. The down
-- companion `0077_user_invite_down.sql` is hand-written and not journaled:
-- `drizzle-kit migrate` applies journal entries only, so a rollback is an
-- explicit operator action (docs/runbooks/persistence-migrations.md).
CREATE TABLE "user_invite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"issued_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "user_invite_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "user_invite_expiry_check" CHECK ("user_invite"."expires_at" > "user_invite"."issued_at")
);
--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "invited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "invited_by" uuid;--> statement-breakpoint
ALTER TABLE "user_invite" ADD CONSTRAINT "user_invite_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invite" ADD CONSTRAINT "user_invite_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_invite_org_user_idx" ON "user_invite" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_invite_live_user_key" ON "user_invite" USING btree ("user_id") WHERE "user_invite"."accepted_at" is null and "user_invite"."revoked_at" is null;--> statement-breakpoint
-- Hand-written cross-organization guard (the `0047` precedent): a non-null
-- `user_invite.user_id` must name an `app_user` in the invite row's own
-- organization. Forward-only: it validates new writes and skips a missing row
-- (the FK owns existence). The down companion drops the trigger and its
-- function.
CREATE OR REPLACE FUNCTION "user_invite_user_org_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  user_org uuid;
BEGIN
  SELECT u."organization_id" INTO user_org
  FROM "app_user" u
  WHERE u."id" = NEW."user_id";

  IF FOUND AND user_org IS DISTINCT FROM NEW."organization_id" THEN
    RAISE EXCEPTION
      'user_invite.user_id % belongs to organization %, but its user_invite % belongs to organization %',
      NEW."user_id", user_org, NEW."id", NEW."organization_id"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "user_invite_user_org_guard"
  BEFORE INSERT OR UPDATE ON "user_invite"
  FOR EACH ROW
  EXECUTE FUNCTION "user_invite_user_org_guard"();
