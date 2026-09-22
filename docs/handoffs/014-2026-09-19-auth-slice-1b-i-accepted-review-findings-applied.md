# 2026-09-19 — Auth slice 1b-i: accepted review findings applied

Applied the accepted external-review findings to the uncommitted 1b-i persistence layer.

- `findUserByIdentifier(db, organizationId, identifier)` — adds
  `eq(appUser.organizationId, organizationId)`, keeps the `lower(btrim(...))`
  match, selects `limit(2)` and throws on a cross-column collision (one user's
  username = another's email) instead of silently picking one.
- Fail loud: `recordLoginFailure` throws on a non-future `lockedUntil`;
  `consumeResetToken` gained `gt(expiresAt, at)`; `setLastUsedCounter` throws on a
  negative counter and on zero matched rows (no enrolment).
- `findActiveSessionByTokenHash` inner-joins `app_user` and requires
  `status = "active"`, so off-boarding/role change is a real revocation barrier
  (a session racing `revokeAllSessionsForUser` still fails validation); JSDoc
  documents the requirement.
- Caller-audit JSDoc (append the `audit_event` row in the same transaction,
  ADR-0003) added to `recordLoginSuccess`, `updatePasswordHash`, `setUserStatus`
  and `revokeAllSessionsForUser`.
- Migration down path: new `0003_user_totp_last_used_counter_down.sql` (not in
  `_journal.json`), referenced from the runbook; 0000–0002 are bootstrap-generated
  with no down companion. `_journal.json` gained its trailing newline.

Verified: `lint`/`typecheck`/`build`/`format:check` pass; **80 passed / 24 skipped**
without `DATABASE_URL` and **104 passed (17 files)** with it; integration tables
left with zero rows (`organization`, `app_user`, `auth_session`, `user_totp`,
`password_reset_token`, `audit_event`). Down rehearsal: applied the down file
(column gone), and — because drizzle-kit tracks applied migrations in the ledger —
re-applied by deleting the 0003 ledger row and re-running `db:migrate` (column and
check restored, ledger back to 4; database left migrated). No blocker findings
remained unapplied.

Rollback: discard this uncommitted change (same as the rest of 1b-i); the down
file is additive and the DB is left migrated.
