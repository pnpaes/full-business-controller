"use client";

import { Alert, Button, StatusPill, TextField, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not reverse the sales line. Please try again.";

export interface ReverseLineProps {
  readonly salesLineId: string;
  /** True when a reversal line already exists; the action is then not offered. */
  readonly reversed: boolean;
  /** True when this line is itself a reversal; a reversal is never reversed. */
  readonly isReversal: boolean;
}

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

/**
 * The per-line reverse action (`DEC-116`, `DEC-028`/`DEC-073`): a reason is
 * mandatory, and the correction posts a new negated line plus every reversal
 * movement for the original in one transaction. The server rejects a line that is
 * itself a reversal or is already reversed, so neither offers the action. The
 * reason is kept in state so a rejection does not lose the operator's input
 * (§8.5).
 */
export function ReverseLine({ salesLineId, reversed, isReversal }: ReverseLineProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (isReversal) {
    return null;
  }

  if (reversed) {
    return <StatusPill tone="info">Reversed</StatusPill>;
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (reason.trim().length === 0) {
      setError("A reversal reason is required.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/sales/lines/${salesLineId}/reverse`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reasonCode: reason.trim() }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      setSuccess("Reversal posted.");
      setOpen(false);
      setReason("");
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}>
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        {success !== null ? <Alert tone="success">{success}</Alert> : null}
        <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
          Reverse
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}>
      {error !== null ? <Alert tone="danger">{error}</Alert> : null}
      <TextField
        name={`reason-${salesLineId}`}
        label="Reversal reason"
        required
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="e.g. wrong entry"
      />
      <div style={{ display: "flex", gap: spacing[2] }}>
        <Button type="submit" variant="danger" size="sm" loading={busy} disabled={busy}>
          Confirm reversal
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
