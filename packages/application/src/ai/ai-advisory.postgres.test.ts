import { NotFoundError } from "@aquarela/domain";
import {
  aiAnalysisRun,
  aiSuggestion,
  createDb,
  listAuditEventsForEntity,
  organization,
  type DatabaseTransaction,
  type DbClient,
  type NodeDatabase,
} from "@aquarela/persistence";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { decideAiSuggestion } from "./decide-ai-suggestion";
import { listAiSuggestions } from "./list-ai-suggestions";
import { createPostgresAiAdvisoryStore } from "./postgres-store";
import { recordAiAnalysisRun } from "./record-ai-analysis-run";
import { recordAiSuggestion } from "./record-ai-suggestion";

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

/** The full pg error chain, so a wrapped driver message is still visible. */
function errorChain(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth++) {
    parts.push(current instanceof Error ? current.message : String(current));
    current = (current as { cause?: unknown }).cause;
  }
  return parts.join(" | ");
}

async function createOrg(tx: DatabaseTransaction, label: string): Promise<string> {
  const rows = await tx
    .insert(organization)
    .values({ legalName: `ai-${label}-${suffix}` })
    .returning();
  return rows[0]!.id;
}

describe.skipIf(!databaseUrl)("AI-advisory store against PostgreSQL", () => {
  let client: DbClient;

  beforeAll(() => {
    client = createDb(databaseUrl!);
  });

  afterAll(async () => {
    await client.close();
  });

  it("records a run and a suggestion and persists a decision with its audit", async () => {
    await inRollback(client.db, async (tx) => {
      const orgId = await createOrg(tx, "happy");
      const store = createPostgresAiAdvisoryStore(tx);

      const { analysisRunId } = await recordAiAnalysisRun(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        kind: "seasonal",
        provider: "opencode",
        model: "model-a",
        promptVersion: "v1",
        costEstimate: "0.0100",
      });
      const { suggestionId } = await recordAiSuggestion(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        analysisRunId,
        scopeType: "product",
      });

      const decided = await decideAiSuggestion(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        suggestionId,
        decision: "approved",
      });
      expect(decided.state).toBe("approved");

      const rows = await listAiSuggestions(store, { organizationId: orgId, state: "approved" });
      expect(rows.map((row) => row.id)).toEqual([suggestionId]);

      const audits = await listAuditEventsForEntity(tx, "ai_suggestion", suggestionId);
      expect(audits.some((event) => event.action === "ai.suggestion.approved")).toBe(true);
    });
  });

  it("scopes the decision by organization (DEC-061)", async () => {
    await inRollback(client.db, async (tx) => {
      const orgId = await createOrg(tx, "own");
      const otherOrgId = await createOrg(tx, "other");
      const store = createPostgresAiAdvisoryStore(tx);

      const { analysisRunId } = await recordAiAnalysisRun(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        kind: "other",
        provider: "p",
        model: "m",
        promptVersion: "v1",
      });
      const { suggestionId } = await recordAiSuggestion(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        analysisRunId,
        scopeType: "period",
      });

      await expect(
        decideAiSuggestion(store, {
          organizationId: otherOrgId,
          actorId: randomUUID(),
          suggestionId,
          decision: "approved",
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  it("makes ai_analysis_run append-only (ADR-0009)", async () => {
    await inRollback(client.db, async (tx) => {
      const orgId = await createOrg(tx, "immutable");
      const store = createPostgresAiAdvisoryStore(tx);
      const { analysisRunId } = await recordAiAnalysisRun(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        kind: "other",
        provider: "p",
        model: "m",
        promptVersion: "v1",
      });

      let updateError: unknown;
      try {
        await tx.transaction(async (inner) => {
          await inner
            .update(aiAnalysisRun)
            .set({ status: "failed" })
            .where(eq(aiAnalysisRun.id, analysisRunId));
        });
      } catch (error) {
        updateError = error;
      }
      expect(errorChain(updateError)).toContain("append-only");
    });
  });

  it("enforces the rejection-reason and decision-pair checks at the database", async () => {
    await inRollback(client.db, async (tx) => {
      const orgId = await createOrg(tx, "checks");
      const store = createPostgresAiAdvisoryStore(tx);
      const { analysisRunId } = await recordAiAnalysisRun(store, {
        organizationId: orgId,
        actorId: randomUUID(),
        kind: "other",
        provider: "p",
        model: "m",
        promptVersion: "v1",
      });

      let reasonError: unknown;
      try {
        await tx.transaction(async (inner) => {
          await inner.insert(aiSuggestion).values({
            organizationId: orgId,
            analysisRunId,
            scopeType: "product",
            state: "rejected",
            decidedBy: randomUUID(),
            decidedAt: new Date(),
            reason: "   ",
          });
        });
      } catch (error) {
        reasonError = error;
      }
      expect(errorChain(reasonError)).toContain("ai_suggestion_reason_check");

      let decidedError: unknown;
      try {
        await tx.transaction(async (inner) => {
          await inner.insert(aiSuggestion).values({
            organizationId: orgId,
            analysisRunId,
            scopeType: "product",
            state: "approved",
          });
        });
      } catch (error) {
        decidedError = error;
      }
      expect(errorChain(decidedError)).toContain("ai_suggestion_decided_check");
    });
  });
});
