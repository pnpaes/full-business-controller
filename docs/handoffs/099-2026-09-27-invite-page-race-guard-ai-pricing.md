# 099 — 2026-09-27 — Follow-ups: invite-accept page, self-assign race guard, AI cost pricing

On branch `main`; **committed** as `38797a1` (invite page), `21f9687` (AI cost
pricing) and `17095cc` (race guard). No migration.

## What was built.

Three recorded gaps closed.

### Invite-accept page (`38797a1`)

- `apps/web/app/invite/accept/page.tsx` + `invite-accept-form.tsx` — the public
  route the invite email links to (`/invite/accept`), token-free per `ADR-0003`:
  the employee types or pastes the code and chooses a password (client-side
  match, a 12-character hint matching the shared policy). A failure shows a
  neutral generic alert (a 400 validation message passes through; 429 gets its
  own copy); success redirects into the app (the accept route sets the session
  cookie). **Browser-verified** (bogus code → neutral "invalid, expired or
  already used" alert).

### Self-assignment race guard (`17095cc`)

- `lockEmployeeForSelfAssignment` (`SELECT id FROM employee WHERE id = $1 FOR
  UPDATE`) is taken before the duplicate check, weekly count and insert, with a
  fixed **shift → employee** acquisition order (no cycle). The weekly cap is now
  atomic per employee across *different* shifts; `decideSelfAssignment` needs no
  lock (both its transitions only free capacity). A two-transaction Postgres test
  fails without the lock and passes with it.

### AI advisory cost pricing (`21f9687`)

- The adapter returned `costEstimate: null`, leaving the caps inert. An
  operator-supplied price table (`LLM_PRICE_INPUT_PER_1M` /
  `LLM_PRICE_OUTPUT_PER_1M`, decimal ≤ 6 dp) is read raw by the scheduler and
  validated at boot; `computeLlmCostEstimate` does exact BigInt decimal
  arithmetic with one HALF_UP to `numeric(19,4)`. Each side is independent:
  both set ⇒ both priced; one set ⇒ that side priced and the other zero (a
  partial estimate); neither ⇒ `null` (fail-safe). The unchanged cap logic now
  sees real costs, proven by a Postgres test.

## Verification.

typecheck / lint / format:check clean; `next build` exit 0; focused suites green
(scheduling + persistence 584; jobs-runtime + domain + scheduler 616); the full
suite at the tip is recorded in the commit/CONTEXT. No migration.

## Deferred / recorded.

- Cost caveats: one currency throughout; a provider using different usage keys or
  omitting the block records 0 tokens / `0.0000` (contributes nothing); rounded
  per run to 4 dp; the caps are spend controls, not hard enforcement (the exact
  cost is known only post-call).
- The race guard serialises all self-assigns by one employee (intended); others
  are unaffected.
- Still open: prompt-change control; system-wide `job` prune (`DEC-140` keeps the
  org-scoped one); INTG-002 deferred by choice (`DEC-141`); the deployment
  rehearsal parked (`DEC-148`); a real `terraform fmt`/`validate` run in CI.

## Rollback.

Each commit is additive and independently revertible: `git revert 38797a1`
(page), `21f9687` (pricing; also unset the two env vars → `cost_estimate` returns
to `null`), `17095cc` (guard; concurrency behaviour only). No schema change and
no posted money or stock fact is touched.
