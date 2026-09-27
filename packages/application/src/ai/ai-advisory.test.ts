import { DomainError, NotFoundError } from "@aquarela/domain";
import { describe, expect, it } from "vitest";

import { decideAiSuggestion } from "./decide-ai-suggestion";
import { findAiAnalysisRun } from "./find-ai-analysis-run";
import { listAiSuggestions } from "./list-ai-suggestions";
import { recordAiAnalysisRun } from "./record-ai-analysis-run";
import { recordAiSuggestion } from "./record-ai-suggestion";
import { FakeAiAdvisoryStore } from "./test-support";

const ORG = "org-1";
const OTHER_ORG = "org-2";
const ACTOR = "user-1";

async function seedRun(store: FakeAiAdvisoryStore, organizationId = ORG): Promise<string> {
  const { analysisRunId } = await recordAiAnalysisRun(store, {
    organizationId,
    actorId: ACTOR,
    kind: "forecast",
    provider: "opencode",
    model: "test-model",
    promptVersion: "v1",
  });
  return analysisRunId;
}

async function seedSuggestion(
  store: FakeAiAdvisoryStore,
  organizationId = ORG,
): Promise<{ runId: string; suggestionId: string }> {
  const runId = await seedRun(store, organizationId);
  const { suggestionId } = await recordAiSuggestion(store, {
    organizationId,
    actorId: ACTOR,
    analysisRunId: runId,
    scopeType: "location",
    scopeRef: "11111111-1111-4111-8111-111111111111",
    suggestion: { note: "raise the croissant price" },
  });
  return { runId, suggestionId };
}

describe("recordAiAnalysisRun", () => {
  it("records a pending run with the provider provenance", async () => {
    const store = new FakeAiAdvisoryStore();
    const { analysisRunId } = await recordAiAnalysisRun(store, {
      organizationId: ORG,
      actorId: ACTOR,
      kind: "menu",
      provider: "opencode",
      model: "model-a",
      promptVersion: "v2",
      inputScope: { location: "loc-1" },
      costEstimate: "0.0123",
    });

    const run = store.runs[0]!;
    expect(run.id).toBe(analysisRunId);
    expect(run).toMatchObject({
      organizationId: ORG,
      kind: "menu",
      status: "pending",
      promptVersion: "v2",
      costEstimate: "0.0123",
      createdBy: ACTOR,
    });
  });

  it("rejects an unknown kind and a blank provider", async () => {
    const store = new FakeAiAdvisoryStore();
    await expect(
      recordAiAnalysisRun(store, {
        organizationId: ORG,
        actorId: ACTOR,
        kind: "astrology",
        provider: "p",
        model: "m",
        promptVersion: "v1",
      }),
    ).rejects.toThrow(DomainError);
    await expect(
      recordAiAnalysisRun(store, {
        organizationId: ORG,
        actorId: ACTOR,
        kind: "other",
        provider: "   ",
        model: "m",
        promptVersion: "v1",
      }),
    ).rejects.toThrow(DomainError);
  });

  it("rejects a negative or over-precise cost estimate", async () => {
    const store = new FakeAiAdvisoryStore();
    const base = {
      organizationId: ORG,
      actorId: ACTOR,
      kind: "other",
      provider: "p",
      model: "m",
      promptVersion: "v1",
    } as const;
    await expect(recordAiAnalysisRun(store, { ...base, costEstimate: "-1" })).rejects.toThrow(
      DomainError,
    );
    await expect(recordAiAnalysisRun(store, { ...base, costEstimate: "1.23456" })).rejects.toThrow(
      DomainError,
    );
  });
});

describe("recordAiSuggestion", () => {
  it("records a proposed suggestion for a run in the same organization", async () => {
    const store = new FakeAiAdvisoryStore();
    const { suggestionId } = await seedSuggestion(store);

    const row = store.suggestions.find((s) => s.id === suggestionId)!;
    expect(row).toMatchObject({ organizationId: ORG, state: "proposed", scopeType: "location" });
    expect(row.decidedBy).toBeNull();
  });

  it("refuses an unknown run and another organization's run", async () => {
    const store = new FakeAiAdvisoryStore();
    const foreignRunId = await seedRun(store, OTHER_ORG);

    await expect(
      recordAiSuggestion(store, {
        organizationId: ORG,
        actorId: ACTOR,
        analysisRunId: "does-not-exist",
        scopeType: "category",
      }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      recordAiSuggestion(store, {
        organizationId: ORG,
        actorId: ACTOR,
        analysisRunId: foreignRunId,
        scopeType: "category",
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("refuses a blank scope type", async () => {
    const store = new FakeAiAdvisoryStore();
    const runId = await seedRun(store);
    await expect(
      recordAiSuggestion(store, {
        organizationId: ORG,
        actorId: ACTOR,
        analysisRunId: runId,
        scopeType: "  ",
      }),
    ).rejects.toThrow(DomainError);
  });
});

describe("decideAiSuggestion", () => {
  it("approves a proposed suggestion without a reason and audits it", async () => {
    const store = new FakeAiAdvisoryStore();
    const { suggestionId } = await seedSuggestion(store);

    const decided = await decideAiSuggestion(store, {
      organizationId: ORG,
      actorId: ACTOR,
      suggestionId,
      decision: "approved",
    });

    expect(decided.state).toBe("approved");
    expect(decided.decidedBy).toBe(ACTOR);
    expect(decided.decidedAt).toBeInstanceOf(Date);
    expect(store.audits).toHaveLength(1);
    expect(store.audits[0]!.action).toBe("ai.suggestion.approved");
    expect(store.audits[0]!.entityId).toBe(suggestionId);
  });

  it("requires a reason to reject and records it", async () => {
    const store = new FakeAiAdvisoryStore();
    const { suggestionId } = await seedSuggestion(store);

    await expect(
      decideAiSuggestion(store, {
        organizationId: ORG,
        actorId: ACTOR,
        suggestionId,
        decision: "rejected",
      }),
    ).rejects.toThrow(DomainError);
    await expect(
      decideAiSuggestion(store, {
        organizationId: ORG,
        actorId: ACTOR,
        suggestionId,
        decision: "rejected",
        reason: "   ",
      }),
    ).rejects.toThrow(DomainError);

    const decided = await decideAiSuggestion(store, {
      organizationId: ORG,
      actorId: ACTOR,
      suggestionId,
      decision: "rejected",
      reason: "  price change not justified  ",
    });
    expect(decided.state).toBe("rejected");
    expect(decided.reason).toBe("price change not justified");
    expect(store.audits[0]!.action).toBe("ai.suggestion.rejected");
    expect(store.audits[0]!.reason).toBe("price change not justified");
  });

  it("only decides a proposed suggestion", async () => {
    const store = new FakeAiAdvisoryStore();
    const { suggestionId } = await seedSuggestion(store);
    await decideAiSuggestion(store, {
      organizationId: ORG,
      actorId: ACTOR,
      suggestionId,
      decision: "approved",
    });

    await expect(
      decideAiSuggestion(store, {
        organizationId: ORG,
        actorId: ACTOR,
        suggestionId,
        decision: "rejected",
        reason: "changed my mind",
      }),
    ).rejects.toThrow(DomainError);
  });

  it("reports an unknown id and another organization's suggestion as not found", async () => {
    const store = new FakeAiAdvisoryStore();
    const { suggestionId } = await seedSuggestion(store, OTHER_ORG);

    await expect(
      decideAiSuggestion(store, {
        organizationId: ORG,
        actorId: ACTOR,
        suggestionId: "missing",
        decision: "approved",
      }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      decideAiSuggestion(store, {
        organizationId: ORG,
        actorId: ACTOR,
        suggestionId,
        decision: "approved",
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("rejects an unknown decision value", async () => {
    const store = new FakeAiAdvisoryStore();
    const { suggestionId } = await seedSuggestion(store);
    await expect(
      decideAiSuggestion(store, {
        organizationId: ORG,
        actorId: ACTOR,
        suggestionId,
        decision: "maybe" as never,
      }),
    ).rejects.toThrow(DomainError);
  });
});

describe("listAiSuggestions", () => {
  it("is organization-scoped and filters by state", async () => {
    const store = new FakeAiAdvisoryStore();
    const own = await seedSuggestion(store, ORG);
    await seedSuggestion(store, OTHER_ORG);
    await decideAiSuggestion(store, {
      organizationId: ORG,
      actorId: ACTOR,
      suggestionId: own.suggestionId,
      decision: "approved",
    });

    const all = await listAiSuggestions(store, { organizationId: ORG });
    expect(all).toHaveLength(1);

    const approved = await listAiSuggestions(store, { organizationId: ORG, state: "approved" });
    expect(approved.map((row) => row.id)).toEqual([own.suggestionId]);

    const proposed = await listAiSuggestions(store, { organizationId: ORG, state: "proposed" });
    expect(proposed).toHaveLength(0);
  });

  it("rejects an unknown state and an out-of-range limit", async () => {
    const store = new FakeAiAdvisoryStore();
    await expect(
      listAiSuggestions(store, { organizationId: ORG, state: "archived" }),
    ).rejects.toThrow(DomainError);
    await expect(listAiSuggestions(store, { organizationId: ORG, limit: 0 })).rejects.toThrow(
      DomainError,
    );
    await expect(listAiSuggestions(store, { organizationId: ORG, offset: -1 })).rejects.toThrow(
      DomainError,
    );
  });
});

describe("findAiAnalysisRun", () => {
  it("returns an organization-owned run and hides unknown ids", async () => {
    const store = new FakeAiAdvisoryStore();
    const runId = await seedRun(store);

    const run = await findAiAnalysisRun(store, { organizationId: ORG, analysisRunId: runId });
    expect(run.id).toBe(runId);

    await expect(
      findAiAnalysisRun(store, { organizationId: OTHER_ORG, analysisRunId: runId }),
    ).rejects.toThrow(NotFoundError);
  });
});
