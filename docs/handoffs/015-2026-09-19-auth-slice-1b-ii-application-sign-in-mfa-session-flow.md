# 2026-09-19 — Auth slice 1b-ii: application sign-in / MFA / session flow

Built `packages/application/src/auth/` on the 1b-i repositories: an `AuthStore` port with a
`createPostgresAuthStore` adapter (transaction-friendly, `db.transaction((tx) => ...)`),
`authenticate` (always runs one verification including the dummy path for an unknown account,
returns the single `AUTH_ERROR_GENERIC`, applies `computeLockout`/`isLocked`, resets the
counter and rehashes on success, requires MFA without issuing a session when `totpEnabled`),
`verifyMfa` (opens the sealed secret, rejects a replayed counter, consumes a recovery code
once), `verifySession`/`logout`/`logoutAll`, and an `AUTH_AUDIT_ACTIONS` vocabulary; every
outcome writes an audit row. `packages/config` gained `SESSION_TTL_MINUTES` (480),
`PASSWORD_RESET_TTL_MINUTES` (30) and an optional `TOTP_SECRET_ENCRYPTION_KEY`, and the
persistence layer gained `findUserById`.

Verified: **117 tests** (18 files) with `DATABASE_URL` against local PostgreSQL 16 and
**92 passed / 25 skipped** without it; `lint`, `typecheck`, `build` and `format:check` pass.
Password reset, role/location authorization and the admin operations are deferred to slice
1b-iii, so this slice is scoped to the sign-in path only.

Rollback: discard this uncommitted change (or `git revert` once committed); the module is
additive and imported by no runtime yet.
