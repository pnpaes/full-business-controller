# 2026-09-19 — Auth slice 1b-i: persistence access layer

Built the server-side persistence/auth access layer on the existing schema (uncommitted).

- **Domain crypto:** `packages/domain/src/auth/secret-box.ts` — `parseSecretKey` (32-byte
  base64), `sealSecret`/`openSecret` (AES-256-GCM via `node:crypto`, self-describing
  `v1.<iv>.<ciphertext>.<tag>` base64url, random 12-byte IV), exported from the auth barrel;
  `DomainError` on wrong length/key, tamper, malformed input or unknown version, and never
  partial plaintext.
- **Schema + migration:** added nullable `user_totp.last_used_counter` with
  `user_totp_last_used_counter_check` (`null or >= 0`); generated
  `0003_user_totp_last_used_counter.sql` (+ meta snapshot + journal), header records the down
  path `ALTER TABLE "user_totp" DROP COLUMN "last_used_counter";`. The migration table and
  invariant checks in `docs/runbooks/persistence-migrations.md` were updated.
- **Persistence client + repositories:** `client.ts` (`createDb(connectionString)` →
  `{ db, pool, close }`, `Database`/`NodeDatabase`/`DatabaseTransaction` types; the caller
  supplies the URL, no env reads); `repositories/{users,sessions,totp,password-reset,audit}.ts`
  all taking `db` first, using parameterised `eq`/`and`/`sql` (no identifier interpolation,
  DEC-049). `sessions` stores only the token hash; `consumeResetToken` is conditional on
  `used_at is null` (single-use); `setLastUsedCounter` is `greatest(current, next)`
  (monotonic); `audit` inserts only (the DB trigger enforces append-only). All exported from
  `packages/persistence/src/index.ts`; added `@types/pg` devDependency.

Verified: `npm run lint && npm run typecheck && npm run test && npm run build &&
npm run format:check` pass; **80 passed / 17 skipped** without `DATABASE_URL` and **97 passed
(17 files)** with it (integration files `users` 4, `sessions` 3, `totp` 3, `password-reset` 3,
`audit` 4 — each `describe.skipIf(!process.env.DATABASE_URL)` and run in rolled-back
transactions so the append-only audit rows are not left behind). Against local PostgreSQL 16:
reset the empty DB, the first `DATABASE_URL=... npm run db:migrate` applied 0000–0003 (ledger
count 4), a second run was a no-op, `\d user_totp` shows `last_used_counter integer` plus the
check, a negative value is rejected, and a re-run of `npm run db:generate` reports "No schema
changes" (schema/snapshot in sync).

Rollback: discard this uncommitted change. The code is additive (no runtime imports it yet);
migration 0003 is additive with the documented down path above, and while the DB is empty the
runbook's `DROP SCHEMA public/drizzle CASCADE` + `db:migrate` replay remains valid.

Next: **Auth slice 1b-ii** (application commands/queries on this layer).
