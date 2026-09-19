# ADR-0003 — Identity provider and role model

- **Status:** Accepted (2026-09-19) — DEC-013 was accepted 2026-09-14; the technical owner
  accepted this ADR on 2026-09-19, when the auth slice began.
- **Date:** 2026-09-13 · **Updated:** 2026-09-19
- **Deciders:** TECH (technical owner, 2026-09-19); BUS (owner acceptance of DEC-013,
  2026-09-14)
- **Related:** DEC-013, DEC-012; `07:3-28`, `13:39`
- **Requirements:** FND-002, FND-005, SEC-001, SEC-003

## Context

Auth is implementation step 2 (`13:73`) and is gated by DEC-013. Requirements: MFA for
owner/finance/admin, no shared staff accounts, immediate revocation, role + location scoping enforced
server-side, and a practical shared-device login for kitchen/FOH work (`07:21-28`).

The owner accepted DEC-013 on 2026-09-14: use an **internal authentication system** rather than a
third-party identity provider. Users, credentials, roles and location scopes live in the same
PostgreSQL database as the rest of the system; there is no external IdP.

## Decision

Use **internal authentication** and keep **authorization in the application database**:

- The application itself is the identity provider. It owns credentials, sessions, TOTP enrollment,
  session revocation and the login/2FA rate limits — all stored in the application PostgreSQL
  database next to roles, location scopes and every other record.
- Authorization stays role + location scope in the app DB; every query/mutation passes through
  server-side authorization, never UI hiding (`07:5`, `13:91`).
- TOTP 2FA (RFC 6238, authenticator app) is required for owner, finance and admin roles, and
  available/opt-in for other roles.
- No shared staff accounts. Operational speed is handled with a trusted-device session and short
  re-auth for sensitive actions.

### Hardening controls the internal system must implement

- **Password storage:** Argon2id (fallback bcrypt), cost tuned to ~250 ms; per-user salt; never
  MD5/SHA.
- **Generic login errors:** return "Invalid email or password" regardless of which part was wrong;
  when the account does not exist, run a dummy hash comparison so response timing does not reveal
  account existence.
- **Server-side session revocation** on logout and on role change/off-boarding (session rows in the
  DB or a revocation list) — not just clearing the cookie.
- **Session cookies** `HttpOnly` + `Secure` + `SameSite`, short lifetime, rotated on privilege
  change; tokens travel in headers, never in URLs.
- **TOTP 2FA** (RFC 6238): enrollment via QR, single-use recovery codes stored hashed, reject
  replayed TOTP windows.
- **Rate limiting and progressive lockout** on login and 2FA attempts.
- **Password reset:** single-use, short-expiry token hashed at rest; neutral "if the account exists"
  response; an admin-assisted reset fallback for staff without email.
- **Secrets/signing keys** come from the environment or a secret manager, never committed.
- **Audit** every login/security change and every permission change.
- **Authorization** remains role + location scope in the app DB, enforced server-side (never UI
  hiding).

## Alternatives considered

- **Managed OIDC (Entra External ID / Auth0 / WorkOS / Auth.js-derived)** — **rejected**. The owner
  wants direct control of users, roles and scopes in one database and no third-party dependency
  (DEC-013).
- **Self-hosted Keycloak** — rejected: same third-party-ops burden and a second source of truth for
  identity, without the owner's one-database control requirement.
- **Custom email/password (as proposed here)** — initially avoided (`07:23`); now accepted, with the
  hardening controls above making it safe to own credentials.

## Consequences

- Role/location changes take effect immediately in the app DB, and session revocation is a
  first-class operation the application must implement (no IdP to lean on).
- The application carries the full credential-security burden: hashing, lockout, 2FA, reset flows
  and secret management are in scope, not delegated.
- The internal auth schema (users, credentials, roles, scopes, sessions, TOTP) is part of the Phase
  1–2 schema, not an external integration.
- Access matrix (`07:7-19`) must be approved in Phase 0 and encoded as data.

## Open items

Accepted 2026-09-19; these remain open implementation-shaping items, tracked in the
owner-input register of `docs/BUILD_ROADMAP.md`:

- Approve the final access matrix and shared-device login pattern.
- Confirm Argon2id parameters against the ~250 ms target on the target hardware.
- Confirm the admin-assisted password-reset procedure for staff without email.
