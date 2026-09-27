import type {
  ForecastTrackingReport,
  LlmCompletionInput,
  LlmCompletionResult,
  SuggestionsReport,
} from "@aquarela/application";
import { recordAiAnalysisRun } from "@aquarela/application";
import type { NodeDatabase } from "@aquarela/persistence";
import { describe, expect, it, vi } from "vitest";

import { FakeAiAdvisoryStore } from "../../application/src/ai/test-support";
import {
  AI_ADVISORY_PROMPT_VERSION,
  buildAiAdvisoryPrompt,
  evaluateAiAdvisoryCostGuard,
  parseAiAdvisorySuggestions,
  registerAiAdvisorySchedule,
  runScheduledAiAdvisory,
  type AiAdvisoryEvidence,
  type AiAdvisoryLlm,
  type AiAdvisoryRunDeps,
} from "./ai-advisory";
import type { RuntimeLogger } from "./logging";
import { AI_ADVISORY_QUEUE } from "./queues";
import { FakeBoss } from "./test-support";

const ORG = "org-1";
const ACTOR = null;

/** A fake adapter: records calls and returns (or throws) a scripted result. */
class FakeLlm implements AiAdvisoryLlm {
  readonly calls: LlmCompletionInput[] = [];
  readonly provider = "fake-provider";
  readonly model = "fake-model";
  constructor(
    readonly configured: boolean,
    private readonly result: LlmCompletionResult | Error = {
      text: "[]",
      tokenCounts: { input: 1, output: 1 },
      costEstimate: null,
    },
  ) {}

  complete(input: LlmCompletionInput): Promise<LlmCompletionResult> {
    this.calls.push(input);
    return this.result instanceof Error
      ? Promise.reject(this.result)
      : Promise.resolve(this.result);
  }
}

function completion(text: string): LlmCompletionResult {
  return { text, tokenCounts: { input: 10, output: 20 }, costEstimate: null };
}

function fakeEvidence(): AiAdvisoryEvidence {
  return {
    asOf: "2026-09-01T00:00:00.000Z",
    period: { from: "2026-08-01T00:00:00.000Z", to: "2026-08-31T23:59:59.999Z" },
    forecastTracking: {
      status: "insufficient_history",
      metric: "revenue",
      grain: "day_location",
      scope: { locationId: null, channelId: null, category: null, productVariantId: null },
      snapshotAsOf: null,
      model: null,
      completedPeriods: 1,
      accuracy: null,
      reason: null,
      periods: [],
    } as unknown as ForecastTrackingReport,
    deterministicSuggestions: {
      posture: "advisory_only",
      period: { from: "2026-08-01T00:00:00.000Z", to: "2026-08-31T23:59:59.999Z" },
      suggestions: [],
    } as unknown as SuggestionsReport,
  };
}

function recordingLogger(): RuntimeLogger {
  return { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as unknown as RuntimeLogger;
}

function deps(overrides: Partial<AiAdvisoryRunDeps> = {}): AiAdvisoryRunDeps {
  return {
    organizationId: ORG,
    enabled: true,
    llm: new FakeLlm(true, completion("[]")),
    store: new FakeAiAdvisoryStore(),
    gatherEvidence: async () => fakeEvidence(),
    logger: recordingLogger(),
    ...overrides,
  };
}

describe("buildAiAdvisoryPrompt", () => {
  it("states the advisory posture and carries the evidence in the user message", () => {
    const prompt = buildAiAdvisoryPrompt(fakeEvidence());
    expect(prompt.system).toContain("Advisory only");
    expect(prompt.system).toContain(`"title"`);
    expect(prompt.user).toContain("Deterministic evidence (JSON):");
    expect(prompt.user).toContain("insufficient_history");
    expect(prompt.truncated).toBe(false);
  });

  it("truncates an oversized evidence payload", () => {
    const evidence = fakeEvidence();
    const huge = {
      ...evidence,
      deterministicSuggestions: {
        ...evidence.deterministicSuggestions,
        suggestions: Array.from({ length: 500 }, (_, index) => ({
          ruleId: `R-${index}`,
          title: "x".repeat(200),
          severity: "low",
          advisory: true,
          metric: null,
          subject: { kind: "metric", id: null, label: "x".repeat(200) },
          evidence: [],
          action: "y".repeat(200),
        })),
      } as unknown as SuggestionsReport,
    };
    const prompt = buildAiAdvisoryPrompt({
      ...evidence,
      deterministicSuggestions: huge.deterministicSuggestions,
    });
    expect(prompt.truncated).toBe(true);
    expect(prompt.user).toContain("[truncated]");
  });
});

describe("parseAiAdvisorySuggestions", () => {
  it("parses a bare JSON array", () => {
    const parsed = parseAiAdvisorySuggestions(
      '[{"title":"A","action":"do a","rationale":"because"}]',
    );
    expect(parsed.parsed).toBe(true);
    expect(parsed.suggestions).toEqual([{ title: "A", action: "do a", rationale: "because" }]);
  });

  it("parses a fenced json block and an object wrapper", () => {
    const fenced = parseAiAdvisorySuggestions(
      '```json\n{"suggestions":[{"title":"B","recommendation":"do b"}]}\n```',
    );
    expect(fenced.parsed).toBe(true);
    expect(fenced.suggestions).toEqual([{ title: "B", action: "do b", rationale: null }]);
  });

  it("returns parsed:false (and no suggestions) for non-JSON output", () => {
    expect(parseAiAdvisorySuggestions("I cannot help with that")).toEqual({
      suggestions: [],
      parsed: false,
    });
  });

  it("drops entries without a title and caps the list", () => {
    const many = Array.from({ length: 50 }, (_, index) => ({ title: `t${index}` }));
    const parsed = parseAiAdvisorySuggestions(JSON.stringify([{ action: "no title" }, ...many]));
    expect(parsed.suggestions).toHaveLength(20);
    expect(parsed.suggestions.every((s) => s.title.startsWith("t"))).toBe(true);
  });
});

describe("evaluateAiAdvisoryCostGuard", () => {
  it("allows when no limits are set", () => {
    expect(evaluateAiAdvisoryCostGuard("99.0000", null, null)).toEqual({ allowed: true });
  });

  it("skips once the month-to-date spend reaches the monthly cap", () => {
    expect(evaluateAiAdvisoryCostGuard("5.0000", "5.0000", null)).toEqual({
      allowed: false,
      reason: "monthly-cost-limit",
    });
  });

  it("reserves one worst-case run against the monthly headroom", () => {
    expect(evaluateAiAdvisoryCostGuard("4.6000", "5.0000", "0.5000")).toEqual({
      allowed: false,
      reason: "per-run-cost-limit",
    });
    expect(evaluateAiAdvisoryCostGuard("4.4000", "5.0000", "0.5000")).toEqual({ allowed: true });
  });
});

describe("runScheduledAiAdvisory", () => {
  it("skips without an LLM call when the kill switch is off", async () => {
    const store = new FakeAiAdvisoryStore();
    const llm = new FakeLlm(true);
    const outcome = await runScheduledAiAdvisory(deps({ enabled: false, store, llm }));
    expect(outcome).toEqual({ status: "skipped", reason: "disabled" });
    expect(llm.calls).toHaveLength(0);
    expect(store.runs).toHaveLength(0);
  });

  it("skips without an LLM call when the adapter is unconfigured", async () => {
    const llm = new FakeLlm(false);
    const outcome = await runScheduledAiAdvisory(deps({ llm }));
    expect(outcome).toEqual({ status: "skipped", reason: "unconfigured" });
    expect(llm.calls).toHaveLength(0);
  });

  it("skips without an LLM call when the monthly cost cap is reached", async () => {
    const store = new FakeAiAdvisoryStore();
    await recordAiAnalysisRun(store, {
      organizationId: ORG,
      actorId: ACTOR,
      kind: "forecast",
      provider: "fake-provider",
      model: "fake-model",
      promptVersion: "v0",
      status: "succeeded",
      costEstimate: "5.0000",
    });
    const llm = new FakeLlm(true);
    const outcome = await runScheduledAiAdvisory(deps({ store, llm, monthlyCostLimit: "5.0000" }));
    expect(outcome).toEqual({ status: "skipped", reason: "monthly-cost-limit" });
    expect(llm.calls).toHaveLength(0);
    expect(store.runs).toHaveLength(1);
  });

  it("records a succeeded run and one proposed suggestion per parsed item", async () => {
    const store = new FakeAiAdvisoryStore();
    const llm = new FakeLlm(
      true,
      completion('[{"title":"Raise price","action":"do a","rationale":"because"}]'),
    );
    const outcome = await runScheduledAiAdvisory(deps({ store, llm }));

    expect(outcome).toMatchObject({ status: "succeeded", suggestionCount: 1, parsed: true });
    expect(store.runs).toHaveLength(1);
    expect(store.runs[0]).toMatchObject({
      kind: "forecast",
      status: "succeeded",
      provider: "fake-provider",
      model: "fake-model",
      promptVersion: AI_ADVISORY_PROMPT_VERSION,
      createdBy: ACTOR,
    });
    expect(store.suggestions).toHaveLength(1);
    expect(store.suggestions[0]).toMatchObject({
      organizationId: ORG,
      scopeType: "organization",
      scopeRef: ORG,
      state: "proposed",
    });
    expect(store.suggestions[0]!.suggestion).toMatchObject({ title: "Raise price" });
  });

  it("records a failed run and does not throw on a provider error", async () => {
    const store = new FakeAiAdvisoryStore();
    const llm = new FakeLlm(true, new Error("llm request failed with status 500"));
    const outcome = await runScheduledAiAdvisory(deps({ store, llm }));

    expect(outcome).toMatchObject({
      status: "failed",
      error: "llm request failed with status 500",
    });
    expect(store.runs).toHaveLength(1);
    expect(store.runs[0]!.status).toBe("failed");
    expect(store.runs[0]!.output).toMatchObject({ error: "llm request failed with status 500" });
    expect(store.suggestions).toHaveLength(0);
  });

  it("records a succeeded run with no suggestions when the output is unparseable", async () => {
    const store = new FakeAiAdvisoryStore();
    const llm = new FakeLlm(true, completion("not json at all"));
    const outcome = await runScheduledAiAdvisory(deps({ store, llm }));
    expect(outcome).toMatchObject({ status: "succeeded", suggestionCount: 0, parsed: false });
    expect(store.runs[0]!.status).toBe("succeeded");
  });
});

describe("registerAiAdvisorySchedule", () => {
  /** A `NodeDatabase` stand-in; the disabled handler never touches it. */
  function fakeDb(): NodeDatabase {
    return {} as unknown as NodeDatabase;
  }

  it("registers the cron queue and schedule with missed:once", async () => {
    const boss = new FakeBoss();
    await registerAiAdvisorySchedule(boss, fakeDb(), {
      organizationId: ORG,
      cron: "0 6 * * 1",
      enabled: false,
      llm: new FakeLlm(true),
      logger: recordingLogger(),
    });

    expect(boss.worked[0]!.name).toBe(AI_ADVISORY_QUEUE);
    expect(boss.scheduled[0]).toMatchObject({
      name: AI_ADVISORY_QUEUE,
      cron: "0 6 * * 1",
      options: { missed: "once" },
    });
  });

  it("makes no LLM call through the registered handler when disabled", async () => {
    const boss = new FakeBoss();
    const llm = new FakeLlm(true);
    await registerAiAdvisorySchedule(boss, fakeDb(), {
      organizationId: ORG,
      cron: "0 6 * * 1",
      enabled: false,
      llm,
      logger: recordingLogger(),
    });

    const handler = boss.worked[0]!.handler as (jobs: unknown[]) => Promise<void>;
    await handler([{ id: "job-1", data: { organizationId: ORG } }]);
    expect(llm.calls).toHaveLength(0);
  });
});
