"use client";

import { Alert, Button, TextField, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const LOCK_FALLBACK = "Could not lock the close. Please try again.";
const REOPEN_FALLBACK = "Could not reopen the close. Please try again.";

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : fallback;
}

export interface CloseRowActionsProps {
  readonly closeId: string;
  /** True when the row is `closing` and the caller may lock it at this scope. */
  readonly canLock: boolean;
  /** True when the row is `locked` and the caller may reopen it at this scope. */
  readonly canReopen: boolean;
}

/**
 * Per-row lock / reopen controls for the close register (`DEC-119`, `DEC-027`).
 * A `closing` close is locked; a `locked` close is reopened with a **required**
 * reason (the audited, elevated-permission path). The server is the authority on
 * the transition and the scope, so a rejected action surfaces its message rather
 * than being silently accepted; `canLock`/`canReopen` only decide what is offered.
 */
export function CloseRowActions({ closeId, canLock, canReopen }: CloseRowActionsProps) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"lock" | "reopen" | null>(null);

  if (!canLock && !canReopen) {
    return <span aria-hidden="true">—</span>;
  }

  async function lock(): Promise<void> {
    setError(null);
    setBusy("lock");
    try {
      const response = await fetch(`/api/v1/period-closes/${closeId}/lock`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        setError(await errorMessage(response, LOCK_FALLBACK));
        return;
      }
      router.refresh();
    } catch {
      setError(LOCK_FALLBACK);
    } finally {
      setBusy(null);
    }
  }

  async function reopen(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (reason.trim().length === 0) {
      setError("A reopen reason is required (DEC-027).");
      return;
    }
    setBusy("reopen");
    try {
      const response = await fetch(`/api/v1/period-closes/${closeId}/reopen`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!response.ok) {
        setError(await errorMessage(response, REOPEN_FALLBACK));
        return;
      }
      router.refresh();
    } catch {
      setError(REOPEN_FALLBACK);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[2], minWidth: 200 }}>
      {error !== null ? <Alert tone="danger">{error}</Alert> : null}

      {canLock ? (
        <div>
          <Button onClick={lock} loading={busy === "lock"} disabled={busy !== null}>
            Lock close
          </Button>
        </div>
      ) : null}

      {canReopen ? (
        <form
          onSubmit={reopen}
          style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}
        >
          <TextField
            name={`reopen-reason-${closeId}`}
            label="Reopen reason"
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. late settlement import"
            help="Required and recorded on the audit trail (DEC-027)."
          />
          <div>
            <Button
              type="submit"
              variant="secondary"
              loading={busy === "reopen"}
              disabled={busy !== null}
            >
              Reopen
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
