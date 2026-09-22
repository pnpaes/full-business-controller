# 2026-09-20 — Slice 8 finding fixes: DEC-010 role gate, per-org idempotency (`0018`), shared revaluation helper (uncommitted)

Applied three review findings to the still-uncommitted slice-8 working tree (HEAD
`f7b1db7`; nothing applied to DigitalOcean). No domain change.

- **Finding 1 — DEC-010 negative override now requires a manager role.** New
  `listActorRoleCodes(actorId)` port (`types.ts`), implemented via the existing
  `listUserRoles` repository in the Postgres adapter and a public role map in
  `FakeInventoryStore`; new `permissions.ts` holds the provisional fail-closed
  `NEGATIVE_OVERRIDE_ROLES = ["owner", "manager"]` and
  `assertNegativeOverrideAuthorized`; `postStockMovement` and
  `reverseStockMovement` call it when the override is actually used, throwing
  `DomainError("negative stock override requires manager permission")` otherwise.
  Tests: override rejected with no qualifying role (post + reverse); the existing
  owner-held override tests still pass. **Role-code correction (post-review):**
  the gate now uses the real `ROLE_CODE` vocabulary codes —
  `NEGATIVE_OVERRIDE_ROLES = ["owner", "general_manager", "location_manager"]`;
  `manager` was not a vocabulary code; the residual open point is only _which_ of
  those roles should grant the override (next free id `DEC-066`).
- **Finding 2 — idempotency key scoped per organization.** Schema's global
  unique replaced by the composite `stock_movement_org_idempotency_key_key` on
  `(organization_id, idempotency_key)`; migration
  `0018_stock_movement_org_idempotency_key.sql` generated (journal `when`
  `1789902579323`) with its unjournaled `_down.sql`; repository
  `findStockMovementByIdempotencyKey(db, organizationId, key)` filters by org; the
  application replay path passes the org and the redundant foreign-org throw is
  gone. Tests: one org's key does not block another's posting and each org
  replays its own movement (application), plus the composite same-org collision /
  two-org acceptance (persistence integration). This deviates from
  `DATA_DICTIONARY` §6's global "unique where not null" wording — recorded as an
  open point, not ignored.
- **Finding 4 — shared revaluation correction.** New `revaluation.ts`
  (`postRevaluationCorrection`) is used by both commands; it posts the value-only
  movement, saves the balance and writes the audit, adding `reversal_of_id` to
  the audit only when non-null. Callers keep their own `reasonCode` and
  idempotency-key scheme; the post path's audit gains no `reversal_of_id`.
- **Docs:** runbook `0018` entries (order row, bullet, down companion, ledger
  `when`, preflight, invariant check, recovery range `0000–0018`); two new
  slice-8 open points in `docs/BUILD_ROADMAP.md` §5 (per-org key vs
  `DATA_DICTIONARY` §6; provisional override role set) and this file.

Verified (exact): `npm run lint`, `npm run typecheck`, `npm run build` and
`npm run format:check` pass; without `DATABASE_URL` **557 passed / 135 skipped
(692)**; with it **692 passed / 692 (69 files)**; `db:migrate` applies `0018`,
re-runs as a no-op, and the down path was rehearsed (run the down via node+`pg`,
delete the `1789902579323` ledger row, re-migrate), leaving the database migrated
through `0018`. Rollback: discard the working tree (or, once committed, `git
revert`); migration `0018` is additive with the rehearsed down path. Next: the
atomic slice-8 commit (see "Resume here").
