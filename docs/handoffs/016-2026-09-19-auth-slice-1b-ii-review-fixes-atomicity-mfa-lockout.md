# 2026-09-19 — Auth slice 1b-ii: review fixes (atomicity, MFA lockout)

Applied both review findings before 1b-iii. Concurrency: `verifyMfa` now advances the TOTP
replay counter and consumes recovery codes with atomic compare-and-sets in
`packages/persistence/src/repositories/totp.ts` (`advanceLastUsedCounter`,
`consumeRecoveryCodeHash`), replacing the read-then-write `setLastUsedCounter`; a lost
compare-and-set is treated as a replay, so two racing requests cannot both get a session.
Atomicity: `AuthStore` gains `withTransaction`, the Postgres adapter binds a store to
`db.transaction`, and `authenticate`/`verifyMfa`/`logout`/`logoutAll` run inside it so the
audit row and the state change commit together. Security gap: MFA attempts now share the
progressive lockout (`computeLockout`/`isLocked`/`recordLoginFailure`) and a successful
password step no longer resets the counter when MFA is still required, so second-factor
brute force is bounded; `openSecret` failure fails closed with a `secret_unseal_failed`
audit; `AuthUser.status` and `app_user.status` are typed as the `UserStatus` union
(type-only, `db:generate` reports no schema change). Declined: the drizzle-orm advisory is
already governed by DEC-049.

Verified: **120 tests** (18 files) with `DATABASE_URL` and **94 passed / 26 skipped**
without it; `lint`, `typecheck`, `build` and `format:check` pass; the new tests cover MFA
lockout after repeated failures, a valid code rejected once locked, a tampered sealed
secret, and single-use recovery-code consumption.

Rollback: discard this uncommitted change (or `git revert`); the compare-and-set primitives
are additive and the previous `setLastUsedCounter` behaviour is simply replaced.
