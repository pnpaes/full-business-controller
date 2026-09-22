-- Hand-written cross-organization coherence guard for the `DEC-037` (`WF-005`)
-- monthly payroll-input report, closing its org-coherence gap:
-- `payroll_report.export_file_id` is an organization-scoped reference, but its
-- single-column FK cannot express that the referenced `file_object` belongs to
-- the same organization (`file_object` carries its own `organization_id`).
-- Mirrors `0045_equipment_org_guard.sql` (the `DEC-079`/`DEC-085` precedent): the
-- FK is authored normally, but the organization match stays a hand-written
-- `BEFORE INSERT OR UPDATE` trigger so `drizzle-kit generate` never sees or
-- fights it.
--
-- The guard is **forward-only**: it validates new writes, it does not re-validate
-- rows already present, and existence of the referenced row (as opposed to its
-- organization) stays the FK's job — a missing row falls through to the FK error
-- rather than the guard. `export_file_id` is nullable, so a null reference is
-- skipped. The application remains the friendly-error layer.
--
-- The down companion `0056_payroll_report_org_guard_down.sql` drops the trigger
-- and its function; like the other down files it is not journaled.

BEGIN;
--> statement-breakpoint

-- `payroll_report`: a non-null `export_file_id` must name a file object in the
-- report's own organization. A null reference returns untouched.
CREATE OR REPLACE FUNCTION "payroll_report_export_file_org_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  file_object_org uuid;
BEGIN
  IF NEW."export_file_id" IS NOT NULL THEN
    SELECT f."organization_id" INTO file_object_org
    FROM "file_object" f
    WHERE f."id" = NEW."export_file_id";

    IF FOUND AND file_object_org IS DISTINCT FROM NEW."organization_id" THEN
      RAISE EXCEPTION
        'payroll_report.export_file_id % belongs to organization %, but its payroll_report % belongs to organization %',
        NEW."export_file_id", file_object_org, NEW."id", NEW."organization_id"
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "payroll_report_export_file_org_guard"
  BEFORE INSERT OR UPDATE ON "payroll_report"
  FOR EACH ROW
  EXECUTE FUNCTION "payroll_report_export_file_org_guard"();
--> statement-breakpoint

COMMIT;
