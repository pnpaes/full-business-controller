# 2026-09-19 — Auth slice 1b-iii: password reset + access control (committed `2ce8847`)

Completed the server-side auth application surface on the committed 1b-ii flow. Persistence:
new `packages/persistence/src/repositories/access.ts` (`listUserRoles`, `listUserLocationScopes`,
`listAssignableRoles`, `assignRole` — idempotent upsert against the `NULLS NOT DISTINCT`
`user_role_key`, `removeRole`, `replaceLocationScopes`) exported from the package index, with
rolled-back PostgreSQL integration tests (round-trip, duplicate grant, remove no-op, exact
scope replacement). Application: `AuthStore` gained reset-token create/find/consume,
role/scope list/assign/remove/replace and `setUserStatus`, and `createPostgresAuthStore`
implements them; `AuthDeps` gained `passwordResetTtlMinutes` and an optional
`passwordHashOptions` cost seam. New `password-reset.ts` (`beginPasswordReset` is always
neutral and stores only the token hash; the plaintext token is returned only for out-of-band
delivery and never logged/audited; `completePasswordReset` claims the token atomically,
hashes the new password, revokes every session and audits in one transaction) and `access.ts`
(`loadUserAccess`, the pure `isAuthorizedFor` with no implicit admin bypass, `assignRole`
which revokes sessions, `replaceLocationScopes`, `disableUser` which disables and revokes in
one transaction). `AUTH_AUDIT_ACTIONS` gained `auth.password_reset.{requested,completed,failed}`,
`auth.access.{role_changed,scopes_changed}` and `auth.user.disabled`; `audit()` now passes
`before`/`after` jsonb. The in-memory `FakeAuthStore` moved to `test-support.ts` and gained
the new methods; new unit tests cover the neutral reset, single-use/expiry, session
revocation after reset, role/scope allow/deny, role-change revocation and disable+reject.
No migration and no new dependency.

Verified: `lint`, `typecheck`, `build` pass and all changed/new files pass `format:check`;
slice-scoped tests **41 passed / 32 skipped** without `DATABASE_URL` and **73 passed** with
it; integration tables left with zero rows. Full-repo `test` currently also fails 3
`packages/ui/src/{contrast,tokens}.test.ts` assertions from the concurrent workstream, and
`format:check` flags those concurrent `packages/ui` files — neither is part of this slice.
Roadmap statuses are left for the commit step.

Rollback: discard this uncommitted change (or `git revert` once committed); the modules are
additive and imported by no runtime yet; the schema already existed.
