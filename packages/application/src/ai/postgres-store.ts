import * as repo from "@aquarela/persistence";
import type { Database, NodeDatabase } from "@aquarela/persistence";

import type {
  AiAnalysisRunReadStore,
  AiAnalysisRunRecord,
  AiSuggestionReadStore,
  AiSuggestionRecord,
} from "./read-types";
import type { AiAdvisoryWriteStore } from "./write-types";

/** A transaction handle has no `transaction` method of its own. */
function isNodeDatabase(db: Database): db is NodeDatabase {
  return typeof (db as NodeDatabase).transaction === "function";
}

function toRunRecord(row: repo.AiAnalysisRun): AiAnalysisRunRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    kind: row.kind,
    provider: row.provider,
    model: row.model,
    promptVersion: row.promptVersion,
    inputScope: row.inputScope,
    inputSnapshot: row.inputSnapshot,
    output: row.output,
    status: row.status,
    tokenCounts: row.tokenCounts,
    costEstimate: row.costEstimate,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
    version: row.version,
  };
}

function toSuggestionRecord(row: repo.AiSuggestion): AiSuggestionRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    analysisRunId: row.analysisRunId,
    scopeType: row.scopeType,
    scopeRef: row.scopeRef,
    suggestion: row.suggestion,
    state: row.state,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    reason: row.reason,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
    version: row.version,
  };
}

/**
 * Adapts the `ai_analysis_run`/`ai_suggestion` tables (through the persistence
 * repository) to the read and write ports. The append-only trigger on the run
 * table is the database backstop; this adapter exposes no run update at all. A
 * `decideAiSuggestion` scoped miss (unknown id, other organization, or a row no
 * longer `proposed`) is `undefined`, so the command reports it as a lost race.
 */
export function createPostgresAiAdvisoryStore(
  db: Database,
): AiAdvisoryWriteStore & AiSuggestionReadStore & AiAnalysisRunReadStore {
  return {
    withTransaction: async (fn) => {
      if (!isNodeDatabase(db)) {
        return fn(createPostgresAiAdvisoryStore(db));
      }
      return db.transaction((tx) => fn(createPostgresAiAdvisoryStore(tx)));
    },
    listAiSuggestions: async (query) => {
      const rows = await repo.listAiSuggestions(db, query);
      return rows.map(toSuggestionRecord);
    },
    findAiAnalysisRun: async (organizationId, analysisRunId) => {
      const row = await repo.findAiAnalysisRun(db, { organizationId, analysisRunId });
      return row === undefined ? undefined : toRunRecord(row);
    },
    sumAiAnalysisRunCosts: async (query) => repo.sumAiAnalysisRunCosts(db, query),
    findAiAnalysisRunById: async (organizationId, analysisRunId) => {
      const row = await repo.findAiAnalysisRun(db, { organizationId, analysisRunId });
      return row === undefined ? undefined : toRunRecord(row);
    },
    findAiSuggestionById: async (organizationId, suggestionId) => {
      const row = await repo.findAiSuggestionById(db, { organizationId, suggestionId });
      return row === undefined ? undefined : toSuggestionRecord(row);
    },
    createAiAnalysisRun: async (input) => {
      const row = await repo.createAiAnalysisRun(db, input);
      return toRunRecord(row);
    },
    createAiSuggestion: async (input) => {
      const row = await repo.createAiSuggestion(db, input);
      return toSuggestionRecord(row);
    },
    decideAiSuggestion: async (input) => {
      const row = await repo.decideAiSuggestion(db, input);
      return row === undefined ? undefined : toSuggestionRecord(row);
    },
    writeAudit: async (input) => {
      await repo.writeAuditEvent(db, input);
    },
  };
}
