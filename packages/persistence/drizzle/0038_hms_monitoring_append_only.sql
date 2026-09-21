-- Hand-written append-only guard for `monitoring_reading` (`DEC-089`,
-- `HMS-002`). Mirrors the `0002_invariants.sql` append-only trigger pattern
-- (`stock_movement_immutable`, `calculation_snapshot_immutable`,
-- `audit_event_immutable`): a row trigger rejects a prohibited mutation so a
-- reading fact cannot be edited, only superseded by a new reading.
--
-- A reading is a fact, so `value`, `unit`, `measured_at`, `monitoring_point_id`
-- and `organization_id` are immutable; `notes` is the one amendable field
-- (`DEC-089`: "notes may be amended only with an audit trail") and the standard
-- `updated_at`/`updated_by` audit columns record that amendment, so a plain
-- UPDATE that changes only `notes` (and the audit columns) is allowed. A DELETE
-- is always rejected, and a TRUNCATE (statement-level, so `NEW`/`OLD` are null)
-- is always rejected, closing the bypass the row triggers leave open.
--
-- The down companion `0038_hms_monitoring_append_only_down.sql` drops the three
-- triggers and the function; like the other down files it is not journaled.

BEGIN;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "monitoring_reading_append_only"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'monitoring_reading is append-only; TRUNCATE is not permitted';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'monitoring_reading is append-only; DELETE is not permitted';
  END IF;

  IF NEW."value" IS DISTINCT FROM OLD."value"
     OR NEW."unit" IS DISTINCT FROM OLD."unit"
     OR NEW."measured_at" IS DISTINCT FROM OLD."measured_at"
     OR NEW."monitoring_point_id" IS DISTINCT FROM OLD."monitoring_point_id"
     OR NEW."organization_id" IS DISTINCT FROM OLD."organization_id" THEN
    RAISE EXCEPTION
      'monitoring_reading is append-only; value, unit, measured_at, monitoring_point_id and organization_id are immutable (only notes may be amended)';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "monitoring_reading_immutable"
  BEFORE UPDATE ON "monitoring_reading"
  FOR EACH ROW
  EXECUTE FUNCTION "monitoring_reading_append_only"();
--> statement-breakpoint
CREATE TRIGGER "monitoring_reading_no_delete"
  BEFORE DELETE ON "monitoring_reading"
  FOR EACH ROW
  EXECUTE FUNCTION "monitoring_reading_append_only"();
--> statement-breakpoint
CREATE TRIGGER "monitoring_reading_no_truncate"
  BEFORE TRUNCATE ON "monitoring_reading"
  FOR EACH STATEMENT
  EXECUTE FUNCTION "monitoring_reading_append_only"();
--> statement-breakpoint

COMMIT;
