"use client";

import { Alert, Button, SectionCard, SelectField, TextareaField, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const RESOLVE_FALLBACK = "Could not resolve the reconciliation. Please try again.";

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : fallback;
}

export interface ResolveRow {
  readonly id: string;
  readonly scopeType: string;
  readonly scopeId: string;
  readonly status: string;
  readonly difference: string;
}

const STATUS_OPTIONS = [
  { value: "approved", label: "Approved — the difference is accepted" },
  { value: "resolved", label: "Resolved — the difference was investigated" },
  { value: "pending", label: "Pending — keep it open" },
];

const NOTE_REQUIRED = new Set(["resolved", "approved"]);

/**
 * Records a reconciliation's resolution (`REC-001`/`005`). Moving to
 * `resolved`/`approved` requires a note so an exception is never closed without
 * a reason; there is no approval-workflow table, so the session actor is the
 * approval and the audit fact is the trail.
 */
export function ResolveForm({ rows }: { readonly rows: readonly ResolveRow[] }) {
  const router = useRouter();
  const [reconciliationId, setReconciliationId] = useState(rows[0]?.id ?? "");
  const [status, setStatus] = useState("approved");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (reconciliationId.length === 0) {
      setError("Choose the reconciliation to resolve.");
      return;
    }
    if (NOTE_REQUIRED.has(status) && note.trim().length === 0) {
      setError(`A resolution note is required to mark a reconciliation ${status}.`);
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`/api/v1/reconciliations/${reconciliationId}/resolve`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          ...(note.trim().length === 0 ? {} : { resolutionNote: note.trim() }),
        }),
      });
      if (!response.ok) {
        setError(await errorMessage(response, RESOLVE_FALLBACK));
        return;
      }
      setSuccess("Resolution recorded.");
      setNote("");
      router.refresh();
    } catch {
      setError(RESOLVE_FALLBACK);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Resolve a reconciliation" meta={`${rows.length} open row(s)`}>
      <form
        onSubmit={submit}
        style={{ display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 720 }}
      >
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        {success !== null ? <Alert tone="success">{success}</Alert> : null}

        <SelectField
          name="reconciliationId"
          label="Reconciliation"
          required
          value={reconciliationId}
          onChange={(event) => setReconciliationId(event.target.value)}
          options={rows.map((row) => ({
            value: row.id,
            label: `${row.scopeType} · ${row.scopeId} · ${row.status} · difference ${row.difference}`,
          }))}
        />

        <SelectField
          name="status"
          label="Status"
          required
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          options={STATUS_OPTIONS}
        />

        <TextareaField
          name="resolutionNote"
          label="Resolution note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          required={NOTE_REQUIRED.has(status)}
          help="Required when moving to resolved/approved; recorded on the row and the audit trail."
        />

        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Record resolution
          </Button>
        </div>
        <p style={{ margin: 0, opacity: 0.8 }}>
          Resolving does not change the tolerance or the difference: it records the judgement about
          the existing figures. There is no tolerance table, so the snapshot is shown as stored.
        </p>
      </form>
    </SectionCard>
  );
}
