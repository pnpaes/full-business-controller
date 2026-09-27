"use client";

import {
  Alert,
  Button,
  EmptyState,
  Modal,
  StatusPill,
  Table,
  Td,
  Th,
  TextField,
  typography,
} from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { aiStateView, formatAiInstant, suggestionText } from "./ai-labels";

const APPROVE_FALLBACK = "Could not approve the suggestion. Please try again.";
const REJECT_FALLBACK = "Could not reject the suggestion. Please try again.";

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : fallback;
}

export interface AiSuggestionRow {
  readonly id: string;
  readonly state: string;
  readonly scopeType: string;
  readonly scopeRef: string | null;
  readonly suggestion: Record<string, unknown>;
  readonly analysisRunId: string;
  readonly reason: string | null;
  readonly decidedAt: Date | string | null;
  readonly createdAt: Date | string;
}

const subLine = { opacity: 0.75, fontSize: typography.fontSize.xs } as const;

type Decision = "approve" | "reject";

/**
 * The AI-advisory review queue (`ADR-0009`, `DEC-142`): a human approves or
 * rejects each `proposed` suggestion. **Advisory only** — a decision records a
 * human verdict and triggers no action anywhere; nothing is auto-applied.
 *
 * Model output is untrusted, so the suggestion is rendered as plain text (never
 * `dangerouslySetInnerHTML`). Decide actions require `AI_DECIDE_ROLES`; the API
 * is the authority and a rejection requires a reason.
 */
export function AiRegister({
  rows,
  canDecide,
}: {
  readonly rows: readonly AiSuggestionRow[];
  readonly canDecide: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<{ row: AiSuggestionRow; decision: Decision } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <EmptyState title="No suggestions for this filter">
        AI advisory suggestions appear here once a scheduled run has recorded them. They stay
        advisory — a human decides each one and nothing is applied automatically (ADR-0009).
      </EmptyState>
    );
  }

  async function submit(row: AiSuggestionRow, decision: Decision): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    const fallback = decision === "approve" ? APPROVE_FALLBACK : REJECT_FALLBACK;
    try {
      const response = await fetch(`/api/v1/ai/suggestions/${row.id}/${decision}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(decision === "reject" ? { reason: reason.trim() } : {}),
      });
      if (!response.ok) {
        setError(await errorMessage(response, fallback));
        return;
      }
      setNotice(
        decision === "approve"
          ? "Suggestion approved — recorded as a human verdict; no action was triggered."
          : "Suggestion rejected — recorded with your reason; no action was triggered.",
      );
      setPending(null);
      setReason("");
      router.refresh();
    } catch {
      setError(fallback);
    } finally {
      setBusy(false);
    }
  }

  function open(row: AiSuggestionRow, decision: Decision): void {
    setError(null);
    setNotice(null);
    setReason("");
    setPending({ row, decision });
  }

  const rejectReasonMissing = pending?.decision === "reject" && reason.trim().length === 0;

  return (
    <>
      {notice !== null ? <Alert tone="success">{notice}</Alert> : null}
      {error !== null ? <Alert tone="danger">{error}</Alert> : null}

      <Table caption="AI advisory suggestions, newest first." columnCount={canDecide ? 5 : 4}>
        <thead>
          <tr>
            <Th>State</Th>
            <Th>Scope</Th>
            <Th>Suggestion</Th>
            <Th>Created</Th>
            {canDecide ? <Th>Decision</Th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const state = aiStateView(row.state);
            const decidable = canDecide && row.state === "proposed";
            return (
              <tr key={row.id}>
                <Td>
                  <StatusPill tone={state.tone}>{state.label}</StatusPill>
                  <br />
                  <span style={subLine}>{formatAiInstant(row.decidedAt)}</span>
                </Td>
                <Td style={{ whiteSpace: "nowrap" }}>
                  {row.scopeType}
                  <br />
                  <span style={subLine}>{row.scopeRef ?? "—"}</span>
                </Td>
                <Td style={{ maxWidth: 420 }}>{suggestionText(row.suggestion)}</Td>
                <Td style={{ whiteSpace: "nowrap" }}>{formatAiInstant(row.createdAt)}</Td>
                {canDecide ? (
                  <Td>
                    {decidable ? (
                      <div style={{ display: "flex", gap: 8 }}>
                        <Button onClick={() => open(row, "approve")}>Approve</Button>
                        <Button variant="secondary" onClick={() => open(row, "reject")}>
                          Reject
                        </Button>
                      </div>
                    ) : (
                      <span aria-hidden="true">—</span>
                    )}
                  </Td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </Table>

      <Modal
        title={
          pending === null
            ? ""
            : pending.decision === "approve"
              ? "Approve this suggestion?"
              : "Reject this suggestion?"
        }
        open={pending !== null}
        onClose={() => (busy ? undefined : setPending(null))}
      >
        {pending === null ? null : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <p style={{ margin: 0 }}>
              {pending.decision === "approve"
                ? "Approving records your verdict on the suggestion. It is advisory only — nothing is applied automatically (ADR-0009)."
                : "Rejecting records your verdict and the reason. It is advisory only — nothing is applied automatically (ADR-0009)."}
            </p>
            <p style={{ margin: 0, ...subLine }}>{suggestionText(pending.row.suggestion)}</p>
            {pending.decision === "reject" ? (
              <TextField
                name={`ai-reject-reason-${pending.row.id}`}
                label="Reason"
                required
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="e.g. margin already covered by the price-version plan"
                help="Required and recorded on the audit trail."
              />
            ) : null}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <Button variant="secondary" onClick={() => setPending(null)} disabled={busy}>
                Cancel
              </Button>
              <Button
                onClick={() => submit(pending.row, pending.decision)}
                loading={busy}
                disabled={busy || rejectReasonMissing}
              >
                {pending.decision === "approve" ? "Approve" : "Reject"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
