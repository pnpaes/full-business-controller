import {
  computeForecastTracking,
  computeSuggestions,
  createPostgresAiAdvisoryStore,
  createPostgresForecastStore,
  recordAiAnalysisRun,
  recordAiSuggestion,
} from "@aquarela/application";
import type {
  AiAdvisoryWriteStore,
  AiAnalysisRunCostQuery,
  AiAnalysisRunReadStore,
  AnalyticsPeriod,
  ForecastTrackingReport,
  LlmPort,
  SuggestionsReport,
} from "@aquarela/application";
import { MONEY_SCALE, parseDecimal } from "@aquarela/domain";
import type { NodeDatabase } from "@aquarela/persistence";

import type { JobsBoss } from "./boss";
import type { RuntimeLogger } from "./logging";
import { AI_ADVISORY_QUEUE } from "./queues";

/**
 * `ADR-0009` / `DEC-142` (row 17, `FCST-004`): the scheduled AI-advisory run.
 * A cron queue gathers the deterministic evidence (the forecast-vs-actual
 * tracking report and the rule-based `computeSuggestions`), asks a
 * provider-agnostic LLM for advisory commentary, and records one
 * `ai_analysis_run` plus one `proposed` `ai_suggestion` per parsed suggestion.
 *
 * **Advisory only.** Nothing here publishes, prices, orders or changes any
 * business fact; a suggestion stays `proposed` until a human decides it
 * (`DEC-039`). The deterministic baseline stays the system of record.
 *
 * **Guard order** (each skip is logged, none throws the cron):
 * 1. kill switch — `enabled` false ⇒ skip, no LLM call;
 * 2. adapter not configured ⇒ skip, no LLM call;
 * 3. cost caps — the org's month-to-date recorded cost vs the monthly cap, and a
 *    per-run reservation against the monthly headroom ⇒ skip, no LLM call;
 * 4. provider failure ⇒ record a `failed` run, never throw.
 *
 * **No personal data.** The evidence snapshot is projected to business figures
 * only and drops the override actor ids; the provider privacy/DPA review (I16)
 * remains the operational gate before a production key (`ADR-0009`).
 */

/** Identifies the exact prompt template (`ADR-0009`); bump on any prompt change. */
export const AI_ADVISORY_PROMPT_VERSION = "ai-advisory-v1";

/** The `ai_analysis_run.kind` for this slice (`AI_RUN_KIND`). */
export const AI_ADVISORY_RUN_KIND = "forecast";

/** The `ai_suggestion.scope_type` for the organization-wide advisory. */
export const AI_ADVISORY_SCOPE_TYPE = "organization";

/** The tracked metric and grain the evidence is read at. */
export const AI_ADVISORY_METRIC = "revenue";
export const AI_ADVISORY_FORECAST_GRAIN = "day_location" as const;

/** The cron default (weekly, Monday 06:00) — the scheduler's fallback. */
export const DEFAULT_AI_ADVISORY_CRON = "0 6 * * 1";

/** The completion token ceiling asked of the provider. */
export const DEFAULT_AI_ADVISORY_MAX_TOKENS = 1024;

/** Bounds so a runaway evidence/response cannot blow up a run (or its cost). */
export const MAX_AI_ADVISORY_PROMPT_CHARS = 12_000;
export const MAX_AI_ADVISORY_OUTPUT_CHARS = 8_000;
export const MAX_AI_ADVISORY_SUGGESTIONS = 20;
export const MAX_AI_ADVISORY_TITLE_CHARS = 200;
export const MAX_AI_ADVISORY_TEXT_CHARS = 1_000;

/** The adapter contract the schedule needs: the port plus its configuration. */
export interface AiAdvisoryLlm extends LlmPort {
  readonly configured: boolean;
  readonly provider: string;
  readonly model: string | null;
}

/** The gathered deterministic context a run is built from. */
export interface AiAdvisoryEvidence {
  readonly asOf: string;
  readonly period: AnalyticsPeriod;
  readonly forecastTracking: ForecastTrackingReport;
  readonly deterministicSuggestions: SuggestionsReport;
}

export type GatherAiAdvisoryEvidence = (
  organizationId: string,
  now: Date,
) => Promise<AiAdvisoryEvidence>;

/** The `[from, to]` of the previous UTC calendar month as ISO instants. */
export function previousUtcMonthPeriod(now: Date): AnalyticsPeriod {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const endExclusive = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  return {
    from: `${start.toISOString().slice(0, 10)}T00:00:00.000Z`,
    to: new Date(endExclusive - 1).toISOString(),
  };
}

/** The first instant of the UTC calendar month containing `now`. */
export function startOfUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Reads the evidence from the postgres forecast/reporting reads. */
export async function gatherPostgresAiAdvisoryEvidence(
  db: NodeDatabase,
  organizationId: string,
  now: Date,
): Promise<AiAdvisoryEvidence> {
  const store = createPostgresForecastStore(db);
  const forecastTracking = await computeForecastTracking(store, {
    organizationId,
    metric: AI_ADVISORY_METRIC,
    grain: AI_ADVISORY_FORECAST_GRAIN,
    now: now.toISOString(),
  });
  const deterministicSuggestions = await computeSuggestions(store, {
    organizationId,
    period: previousUtcMonthPeriod(now),
    grain: "month",
  });
  return {
    asOf: now.toISOString(),
    period: previousUtcMonthPeriod(now),
    forecastTracking,
    deterministicSuggestions,
  };
}

/** One bounded advisory suggestion parsed from the model's output. */
export interface ParsedAiSuggestion {
  readonly title: string;
  readonly action: string;
  readonly rationale: string | null;
}

export interface ParsedAiAdvisoryOutput {
  readonly suggestions: readonly ParsedAiSuggestion[];
  /** False when no JSON array/object could be read (the run is still recorded). */
  readonly parsed: boolean;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readText(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return trimmed.length > maxChars ? trimmed.slice(0, maxChars) : trimmed;
}

/** The JSON body of a model reply: bare, fenced, or embedded in prose. */
function extractJson(text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(trimmed);
  const body = (fenced?.[1] ?? trimmed).trim();
  if (body.startsWith("{") || body.startsWith("[")) {
    return body;
  }
  const firstBracket = body.indexOf("[");
  const lastBracket = body.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    return body.slice(firstBracket, lastBracket + 1);
  }
  const firstBrace = body.indexOf("{");
  const lastBrace = body.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return body.slice(firstBrace, lastBrace + 1);
  }
  return undefined;
}

/**
 * Parses the model's suggestions defensively: a fenced or prose-wrapped JSON
 * array/object is accepted, every field is trimmed and capped, an entry without
 * a title is dropped, and the list is capped at {@link MAX_AI_ADVISORY_SUGGESTIONS}.
 * A reply that is not parseable returns `parsed: false` with no suggestions —
 * the run is still recorded as provenance.
 */
export function parseAiAdvisorySuggestions(text: string): ParsedAiAdvisoryOutput {
  const raw = extractJson(text);
  if (raw === undefined) {
    return { suggestions: [], parsed: false };
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { suggestions: [], parsed: false };
  }
  const list = Array.isArray(value)
    ? value
    : isObject(value) && Array.isArray(value["suggestions"])
      ? (value["suggestions"] as unknown[])
      : undefined;
  if (list === undefined) {
    return { suggestions: [], parsed: false };
  }

  const suggestions: ParsedAiSuggestion[] = [];
  for (const entry of list) {
    if (!isObject(entry)) {
      continue;
    }
    const title = readText(entry["title"], MAX_AI_ADVISORY_TITLE_CHARS);
    if (title === undefined) {
      continue;
    }
    suggestions.push({
      title,
      action:
        readText(entry["action"], MAX_AI_ADVISORY_TEXT_CHARS) ??
        readText(entry["recommendation"], MAX_AI_ADVISORY_TEXT_CHARS) ??
        readText(entry["detail"], MAX_AI_ADVISORY_TEXT_CHARS) ??
        "",
      rationale:
        readText(entry["rationale"], MAX_AI_ADVISORY_TEXT_CHARS) ??
        readText(entry["reason"], MAX_AI_ADVISORY_TEXT_CHARS) ??
        null,
    });
    if (suggestions.length >= MAX_AI_ADVISORY_SUGGESTIONS) {
      break;
    }
  }
  return { suggestions, parsed: true };
}

export interface AiAdvisoryPrompt {
  readonly system: string;
  readonly user: string;
  readonly truncated: boolean;
}

/** Projects the tracking report to the figures the prompt needs (no actor ids). */
function summarizeTracking(report: ForecastTrackingReport): Record<string, unknown> {
  return {
    status: report.status,
    metric: report.metric,
    grain: report.grain,
    scope: report.scope,
    snapshotAsOf: report.snapshotAsOf,
    model: report.model,
    completedPeriods: report.completedPeriods,
    accuracy:
      report.accuracy === null
        ? null
        : { mape: report.accuracy.mape, periods: report.accuracy.periods },
    reason: report.reason,
    periods: report.periods.map((period) => ({
      period: period.period,
      projected: period.projected,
      actual: period.actual,
      absoluteError: period.absoluteError,
      percentageError: period.percentageError,
    })),
    // `overrides` are deliberately dropped: their actor ids are not needed here
    // and dropping them keeps the snapshot free of any actor reference.
  };
}

/** Projects the rule-based report to its fired suggestions and their evidence. */
function summarizeSuggestions(report: SuggestionsReport): Record<string, unknown> {
  return {
    posture: report.posture,
    period: report.period,
    suggestions: report.suggestions.map((suggestion) => ({
      ruleId: suggestion.ruleId,
      title: suggestion.title,
      severity: suggestion.severity,
      metric: suggestion.metric,
      subject: suggestion.subject,
      evidence: suggestion.evidence,
      action: suggestion.action,
    })),
  };
}

/**
 * Builds the versioned advisory prompt. The system message fixes the advisory
 * posture and the output shape; the user message carries the deterministic
 * evidence as JSON, truncated at {@link MAX_AI_ADVISORY_PROMPT_CHARS} so a large
 * store cannot produce an unbounded request.
 */
export function buildAiAdvisoryPrompt(evidence: AiAdvisoryEvidence): AiAdvisoryPrompt {
  const system = [
    "You are a business analyst for a bakery and cafe operator.",
    "You are given deterministic figures only: a forecast-vs-actual tracking report and a set of",
    "rule-based suggestions already computed by the system. The deterministic baseline is the",
    "system of record; your role is to add short, actionable commentary on top of it.",
    "Rules:",
    "- Advisory only. Never claim an action was taken; a human reviews every suggestion.",
    "- Use only the figures provided. Do not invent numbers, entities or external facts.",
    "- Never include personal data (no employee names or identifiers).",
    "- Return ONLY a JSON array of suggestion objects, each with keys:",
    '  {"title": string, "action": string, "rationale": string}.',
    "- Keep each field short (one or two sentences). Return at most 20 suggestions.",
  ].join("\n");

  const payload = {
    asOf: evidence.asOf,
    period: evidence.period,
    forecastTracking: summarizeTracking(evidence.forecastTracking),
    deterministicSuggestions: summarizeSuggestions(evidence.deterministicSuggestions),
  };
  const full = `Deterministic evidence (JSON):\n${JSON.stringify(payload)}`;
  const truncated = full.length > MAX_AI_ADVISORY_PROMPT_CHARS;
  const user = truncated ? `${full.slice(0, MAX_AI_ADVISORY_PROMPT_CHARS)}\n[truncated]` : full;
  return { system, user, truncated };
}

export interface AiAdvisoryCostGuard {
  readonly allowed: boolean;
  readonly reason?: "monthly-cost-limit" | "per-run-cost-limit";
}

function costLimitPresent(limit: string | null | undefined): limit is string {
  return limit !== null && limit !== undefined && limit.trim().length > 0;
}

/**
 * The pre-call cost guard. The monthly cap skips once the organization's
 * month-to-date recorded cost reaches it. A per-run cap can only *pre-gate* when
 * a monthly cap also exists — then it reserves one worst-case run, so a run is
 * not started that could breach the month by itself. (A per-run cap with no
 * monthly cap is enforced post-call, on the returned cost.)
 */
export function evaluateAiAdvisoryCostGuard(
  spent: string,
  monthlyCostLimit?: string | null,
  perRunCostLimit?: string | null,
): AiAdvisoryCostGuard {
  if (!costLimitPresent(monthlyCostLimit)) {
    return { allowed: true };
  }
  const spentAtScale = parseDecimal(spent, MONEY_SCALE);
  const monthlyLimit = parseDecimal(monthlyCostLimit, MONEY_SCALE);
  if (spentAtScale >= monthlyLimit) {
    return { allowed: false, reason: "monthly-cost-limit" };
  }
  if (
    costLimitPresent(perRunCostLimit) &&
    spentAtScale + parseDecimal(perRunCostLimit, MONEY_SCALE) > monthlyLimit
  ) {
    return { allowed: false, reason: "per-run-cost-limit" };
  }
  return { allowed: true };
}

/** True when a recorded cost exceeds the per-run cap (post-call guard). */
export function costExceedsLimit(
  costEstimate: string | null,
  perRunCostLimit?: string | null,
): boolean {
  if (costEstimate === null || !costLimitPresent(perRunCostLimit)) {
    return false;
  }
  return parseDecimal(costEstimate, MONEY_SCALE) > parseDecimal(perRunCostLimit, MONEY_SCALE);
}

export type AiAdvisorySkipReason =
  "disabled" | "unconfigured" | "monthly-cost-limit" | "per-run-cost-limit";

export type AiAdvisoryOutcome =
  | { readonly status: "skipped"; readonly reason: AiAdvisorySkipReason }
  | {
      readonly status: "succeeded";
      readonly analysisRunId: string;
      readonly suggestionCount: number;
      readonly parsed: boolean;
    }
  | { readonly status: "failed"; readonly analysisRunId: string; readonly error: string };

export interface AiAdvisoryRunDeps {
  readonly organizationId: string;
  readonly enabled: boolean;
  readonly llm: AiAdvisoryLlm;
  readonly store: AiAdvisoryWriteStore & AiAnalysisRunReadStore;
  readonly gatherEvidence: GatherAiAdvisoryEvidence;
  readonly logger?: RuntimeLogger | undefined;
  readonly monthlyCostLimit?: string | null;
  readonly perRunCostLimit?: string | null;
  /** `created_by`; defaults to `null` (a system run). */
  readonly actorId?: string | null;
  readonly maxTokens?: number | undefined;
  readonly now?: (() => Date) | undefined;
}

/** A secret-free error message for a run record or log line. */
function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500);
}

/**
 * Runs one advisory pass. Every skip returns without an LLM call; a provider
 * failure records a `failed` run and returns (it never throws); an unexpected
 * failure while recording propagates so the caller can log it.
 *
 * The deterministic evidence and the (bounded) provider call happen **before**
 * the recording transaction: the run and its suggestions are still written in
 * one transaction together, but no database transaction is held open across the
 * network call.
 */
export async function runScheduledAiAdvisory(deps: AiAdvisoryRunDeps): Promise<AiAdvisoryOutcome> {
  const { organizationId, logger, llm } = deps;
  const now = deps.now?.() ?? new Date();

  if (!deps.enabled) {
    logger?.info({ organizationId }, "ai advisory skipped: kill switch is off");
    return { status: "skipped", reason: "disabled" };
  }
  if (!llm.configured) {
    logger?.warn(
      { organizationId, provider: llm.provider },
      "ai advisory skipped: llm adapter is not configured",
    );
    return { status: "skipped", reason: "unconfigured" };
  }

  const spent = await deps.store.sumAiAnalysisRunCosts({
    organizationId,
    since: startOfUtcMonth(now),
  } satisfies AiAnalysisRunCostQuery);
  const guard = evaluateAiAdvisoryCostGuard(spent, deps.monthlyCostLimit, deps.perRunCostLimit);
  if (!guard.allowed) {
    logger?.warn(
      {
        organizationId,
        reason: guard.reason,
        spent,
        monthlyCostLimit: deps.monthlyCostLimit ?? null,
        perRunCostLimit: deps.perRunCostLimit ?? null,
      },
      "ai advisory skipped: cost limit reached",
    );
    return { status: "skipped", reason: guard.reason ?? "monthly-cost-limit" };
  }

  const provider = llm.provider;
  const model = llm.model ?? "unknown";
  const evidence = await deps.gatherEvidence(organizationId, now);
  const prompt = buildAiAdvisoryPrompt(evidence);
  const inputScope = {
    organizationId,
    metric: AI_ADVISORY_METRIC,
    grain: AI_ADVISORY_FORECAST_GRAIN,
    period: evidence.period,
  };
  const inputSnapshot = {
    promptVersion: AI_ADVISORY_PROMPT_VERSION,
    truncated: prompt.truncated,
    system: prompt.system,
    user: prompt.user,
  };

  let completion: Awaited<ReturnType<AiAdvisoryLlm["complete"]>>;
  try {
    completion = await llm.complete({
      system: prompt.system,
      user: prompt.user,
      maxTokens: deps.maxTokens,
    });
  } catch (error) {
    const message = safeErrorMessage(error);
    const { analysisRunId } = await deps.store.withTransaction((tx) =>
      recordAiAnalysisRun(tx, {
        organizationId,
        actorId: deps.actorId ?? null,
        kind: AI_ADVISORY_RUN_KIND,
        provider,
        model,
        promptVersion: AI_ADVISORY_PROMPT_VERSION,
        status: "failed",
        inputScope,
        inputSnapshot,
        output: { error: message },
      }),
    );
    logger?.warn(
      { organizationId, analysisRunId, error: message },
      "ai advisory provider call failed; recorded a failed run",
    );
    return { status: "failed", analysisRunId, error: message };
  }

  const parsed = parseAiAdvisorySuggestions(completion.text);
  const overPerRunLimit = costExceedsLimit(completion.costEstimate, deps.perRunCostLimit);
  const outputText =
    completion.text.length > MAX_AI_ADVISORY_OUTPUT_CHARS
      ? completion.text.slice(0, MAX_AI_ADVISORY_OUTPUT_CHARS)
      : completion.text;

  const recorded = await deps.store.withTransaction(async (tx) => {
    const { analysisRunId } = await recordAiAnalysisRun(tx, {
      organizationId,
      actorId: deps.actorId ?? null,
      kind: AI_ADVISORY_RUN_KIND,
      provider,
      model,
      promptVersion: AI_ADVISORY_PROMPT_VERSION,
      status: "succeeded",
      costEstimate: completion.costEstimate,
      tokenCounts: {
        input: completion.tokenCounts.input,
        output: completion.tokenCounts.output,
      },
      inputScope,
      inputSnapshot,
      output: {
        text: outputText,
        parsed: parsed.parsed,
        suggestionCount: parsed.suggestions.length,
      },
    });

    let suggestionCount = 0;
    if (!overPerRunLimit) {
      for (const suggestion of parsed.suggestions) {
        await recordAiSuggestion(tx, {
          organizationId,
          actorId: deps.actorId ?? null,
          analysisRunId,
          scopeType: AI_ADVISORY_SCOPE_TYPE,
          scopeRef: organizationId,
          suggestion: {
            title: suggestion.title,
            action: suggestion.action,
            rationale: suggestion.rationale,
            source: "llm",
          },
        });
        suggestionCount += 1;
      }
    }
    return { analysisRunId, suggestionCount };
  });

  if (overPerRunLimit) {
    logger?.warn(
      {
        organizationId,
        analysisRunId: recorded.analysisRunId,
        costEstimate: completion.costEstimate,
        perRunCostLimit: deps.perRunCostLimit ?? null,
      },
      "ai advisory run cost exceeded the per-run limit; the run was recorded but no suggestions were stored",
    );
  }
  if (!parsed.parsed) {
    logger?.warn(
      { organizationId, analysisRunId: recorded.analysisRunId },
      "ai advisory response was not parseable JSON; the run was recorded with no suggestions",
    );
  }

  return {
    status: "succeeded",
    analysisRunId: recorded.analysisRunId,
    suggestionCount: recorded.suggestionCount,
    parsed: parsed.parsed,
  };
}

export interface AiAdvisoryScheduleOptions {
  readonly organizationId: string;
  readonly cron: string;
  readonly logger?: RuntimeLogger;
  readonly enabled: boolean;
  readonly llm: AiAdvisoryLlm;
  readonly monthlyCostLimit?: string | null;
  readonly perRunCostLimit?: string | null;
  readonly actorId?: string | null;
  readonly maxTokens?: number | undefined;
  readonly now?: (() => Date) | undefined;
  /** Test/override seam; defaults to the postgres forecast/reporting reads. */
  readonly gatherEvidence?: GatherAiAdvisoryEvidence | undefined;
}

/** The routing data the cron queue carries (`boss.work` / `boss.schedule`). */
export interface AiAdvisoryScheduleJobData {
  readonly organizationId: string;
}

/**
 * Registers the advisory cron (`missed: "once"`). The kill switch lives in the
 * handler, so the schedule is always registered and one env flip enables it
 * without a redeploy. The handler never throws: an unexpected failure logs an
 * error rather than dead-lettering an advisory job (and never causes a retry
 * that would record a duplicate run).
 */
export async function registerAiAdvisorySchedule(
  boss: JobsBoss,
  db: NodeDatabase,
  options: AiAdvisoryScheduleOptions,
): Promise<void> {
  const { organizationId, cron, logger } = options;
  const gatherEvidence =
    options.gatherEvidence ??
    ((org: string, now: Date) => gatherPostgresAiAdvisoryEvidence(db, org, now));

  await boss.work<AiAdvisoryScheduleJobData>(AI_ADVISORY_QUEUE, async (jobs) => {
    const store = createPostgresAiAdvisoryStore(db);
    for (const job of jobs) {
      // The configured organization is the authority; the pg-boss-stored job
      // data is routing metadata only and must never redirect the run.
      const storedOrganizationId = job.data.organizationId;
      if (storedOrganizationId !== undefined && storedOrganizationId !== organizationId) {
        logger?.warn(
          { organizationId, storedOrganizationId },
          "ai advisory job data organizationId differs from the configured organization; using the configured one",
        );
      }

      try {
        const outcome = await runScheduledAiAdvisory({
          organizationId,
          enabled: options.enabled,
          llm: options.llm,
          store,
          gatherEvidence,
          logger,
          monthlyCostLimit: options.monthlyCostLimit ?? null,
          perRunCostLimit: options.perRunCostLimit ?? null,
          actorId: options.actorId ?? null,
          maxTokens: options.maxTokens,
          now: options.now,
        });
        logger?.info({ organizationId, outcome }, "ai advisory cron run finished");
      } catch (error) {
        logger?.error(
          { organizationId, error: safeErrorMessage(error) },
          "ai advisory cron run failed unexpectedly; not retried",
        );
      }
    }
  });

  await boss.schedule(
    AI_ADVISORY_QUEUE,
    cron,
    // Observability only: the handler uses the configured `options.organizationId`.
    { organizationId },
    { missed: "once" },
  );
}
