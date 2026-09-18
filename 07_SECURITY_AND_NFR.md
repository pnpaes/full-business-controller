# 7. Security, Governance and Non-Functional Requirements

## 7.1 Authorization model

Authorization combines role, organization, permitted locations and sensitive-module grants. Enforcement occurs in application services and queries, not only UI navigation.

| Capability | Owner/GM | Location Manager | Kitchen | FOH | Purchasing | Finance | Admin | Analyst |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Company financial view | Full | Limited | None | None | Limited | Full | As required | Read |
| Location operations | Full | Assigned | Assigned | Assigned | Read | Read | As required | Read |
| Supplier/purchases | Approve | Read | Read | None | Edit | Read | As required | Read |
| Recipes/cost cards | Approve | Read | Draft/record | None | Read | Review | As required | Read |
| Prices | Approve | Propose | None | None | None | Review | As required | Read |
| Stock/production/waste | Full | Approve | Record | Limited record | Receive | Read | As required | Read |
| Sales/reconciliation | Full | Assigned | None | Close tasks | None | Full | As required | Read |
| Payroll/labor assumptions | Full | Aggregate only | None | None | None | Full | As required | Aggregate |
| Employee records (name, role, rate, dates) | Full | Edit (location) | None | None | None | Full | As required | None |
| Shift planning and rota | Full | Edit (assigned) | View own | View own | None | Read | As required | None |
| Payroll-input reports | Full | None | None | None | None | Full | As required | Aggregate |
| Users/configuration | Owner grants | None | None | None | None | None | Technical | None |

The final matrix is configurable and approved in Phase 0. Deny by default. Sensitive exports require the same scope as on-screen access.

Ownership and data-area accountability (product owner, technical owner, operational-data owner and the
per-data-area business owners) are modelled as **assignable grants** rather than fixed fields: they carry
effective dates, are audited on grant and revocation, and follow least privilege. Only authorized roles
may grant or revoke them, and access/accountability can be handed over as staffing changes (DEC-014,
FND-007).

Employee data is now in scope (DEC-037/038). Employees may see only their own shifts and hours; location
managers see employees and shifts at their assigned location; hourly rates and payroll-input reports are
restricted to owner/finance (and the accountant's scope). Access follows role plus location scope enforced
server-side in services and queries, never by hiding UI. Sensitive employee and payroll-input exports
require the same scope as on-screen access.

## 7.2 Authentication and sessions

Internal authentication (DEC-013): users, credentials, roles and location scopes live in the same PostgreSQL database as the rest of the system. There is no external identity provider.

- Passwords are hashed with Argon2id (fallback bcrypt), per-user salt, cost tuned to ~250 ms; never MD5/SHA.
- TOTP 2FA (RFC 6238, authenticator app) is required for owner, finance and admin; available/opt-in for other roles.
- Server-side session revocation on logout and on role change/off-boarding (session rows or a revocation list), not just clearing the cookie.
- Secure, `HttpOnly`, `SameSite` cookies; CSRF protection for mutations; short session lifetime, rotated on privilege change; tokens travel in headers, never in URLs.
- Generic login errors ("Invalid email or password"), with a dummy hash comparison when the account does not exist so timing does not reveal existence.
- Rate limiting and progressive lockout on login and 2FA attempts.
- Password reset uses a single-use, short-expiry token hashed at rest and a neutral "if the account exists" response; an admin-assisted reset fallback covers staff without email.
- Secrets and signing keys come from the environment or a managed secret store; never committed or stored in ordinary configuration rows.
- Audit every login/security change and every permission change.
- Session expiration and re-authentication for sensitive operations.
- No shared staff accounts; operational speed is handled through streamlined login/device patterns approved during discovery.

## 7.3 Audit

Audit every login/security change and every create/update/retire/post/approve/reject/reverse/close/export action involving financial, inventory, recipe, price, permission or integration data. Record actor, impersonation/delegation context, time, request ID, entity/version, action, relevant before/after fields and reason. Audit records are append-only and queryable by authorized users.

## 7.4 Privacy

- Minimize employee data: role/cost-center loaded rates are the default.
- Employee records, shifts, assignments, adjustments and payroll-input reports are personal data; apply
  purpose limitation (scheduling, worked-hours capture and payroll input only) and data minimization.
- Retention and deletion follow Personopplysningsloven/GDPR. Working-time records must be retained per
  Norwegian working-environment requirements, with the exact periods confirmed by the accountant; delete
  personal data when no longer required without corrupting financial/audit obligations.
- Audit all changes to employee records, shifts, assignments, adjustments and payroll reports (actor,
  time, before/after, reason).
- Do not place sensitive personal data in logs, task titles or analytics dimensions.
- Define purposes, access, retention and deletion for invoices, personnel-related fields, photos and imports.
- Provide export/correction/deletion handling for personal data where legally required without corrupting financial/audit obligations.
- Complete a data-processing and vendor review before production.

## 7.5 Security controls

- TLS in transit and encryption at rest.
- Secrets in a managed secret store; never committed or stored in ordinary configuration rows.
- Parameterized database access and output encoding.
- File MIME/signature validation, size limits, malware scanning where available and private signed downloads.
- Rate limits and abuse controls on login, imports, exports and expensive calculations.
- Dependency updates and automated vulnerability scanning.
- Least-privilege service/database accounts per environment.
- Production access logged, time-bounded where possible and restricted to authorized operators.

## 7.6 Availability and recovery targets

Initial targets, to confirm in Phase 0:

- operational availability: 99.5% monthly excluding approved maintenance;
- recovery point objective: 1 hour or better for database and critical files;
- recovery time objective: 4 hours during support hours;
- daily backup plus point-in-time recovery where platform supports it;
- restoration tested before launch and at least quarterly;
- documented degraded operation/export procedure for temporary outages.

## 7.7 Performance

For normal café scale and approved filters:

- p95 interactive read response under 500 ms server time;
- p95 transactional command under 1 second excluding file/external processing;
- primary pages usable within 2.5 seconds on a normal mobile connection;
- search/typeahead response under 300 ms for typical catalogs;
- imports and large reports run asynchronously with progress;
- common dashboard read models refresh within 15 minutes after posting, with freshness displayed;
- stock posting and operational availability update within 10 seconds.

Targets are measured in staging load tests and production telemetry. Dataset assumptions must be recorded.

## 7.8 Accessibility and usability

- Target WCAG 2.2 AA for web workflows.
- Full keyboard access for desktop administration.
- Visible focus, semantic labels, sufficient contrast and non-color status cues.
- Touch targets suitable for kitchen/phone use.
- Locale-aware NOK/date/number presentation while storing canonical values.
- Destructive or posting actions require clear consequences and confirmation.
- Common operational entries should be completable quickly with saved defaults.

## 7.9 Data quality

Automated controls cover completeness, freshness, uniqueness, validity, consistency and reconciliation. Exceptions have severity, owner, due date and status. A score may summarize quality but must link to the underlying records.

Minimum monitors:

- active product missing approved recipe/cost/price;
- item missing base unit or supplier conversion;
- stale supplier price/labor/recurring cost;
- duplicate/unmapped/invalid sales;
- source totals not reconciled;
- negative stock or implausible yield;
- overlapping effective versions;
- overdue count, unresolved transfer or expired lot;
- failed/stale integration or background job.

## 7.10 Maintainability

- Strict types, formatter/linter and documented module boundaries.
- Database migrations reviewed and tested against production-like data.
- Public application services and calculations documented with examples.
- No business-critical magic values; thresholds are effective-dated configuration.
- Feature flags for incomplete integrations/major workflows.
- Seeded demo organization with synthetic data for local development.
- Runbooks for deploy, rollback, restore, import recovery and period reopening.

## 7.11 AI assistance and third-party processing

AI-assisted analysis and suggestions (FCST-004, DEC-039, ADR-0009) call an external LLM provider. The
same data-protection and secret-handling rules as the rest of §7 apply.

- **No personal data is ever sent to the provider.** Inputs are aggregated/business data only
  (sales, cost, stock and forecast aggregates); never employee records, names, contact details or
  other personal data (`07.4`, SEC-003).
- **Provider review before enablement.** A data-processing/DPA review of the LLM provider must
  complete and be approved before AI features are enabled in any environment (mirrors `07.4`).
- **Secrets.** Provider API keys and model IDs come only from environment variables or the managed
  secret store; they are never committed to the repository, never stored in ordinary configuration
  rows and never written to logs or error messages.
- **Cost and abuse controls.** Per-run and monthly token/cost limits, rate limiting and a kill switch
  that halts scheduled AI jobs are required. Exceeding a limit fails the run safely; it never blocks
  ordinary operations.
- **Reproducibility.** Every run stores provider, model, prompt version, input snapshot, output and
  cost so an advisory result can be reconstructed and audited later.
- **Advisory only.** Outputs never auto-publish prices, place orders or change menus; they require
  human approval. Approval/rejection is audited with actor, time and reason (FND-005).

## 7.12 External collection and legal

Automated competitor collection (DEC-020) is enabled only for approved, permitted sources. The same
data-protection, secret-handling and least-privilege rules as the rest of §7 apply.

- **Per-source terms/legal approval before enablement.** Each `CompetitorSource` carries a
  `terms_status`; automation is only allowed once a human records approval (`approved_by`/`approved_at`).
  A source whose terms change or are withdrawn is disabled, and `terms_status` reverts.
- **Respect `robots.txt` and rate limits.** The collector honours the source's `robots.txt`, published
  terms of use and any stated rate limits, and backs off on errors rather than retrying aggressively.
- **Identify the client responsibly.** Requests carry an honest user agent/contact so the operator can
  be reached and asked to stop.
- **Store provenance.** Every observation records the exact source URL, capture time and capture method
  (automated/manual) so an extracted fact can be traced and re-checked.
- **No personal data.** Collection never targets or stores personal data (names, contacts, reviewer
  identities, employee data); only business facts about competitor offers and prices.
- **Store extracted facts, not wholesale copies.** Persist the structured offer/price/date facts
  (and only the minimal evidence needed), not bulk copied page content or media.
- **Manual-capture path for restricted sources.** Instagram and other restricted sources use fast
  in-app manual capture (URL/screenshot/note) and are never scraped (`03.8`).
- **Log and review collection runs.** Every run is logged (source, time, outcome, rows captured) and
  reviewed; observations enter a review queue and are advisory until a human marks them reviewed
  (`07.3`).

## 7.13 External publishing and write controls

External writes are permitted but governed **per source and per operation** (DEC-015, ADR-0011).
Read-only ingestion is no longer the universal default; a source may still be read-only until an
operation is explicitly approved. The same data-protection, secret-handling and least-privilege rules
as the rest of §7 apply.

- **Per-source allow-list of operations.** Each `integration_source` records exactly which operations
  are permitted (read; write price; write menu/product; write stock; write accounting). Anything not
  listed is denied by default; there is no implicit write scope.
- **Writes only from an approved internal change.** A publish job must originate from an approved
  internal entity/version (an approved price, recipe/product or stock state). No ad-hoc or bulk writes
  from the UI or an operator session.
- **Credentials per integration, named owner.** Each integration keeps its own credentials in the
  managed secret store, never in ordinary configuration rows, and has a **named credentials owner**
  accountable for rotation and revocation.
- **No broad write credentials.** Grant each integration the narrowest scope its approved operations
  require; never reuse one credential across sources or mix read and write scopes where separate
  credentials are possible.
- **Idempotency keys.** Every publish job carries an idempotency key unique per integration so retries
  and replays cannot double-write; `(integration_source_id, idempotency_key)` is unique.
- **Rate limiting.** Publish jobs respect the source's published rate limits and back off on errors
  rather than retrying aggressively.
- **Confirmation read-back as evidence.** After a write, the job reads the source back and stores the
  observed result (`response_snapshot`, `confirmed_at`) as evidence that the publish actually landed.
- **Rollback and tested recovery.** Every write type has a defined rollback procedure, and recovery is
  rehearsed (the rollback path is tested, not assumed); rollbacks reference the original run
  (`rollback_of_id`) and are themselves audited.
- **Audit each attempt and outcome.** Every publish attempt records actor, time, integration, entity
  and version, operation, request/response snapshots and outcome (`07.3`, FND-005).
- **Alert on failure.** A failed, unconfirmed or rolled-back publish raises an alert to the integration
  owner; failures never leave the internal and external states silently divergent.
- **Read-only by default until approved.** A new source starts with no write operations and stays
  read-only until each operation is explicitly approved and its terms confirmed.
