import { createPostgresAiAdvisoryStore, recordAiAnalysisRun } from "@aquarela/application";
import { MONEY_SCALE, parseDecimal } from "@aquarela/domain";
import {
  createDb,
  organization,
  type DatabaseTransaction,
  type DbClient,
  type NodeDatabase,
} from "@aquarela/persistence";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { evaluateAiAdvisoryCostGuard } from "./ai-advisory";
import { computeLlmCostEstimate, createOpenAiCompatibleLlmAdapter } from "./llm-adapter";

/**
 * The live-cost evidence: with a configured price table the adapter prices a
 * completion, the run records that decimal cost, `sumAiAnalysisRunCosts`
 * reflects it, and the (unchanged) monthly cap guard then trips. Rolled back, so
 * nothing is left behind — the append-only `ai_analysis_run` needs no cleanup.
 */
const databaseUrl = process.env.DATABASE_URL;
const suffix = randomUUID().replace(/-/g, "").slice(0, 12);

class RollbackSignal extends Error {}

async function inRollback(
  db: NodeDatabase,
  fn: (tx: DatabaseTransaction) => Promise<void>,
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await fn(tx);
      throw new RollbackSignal();
    });
  } catch (error) {
    if (!(error instanceof RollbackSignal)) {
      throw error;
    }
  }
}

describe.skipIf(!databaseUrl)("advisory cost estimate reaches the monthly cap", () => {
  let client: DbClient;

  beforeAll(() => {
    client = createDb(databaseUrl!);
  });

  afterAll(async () => {
    await client.close();
  });

  it("records a priced run so the month-to-date sum is non-zero and the cap trips", async () => {
    await inRollback(client.db, async (tx) => {
      const orgRows = await tx
        .insert(organization)
        .values({ legalName: `ai-cost-${suffix}` })
        .returning();
      const organizationId = orgRows[0]!.id;

      const fetchImpl = (async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: "[]" } }],
            usage: { prompt_tokens: 1000, completion_tokens: 500 },
          }),
        }) as unknown as Response) as unknown as typeof fetch;
      const adapter = createOpenAiCompatibleLlmAdapter({
        apiUrl: "https://api.example.ai/v1/chat/completions",
        apiKey: "test-key",
        model: "test-model",
        priceInputPer1M: "2.000000",
        priceOutputPer1M: "4.000000",
        fetchImpl,
      });

      const completion = await adapter.complete({ system: "s", user: "u" });
      expect(completion.costEstimate).toBe("0.0040");
      expect(completion.costEstimate).toBe(
        computeLlmCostEstimate(completion.tokenCounts, {
          inputPer1M: "2.000000",
          outputPer1M: "4.000000",
        }),
      );

      const store = createPostgresAiAdvisoryStore(tx);
      await recordAiAnalysisRun(store, {
        organizationId,
        actorId: null,
        kind: "forecast",
        provider: "api.example.ai",
        model: "test-model",
        promptVersion: "ai-advisory-v1",
        status: "succeeded",
        costEstimate: completion.costEstimate,
        tokenCounts: {
          input: completion.tokenCounts.input,
          output: completion.tokenCounts.output,
        },
      });

      const spent = await store.sumAiAnalysisRunCosts({ organizationId, since: new Date(0) });
      expect(parseDecimal(spent, MONEY_SCALE)).toBeGreaterThan(0n);

      // The guard logic is unchanged; it now sees a real cost.
      const atCap = evaluateAiAdvisoryCostGuard(spent, spent);
      expect(atCap.allowed).toBe(false);
      expect(atCap.reason).toBe("monthly-cost-limit");
      expect(evaluateAiAdvisoryCostGuard(spent, "5.0000").allowed).toBe(true);
    });
  });
});
