# 097 — 2026-09-27 — Employee login + self-assignment (`WF-003`, `DEC-146`, migration `0077`)

On branch `main`; **committed** as `d5193d3` (the commit also carries the
competitor `0078` slice — the two migrations share the drizzle `_journal.json`,
so splitting them would leave a journal entry pointing at a missing file on a
partial revert). Working tree clean, pushed. Migration `0077`.

## What was decided and what was built.

The owner answered the three open `WF-003` questions on 2026-09-27: employees
**do** log in; a **manager provisions** the account and an **invite email** lets
the employee set their own password; self-assignment creates a
**`pending_approval`** row for a manager; a **weekly maximum** applies
(configurable, default 2).

### Slice A — accounts and invite (migration `0077`)

- `user_invite` (hashed single-use token, TTL, revoked/expired, one live invite
  per user via a partial unique, cross-org guard) + nullable
  `app_user.invited_at`/`invited_by`. `app_user.password_hash` stays NOT NULL —
  an invited account stores a non-verifying placeholder.
- `inviteEmployeeUser` creates/links the `app_user` (status `invited`) and links
  `employee.user_id` (org guard); `acceptInvite` validates the token, applies
  the shared password policy, sets the password, revokes all sessions for the
  user, records the login and issues a session. The invite email reuses the
  SendGrid `MailPort` (token-free link; the code is in the body, `ADR-0003`).
- Routes: `POST /api/v1/administration/users/invite` (owner/admin) and
  `POST /api/v1/auth/invite/accept` (enumeration-neutral, fail-closed limiter).
  Env `INVITE_TTL_MINUTES`.

### Slice B — self-assignment

- `findEmployeesByUserId` fails closed (0 rows ⇒ not an employee; >1 ⇒
  ambiguous, refuse).
- `selfAssignShift`: only `open|published`; the employee's primary location must
  equal the shift's (null refused, the `assign-shift` rule) and the role must
  match when the shift sets one; the **weekly cap** (`SELF_ASSIGN_WEEKLY_LIMIT`,
  default 2) counts the employee's self-originated live assignments overlapping
  the shift's UTC week; inserts state `pending_approval` with `assigned_by = null`
  and does **not** flip the shift.
- `decideSelfAssignment` (`SHIFT_WRITE_ROLES` unchanged, location-scoped):
  approve sets `approved` + `assigned_by = actor` + the shift `assigned`; reject
  requires a reason (audit-only — no column) and leaves the shift as it was.
- Routes `POST /shifts/[id]/self-assign`, `GET /my-shifts`,
  `GET /shift-assignments/pending`, `POST /shift-assignments/[id]/decide`; a
  **My shifts** view and a roster **pending queue** with approve/reject.

## Security review.

A focused review found **no blockers**; the two mediums (no password policy on
accept; accept did not revoke existing sessions) and three lows (login not
recorded; unescaped token in mail HTML; `DomainError` message leaked by the
admin invite route) were fixed in the same commit: a shared `assertPasswordPolicy`
(min 12) applied in both invite-accept and reset-complete **before** the token is
claimed, `revokeAllSessionsForUser` + `recordLoginSuccess` on accept, an
`escapeHtml` helper in the mail adapter, and generic route errors.

## Verification.

typecheck / lint / format:check clean; `next build` exit 0; **5386/5386 tests
(395 files)** with `DATABASE_URL`; `db:migrate` applied `0077` (+ `0078`) and is
a no-op on re-run; `0077`'s down path was rehearsed on a scratch DB (table +
columns present → down → absent, 102 tables remained) — its original author
died before rehearsing it, so it was rehearsed by the orchestrator.

## Deferred / recorded.

- No invite accept **UI** page (the route is the API; an accept screen is a
  nicety).
- The weekly cap is not race-proof (count + insert share a transaction but only
  the shift row is locked, so two concurrent near-limit self-assigns can both
  pass).
- `SELF_ASSIGN_WEEKLY_LIMIT=0` silently blocks all self-assignment.
- The rejection reason has no column (audit-only).
- Week boundary is a provisional Monday-UTC choice.

## Rollback.

Run `0077`'s down file (drops the guard, `user_invite` and the two columns; no
`app_user`/session/reset row touched), then `git revert d5193d3` (which also
reverts the competitor `0078` slice — revert or re-apply its down separately if
only one is intended).
