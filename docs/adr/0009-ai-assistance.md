# ADR-0009 — AI-assisted analysis and suggestions

- **Status:** Proposed (needs owner + tech-lead acceptance)
- This ADR is a proposal; implementation must not rely on it until status is `Accepted`.
- **Date:** 2026-09-14
- **Deciders:** TECH, BUS
- **Related:** DEC-039, DEC-011, FCST-004
- **Requirements:** FCST-004, SEC-003, OPS-001, OPS-002

## Context

The owner wants scheduled AI-assisted analysis — forecast commentary, menu engineering and
seasonal/upcoming-period suggestions (DEC-039) — delivered on top of the deterministic baselines in
`07` and the reporting aggregates in ADR-0007. The model provider is **OpenCode Go/Zen**, called over
its API with an **API key and model IDs supplied from environment variables**, preferring
**free/low-cost models with fallback**. The source history for forecasts is still thin
(location/category grain, DEC-011), so AI must add commentary to transparent baselines, not replace
them.

## Decision

- **Provider abstraction.** LLM access sits behind a provider interface; the configured provider,
  model ID and fallback order come from environment/secret configuration, so models are swappable
  without code changes and no vendor is hard-coded.
- **Secrets from the environment.** API keys and model IDs come only from environment variables or
  the managed secret store; never committed, never logged (`07.45`, `07.11`).
- **Scheduled jobs.** Analysis runs as background jobs (ADR-0004), not inside request transactions.
- **Advisory only, human-approved.** Outputs never auto-publish prices, place orders or change menus.
  Each suggestion is `proposed` until a human approves or rejects it with an audited reason.
- **Reproducible run records.** Every run stores provider, model, prompt version, input snapshot,
  output and cost (`ai_analysis_run`); decisions are stored per suggestion (`ai_suggestion`).
- **No personal data.** Only aggregated/business data is sent; employee records and other personal
  data are never included in prompts or snapshots (`07.4`, `07.11`, SEC-003).
- **Cost and abuse controls.** Per-run and monthly token/cost limits, rate limiting and a kill switch
  are required before enablement.
- **Deterministic baselines remain primary.** AI annotates; the transparent baseline forecast
  (FCST-001) stays the system of record, with FCST-003 promoting grain only when history is clean.

## Alternatives considered

- **No AI / deterministic-only** — simplest and fully reproducible, but the owner explicitly wants
  AI-assisted suggestions in Phase 4; rejected as the sole approach.
- **A different provider** (e.g. a hosted frontier model or a self-hosted model) — rejected for now:
  OpenCode Go/Zen with free/low-cost model fallback best matches the owner's cost preference; the
  provider abstraction keeps this reversible.
- **Client-side/provider SDK calls from the browser** — rejected: would expose API keys and personal
  data on the client, and gives no reproducibility or cost control.

## Consequences

- A **third-party data-processing/DPA review** of the provider must complete before enablement.
- LLM output is **non-deterministic**, so prompts are versioned and runs store the exact
  provider/model/input used for reproducibility.
- **Cost must be controlled** via per-run and monthly limits plus a kill switch; runs fail safely.
- A **review queue** is needed so proposed suggestions are approved or rejected deliberately and
  audited; unapproved suggestions never affect operations.
- New tables `ai_analysis_run` and `ai_suggestion` (DATA_DICTIONARY §4B, `schemas/phase1_2_draft.sql`).

## Open items

- Confirm the provider's data-processing terms/DPA and data residency before enablement.
- Choose the specific models, fallback order and the per-run/monthly cost limits.
- Assign ownership for prompt versioning and change control.
