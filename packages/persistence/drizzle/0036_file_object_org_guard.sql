-- Hand-written cross-organization coherence guard for
-- `import_run.file_object_id` (`ADR-0006`/`DEC-085`, closing the deferred-FK
-- shape from the row-11 import-framework point (b)). Mirrors
-- `0032_import_run_profile_org_guard.sql` / `0029_org_coherence_guards.sql`: the
-- column's FK is authored normally, but the organization match stays a
-- hand-written trigger so `drizzle-kit generate` never sees or fights it.
--
-- `import_run.file_object_id` references `file_object(id)` through a
-- single-column FK. The parent `id` is unique, so that FK cannot express that
-- the file must belong to the run's own organization: `file_object` carries its
-- own `organization_id`, and a run could otherwise point at another
-- organization's file. `DEC-079` chose `BEFORE INSERT OR UPDATE` guard triggers
-- for exactly this shape, and the `DEC-085` file FK is the same shape.
--
-- The trigger is **forward-only**: it validates new writes, it does not
-- re-validate rows already present, and existence of the file (as opposed to its
-- organization) stays the FK's job — a missing file falls through to the FK
-- error rather than the guard. The application remains the friendly-error layer.
--
-- The down companion `0036_file_object_org_guard_down.sql` drops the trigger and
-- its function; like the other down files it is not journaled.

BEGIN;
--> statement-breakpoint

-- `import_run`: a non-null `file_object_id` must name a file in the run's own
-- organization. Runs with no upload keep a null link and return immediately.
CREATE OR REPLACE FUNCTION "file_object_org_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  file_org uuid;
BEGIN
  IF NEW."file_object_id" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT f."organization_id" INTO file_org
  FROM "file_object" f
  WHERE f."id" = NEW."file_object_id";

  IF FOUND AND file_org IS DISTINCT FROM NEW."organization_id" THEN
    RAISE EXCEPTION
      'import_run.file_object_id % belongs to organization %, but its import_run % belongs to organization %',
      NEW."file_object_id", file_org, NEW."id", NEW."organization_id"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "file_object_org_guard"
  BEFORE INSERT OR UPDATE ON "import_run"
  FOR EACH ROW
  EXECUTE FUNCTION "file_object_org_guard"();
--> statement-breakpoint

COMMIT;
