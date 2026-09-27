import { sql } from "drizzle-orm";
import { check, index, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { auditColumns, enumCheck, jsonObject, money, orgId, tstz, uuidPk } from "./columns";
import { organization } from "./organization";

/*
 * `ADR-0009` / `DEC-142` (row 17, `FCST-004`): AI-assisted analysis — Phase 4.
 *
 * Advisory only: a `ai_analysis_run` records **what the provider was asked and
 * answered** (provider, model, prompt version, frozen input, output, cost) so a
 * non-deterministic model's output is reproducible after the fact, and each
 * `ai_suggestion` derived from it stays `proposed` until a human approves or
 * rejects it with an audited reason. Nothing here ever auto-applies.
 *
 * Vocabulary note: §4B declares the run `kind`/`status` and the suggestion
 * `state` value lists inline and does **not** name `schemas/domain-enums.yaml`
 * keys (contrast §4C, which explicitly says its enums must be added there). The
 * three vocabularies are therefore declared beside the tables rather than in the
 * yaml-guarded `vocabularies.ts`, so the yaml guard is not silently weakened.
 */
export const AI_RUN_KIND = ["forecast", "menu", "seasonal", "other"] as const;

export const AI_RUN_STATUS = ["pending", "running", "succeeded", "failed", "cancelled"] as const;

export const AI_SUGGESTION_STATE = ["proposed", "approved", "rejected", "superseded"] as const;

/** A jsonb object column typed as an open record, so the application ports stay typed. */
const jsonRecord = (name: string) => jsonObject(name).$type<Record<string, unknown>>();

/*
 * One LLM invocation's provenance. **Append-only** (`0075` trigger, reusing the
 * shared `reject_immutable_change()` from `0002_invariants.sql`): a run is a
 * recorded fact, so a correction is a new run, never an edit or a delete. The
 * input columns default to `{}` so a `pending` run can be claimed before its
 * inputs are frozen; `input_snapshot` must exclude personal data (`ADR-0009`).
 */
export const aiAnalysisRun = pgTable(
  "ai_analysis_run",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    /** A `AI_RUN_KIND` value. */
    kind: text("kind").notNull(),
    /** The adapter target (e.g. the configured provider label); never hard-coded. */
    provider: text("provider").notNull(),
    /** The model id resolved from env (`LLM_MODEL`). */
    model: text("model").notNull(),
    /** Identifies the exact prompt template used (`ADR-0009`). */
    promptVersion: text("prompt_version").notNull(),
    /** What the run covered (org/location/category/product/period). */
    inputScope: jsonRecord("input_scope"),
    /** Frozen inputs for reproducibility; **must exclude personal data**. */
    inputSnapshot: jsonRecord("input_snapshot"),
    /** Raw advisory output from the provider. */
    output: jsonRecord("output"),
    /** A `AI_RUN_STATUS` value. */
    status: text("status").notNull().default("pending"),
    /** prompt/completion/total tokens. */
    tokenCounts: jsonRecord("token_counts"),
    /** Provider cost estimate; never a float, `null` until known. */
    costEstimate: money("cost_estimate"),
    ...auditColumns(),
  },
  (t) => [
    check("ai_analysis_run_kind_check", enumCheck(t.kind, AI_RUN_KIND)),
    check("ai_analysis_run_status_check", enumCheck(t.status, AI_RUN_STATUS)),
    check("ai_analysis_run_provider_check", sql`length(btrim(${t.provider})) > 0`),
    check("ai_analysis_run_model_check", sql`length(btrim(${t.model})) > 0`),
    check("ai_analysis_run_prompt_version_check", sql`length(btrim(${t.promptVersion})) > 0`),
    check("ai_analysis_run_cost_check", sql`${t.costEstimate} is null or ${t.costEstimate} >= 0`),
  ],
);

/*
 * One advisory suggestion derived from a run, with the human review state
 * machine. **Mutable** (only its state/decision columns change), unlike the run
 * it points at.
 *
 * `organization_id` is a deliberate deviation from `DATA_DICTIONARY` §4B, which
 * omits it on suggestions: the repository's tenancy convention (`DEC-061`) puts
 * `organization_id` on every business table so an org-scoped read/write cannot
 * cross tenants, and a suggestion is reachable directly by id at the review
 * route. It is the run's organization; the store writes the run's value.
 *
 * `decided_by` is a plain uuid (the deferred `app_user` FK convention, the
 * `monitoring_reading.recorded_by` precedent). The two checks encode the state
 * machine: a `rejected`/`superseded` row must carry a non-blank reason (there is
 * no silent rejection, the `forecast_override.reason` precedent), and any
 * non-`proposed` row must carry both `decided_by` and `decided_at` (pairing the
 * decision with its actor and instant).
 */
export const aiSuggestion = pgTable(
  "ai_suggestion",
  {
    id: uuidPk(),
    organizationId: orgId().references(() => organization.id),
    /** The run that produced this suggestion. */
    analysisRunId: uuid("analysis_run_id")
      .notNull()
      .references(() => aiAnalysisRun.id),
    /** e.g. location, category, product, period (free text). */
    scopeType: text("scope_type").notNull(),
    /** The referenced entity id for the scope; null when the scope is not an id. */
    scopeRef: uuid("scope_ref"),
    /** One advisory suggestion. */
    suggestion: jsonRecord("suggestion"),
    /** A `AI_SUGGESTION_STATE` value; starts `proposed`. */
    state: text("state").notNull().default("proposed"),
    /** The deciding actor; a plain uuid (the deferred `app_user` FK). */
    decidedBy: uuid("decided_by"),
    /** Set on approval/rejection. */
    decidedAt: tstz("decided_at"),
    /** Required on rejection/supersession (enforced below). */
    reason: text("reason"),
    ...auditColumns(),
  },
  (t) => [
    check("ai_suggestion_state_check", enumCheck(t.state, AI_SUGGESTION_STATE)),
    check("ai_suggestion_scope_type_check", sql`length(btrim(${t.scopeType})) > 0`),
    check(
      "ai_suggestion_reason_check",
      sql`${t.state} not in ('rejected', 'superseded') or (${t.reason} is not null and length(btrim(${t.reason})) > 0)`,
    ),
    check(
      "ai_suggestion_decided_check",
      sql`${t.state} = 'proposed' or (${t.decidedBy} is not null and ${t.decidedAt} is not null)`,
    ),
    index("ai_suggestion_analysis_run_idx").on(t.analysisRunId),
  ],
);
