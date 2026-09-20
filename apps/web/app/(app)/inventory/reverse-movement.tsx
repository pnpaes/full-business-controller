"use client";

import { Alert, Button, StatusPill, TextField, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not reverse the movement. Please try again.";

export interface ReverseMovementProps {
  readonly movementId: string;
  /** True when a reversal already exists; the action is then not offered. */
  readonly reversed: boolean;
}

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

/**
 * The per-row reverse action (DEC-028, 08_UI_UX.md §8.3): a reason is mandatory,
 * the reversal is an exact offset posted as a new ledger row, and the server
 * rejects a second reversal. The reason is kept in state so a rejection does not
 * lose the operator's input (§8.5).
 */
export function ReverseMovement({ movementId, reversed }: ReverseMovementProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (reversed) {
    return <StatusPill tone="info">Reversed</StatusPill>;
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (reason.trim().length === 0) {
      setError("A reversal reason is required.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/inventory/movements/${movementId}/reverse`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reasonCode: reason.trim() }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
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
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Reverse
      </Button>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}>
      {error !== null ? <Alert tone="danger">{error}</Alert> : null}
      <TextField
        name={`reason-${movementId}`}
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
