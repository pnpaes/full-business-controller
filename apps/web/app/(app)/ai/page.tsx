import { createPostgresAiAdvisoryStore, listAiSuggestions } from "@aquarela/application";
import { EmptyState, PageHeader, SectionCard, spacing, typography } from "@aquarela/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getDb } from "../../../lib/db";
import { resolveOrganization } from "../../../lib/organization";
import { getServerSession } from "../../../lib/server-session";
import {
  AI_DECIDE_ROLES,
  AI_READ_ROLES,
  isAiAuthorized,
  loadAiAccess,
} from "../../api/v1/ai/access";

import { AiRegister, type AiSuggestionRow } from "./ai-register";
import { aiStateView, isAiState, AI_STATE_FILTERS } from "./ai-labels";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI advisory — Aquarela Business Control" };

const PAGE_SIZE = 50;

const contentColumn = {
  display: "flex",
  flexDirection: "column",
  gap: spacing[6],
  maxWidth: 1120,
  margin: "0 auto",
  padding: `${spacing[8]}px ${spacing[4]}px`,
} as const;

type SearchParams = Record<string, string | string[] | undefined>;

function readParam(params: SearchParams, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

function href(state: string, offset = 0): string {
  return `/ai?state=${encodeURIComponent(state)}&offset=${offset}`;
}

/**
 * The AI-advisory review queue (`ADR-0009` Accepted 2026-09-27, `DEC-142`,
 * row 17). It lists recorded `proposed` suggestions (default filter) and lets a
 * decision role approve or reject each one. **Advisory only**: a decision is a
 * human verdict and triggers no action; the deterministic baseline stays the
 * system of record.
 *
 * Reads the same application service and row shape as `GET /api/v1/ai/suggestions`;
 * access mirrors the API (`AI_READ_ROLES` read, `AI_DECIDE_ROLES` decide).
 */
export default async function AiPage({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParams>;
}) {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const access = await loadAiAccess(session.userId);
  if (!isAiAuthorized(access, AI_READ_ROLES)) {
    return (
      <div style={contentColumn}>
        <PageHeader
          title="AI advisory"
          scope="Insights"
          description="Human review of AI-assisted advisory suggestions. Nothing is applied automatically."
        />
        <EmptyState title="Not available for your role">
          The AI advisory queue is limited to the advisory roles (owner, general manager, finance
          and admin). Ask an owner or administrator if you need access.
        </EmptyState>
      </div>
    );
  }

  const params = await searchParams;
  const stateParam = readParam(params, "state") ?? "proposed";
  const state = isAiState(stateParam) ? stateParam : "proposed";
  const offsetRaw = Number.parseInt(readParam(params, "offset") ?? "0", 10);
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;

  const suggestions = await listAiSuggestions(createPostgresAiAdvisoryStore(getDb().db), {
    organizationId: resolveOrganization(),
    state,
    limit: PAGE_SIZE,
    offset,
  });

  const rows: AiSuggestionRow[] = suggestions.map((suggestion) => ({
    id: suggestion.id,
    state: suggestion.state,
    scopeType: suggestion.scopeType,
    scopeRef: suggestion.scopeRef,
    suggestion: suggestion.suggestion,
    analysisRunId: suggestion.analysisRunId,
    reason: suggestion.reason,
    decidedAt: suggestion.decidedAt,
    createdAt: suggestion.createdAt,
  }));

  const canDecide = isAiAuthorized(access, AI_DECIDE_ROLES);

  return (
    <div style={contentColumn}>
      <PageHeader
        title="AI advisory"
        scope="Insights"
        description="Human review of AI-assisted advisory suggestions (ADR-0009). Advisory only — a decision records a verdict and triggers no action."
      />

      <nav
        aria-label="Filter by state"
        style={{ display: "flex", flexWrap: "wrap", gap: spacing[2] }}
      >
        {AI_STATE_FILTERS.map((value) => {
          const active = value === state;
          const view = aiStateView(value);
          return (
            <Link
              key={value}
              href={href(value)}
              aria-current={active ? "true" : undefined}
              style={{
                padding: `${spacing[1]}px ${spacing[3]}px`,
                borderRadius: 999,
                border: `1px solid ${active ? "transparent" : "rgba(0,0,0,0.15)"}`,
                background: active ? "rgba(0,0,0,0.06)" : "transparent",
                fontWeight: active ? typography.fontWeight.semibold : typography.fontWeight.regular,
                textDecoration: "none",
                color: "inherit",
              }}
            >
              {view.label}
            </Link>
          );
        })}
      </nav>

      <SectionCard
        title="Suggestions"
        meta={`${rows.length} ${rows.length === 1 ? "suggestion" : "suggestions"} · newest first · offset ${offset}`}
      >
        <div style={{ overflowX: "auto", minWidth: 0 }}>
          <AiRegister rows={rows} canDecide={canDecide} />
        </div>
      </SectionCard>

      {rows.length === PAGE_SIZE || offset > 0 ? (
        <div style={{ display: "flex", gap: spacing[3], justifyContent: "space-between" }}>
          {offset > 0 ? (
            <Link href={href(state, Math.max(0, offset - PAGE_SIZE))}>← Newer</Link>
          ) : (
            <span />
          )}
          {rows.length === PAGE_SIZE ? (
            <Link href={href(state, offset + PAGE_SIZE)}>Older →</Link>
          ) : (
            <span />
          )}
        </div>
      ) : null}

      <p style={{ margin: 0, opacity: 0.75, fontSize: typography.fontSize.sm }}>
        A decision is a human verdict recorded on the audit trail; it never posts stock, changes a
        price or writes to any external system. The API is <code>/api/v1/ai/suggestions</code>.
      </p>
    </div>
  );
}
