-- Hand-written invariant (mirrors 0002_invariants.sql / 0005_unit_conversion_invariants.sql).
--
-- Intent (slice-4 review, "Minimax major 3"): an `accepted` receipt must not
-- carry a line with `accepted_pack_qty = 0`. The generated
-- `goods_receipt_line_accepted_pack_qty_check` only requires `>= 0`, so that
-- state was reachable and would only be caught later by the derived
-- `base_qty_accepted > 0` check (or not at all when the derived column is
-- written inconsistently).
--
-- A plain CHECK cannot express this: `status` lives on the parent
-- `goods_receipt`, and a CHECK may only reference the row being checked. A
-- BEFORE trigger that reads the parent status is the correct tool, and the
-- repository already uses triggers for cross-row invariants (see
-- `docs/runbooks/persistence-migrations.md`). The columns stay plain in the
-- TypeScript schema, so `drizzle-kit generate` never sees or fights this.

CREATE OR REPLACE FUNCTION "goods_receipt_line_accept_qty_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status text;
BEGIN
  SELECT "status" INTO parent_status
  FROM "goods_receipt"
  WHERE "id" = NEW."goods_receipt_id";

  IF parent_status = 'accepted' AND NEW."accepted_pack_qty" <= 0 THEN
    RAISE EXCEPTION
      'goods_receipt_line.accepted_pack_qty must be positive on an accepted receipt (receipt %)',
      NEW."goods_receipt_id"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "goods_receipt_line_accept_qty_guard"
  BEFORE INSERT OR UPDATE OF "accepted_pack_qty", "goods_receipt_id"
  ON "goods_receipt_line"
  FOR EACH ROW
  EXECUTE FUNCTION "goods_receipt_line_accept_qty_guard"();
