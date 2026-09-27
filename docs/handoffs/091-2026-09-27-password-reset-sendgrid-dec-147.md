# 091 — 2026-09-27 — Password-reset delivery via SendGrid (`DEC-147`)

Status: uncommitted in the working tree at the time of writing; branch `main`,
HEAD `f405ed4`. No migration.

## What was decided and what was built.

`DEC-147` (owner, 2026-09-27) turned the deferred self-service password reset
into a real one: the token is delivered by email. The owner chose a
transactional provider and then **corrected it in-session from Resend to
SendGrid** — the code and the decision row both reflect SendGrid.

- `packages/application/src/auth/mail.ts` — the transport-agnostic `MailPort`
  seam (`sendPasswordResetEmail({ to, token, expiresInMinutes })`) and
  `PasswordResetEmailMessage`, so the reset command never imports a vendor.
- `apps/web/lib/mail.ts` — the SendGrid v3 adapter: `POST
  https://api.sendgrid.com/v3/mail/send`, `Authorization: Bearer
  SENDGRID_API_KEY`, body `{ personalizations, from: parseMailFrom(MAIL_FROM),
  subject, content: [text/plain, text/html] }`, success = HTTP **202**, bounded
  10 s timeout, failure `sendgrid email delivery failed with status <N>`.
  Fail-closed: unless `SENDGRID_API_KEY`, `MAIL_FROM` and `APP_BASE_URL` are all
  set, nothing is sent (one warning) and the reset stays admin-issued.
- `apps/web/lib/deps.ts` — `deliverResetToken` hands the plaintext to the port
  and swallows a transport failure (logged without the token), so the request
  stays enumeration-safe.
- `packages/application/src/auth/password-reset.ts` + `types.ts` — the delivery
  port now receives the account email; the confirm/reset path is unchanged.
- `packages/config/src/env.ts` + `.env.example` — `SENDGRID_API_KEY` (secret),
  `MAIL_FROM`, `APP_BASE_URL` (optional, strict schema intact).
- The reset link is **token-free** (`APP_BASE_URL/reset/complete`); the code
  travels in the email body only (`ADR-0003`).

## Verification.

typecheck / lint / format:check clean; focused suites green (`mail.test.ts`,
`deps.test.ts`, the reset route test, `password-reset.test.ts`, `env.test.ts`);
the adapter tests stub `fetch` and assert the token never appears in any log
call. (Full-suite/build results are recorded in the accompanying commit / at the
tip.)

## Deferred / recorded.

- Deployment must set `SENDGRID_API_KEY` (App Platform `SECRET`), `MAIL_FROM`
  and `APP_BASE_URL` on the `web` service (runbook updated).
- No email-template versioning; plain text + html inline.
- Row 17 (AI advisory), row 18 (connectors: public websites + Wolt) and the
  `WF-003` employee login remain the next buildable fronts; the deployment
  rehearsal stays parked (`DEC-148`).

## Rollback.

`git revert` the slice — the reset request then mints/stores the token but
sends nothing (the pre-slice deferred behaviour). No schema change; no posted
money or stock fact is touched.
