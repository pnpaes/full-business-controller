# ADR-0010 — Competitor source automation

- **Status:** Proposed (needs owner + tech-lead acceptance)
- This ADR is a proposal; implementation must not rely on it until status is `Accepted`.
- **Date:** 2026-09-14
- **Deciders:** BUS, TECH
- **Related:** DEC-020, DEC-039, COMP-003, COMP-004; `07.12`; `03.8`
- **Requirements:** COMP-001, COMP-002, COMP-003, COMP-004, SEC-003

## Context

The owner needs continuous competitor monitoring — prices, products/offers and discounts — without
spending staff time on manual checking (DEC-020). Competitor moves inform pricing, menu engineering and
seasonal planning (COMP-001/002), and the reviewed observations are intended to feed the AI-assisted
analysis of ADR-0009 (DEC-039). At the same time, competitor sources differ enormously in what their
terms permit: some public websites and possibly Wolt menus can be monitored within their terms, while
Instagram and other walled/restricted sources cannot be scraped lawfully or reliably. Scraping
everything is not an acceptable default, and the system must never collect personal data.

## Decision

- **Automated collection only for approved, permitted sources.** Each source is a `CompetitorSource`
  with a `source_type`, URL/identifier, `collection_mode` and a `terms_status`. Automation is enabled
  only after a per-source terms/legal review records `terms_status = approved` with approver and time;
  a source whose terms change or are withdrawn is disabled.
- **Restricted sources are manual.** Instagram and any source whose terms forbid automated collection
  use fast in-app manual capture (URL/screenshot/note) with `collection_mode = manual`; they are never
  scraped.
- **Multiple sources per competitor.** A competitor may be monitored through several sources; every
  observation references the specific `CompetitorSource` it came from.
- **Respect robots and rate limits.** Collection honours `robots.txt`, published terms and stated rate
  limits, identifies the client responsibly, and backs off on errors.
- **Provenance is mandatory.** Every `CompetitorObservation` stores source URL, capture time and capture
  method (`automated`/`manual`) plus an offer, category, price, season and a `provenance` JSON blob, so
  any extracted fact can be traced and re-checked.
- **Human review before use.** Observations start `pending` and are advisory only; they are not used
  until a human marks them `reviewed`, and collection runs are logged and reviewed.
- **No personal data, facts not copies.** Only business facts about competitor offers and prices are
  stored; no personal data, and no wholesale copied page content or media.
- **Integrates with AI-assisted analysis.** Reviewed observations feed the advisory, human-approved
  analysis of ADR-0009 (DEC-039); they never auto-publish prices or change menus.

## Alternatives considered

- **Manual-only capture.** Simplest and lowest legal risk, but the owner explicitly wants automation
  and manual-only does not remove the staff-time cost; rejected as the sole approach (kept as the
  fallback for restricted sources).
- **Scrape all sources, including Instagram.** Maximum coverage, but it breaks source terms, is
  unreliable and exposes the business to legal/blocking risk; rejected.
- **Buy a third-party competitor-data vendor.** Outsources collection and legal risk, but adds cost, a
  data-processing/vendor review and lock-in, and the offered coverage may not match the local market;
  rejected for now, and reversible because sources sit behind the `CompetitorSource` model.

## Consequences

- Every source requires a **terms/legal review and recorded approval** before automation is enabled.
- Automated collectors need **maintenance** as page structures and terms change; a source can be
  blocked or withdrawn at any time, so the manual path must always remain available.
- A **review queue** is required so observations are deliberately marked `reviewed` or `rejected`
  before they influence planning or AI inputs.
- New tables `competitor_source` and `competitor_observation` (DATA_DICTIONARY §4C,
  `schemas/phase1_2_draft.sql`); new enums `source_type`, `collection_mode`, `terms_status`,
  `review_state` (DATA_DICTIONARY §4C).
- Reviewed observations become an input to ADR-0009 AI analysis; the same no-personal-data and
  human-approval rules apply end to end.

## Open items

- Decide which sources are approved for automation (candidate websites, Wolt menus).
- Confirm Wolt's terms and confirm that automated Wolt menu collection is permitted.
- Assign who reviews observations and who owns per-source terms/legal approval.
- Define the collection cadence, rate limits and retention for raw capture evidence.
