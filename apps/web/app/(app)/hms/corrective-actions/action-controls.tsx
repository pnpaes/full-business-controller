"use client";

import { Alert, Button, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

const FALLBACK_ERROR = "Could not update the action. Please try again.";

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

const buttonStyle = { minHeight: 44 } as const;

/**
 * The audited status progression of one corrective action (`DEC-090`, `DEC-095`):
 * an operator (kitchen/FOH) may move an action to `in_progress`/`done` but never
 * `verified` — verification is a manager-level transition and the server rejects
 * it for operators, so the button only renders for verifier roles. The
 * completion/verification instants and the verifier identity are derived by the
 * command; the form sends the status alone.
 */
export function CorrectiveActionControls({
  actionId,
  status,
  canEdit,
  canVerify,
}: {
  readonly actionId: string;
  readonly status: string;
  readonly canEdit: boolean;
  readonly canVerify: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busyStatus, setBusyStatus] = useState<string | null>(null);

  if (!canEdit || status === "verified") {
    return error !== null ? <Alert tone="danger">{error}</Alert> : null;
  }

  async function progress(nextStatus: string): Promise<void> {
    setError(null);
    setBusyStatus(nextStatus);
    try {
      const response = await fetch(`/api/v1/hms/corrective-actions/${actionId}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusyStatus(null);
    }
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2] }}>
      {error !== null ? <Alert tone="danger">{error}</Alert> : null}
      {status === "open" ? (
        <Button
          style={buttonStyle}
          loading={busyStatus === "in_progress"}
          disabled={busyStatus !== null}
          onClick={() => progress("in_progress")}
        >
          Start
        </Button>
      ) : null}
      {status === "open" || status === "in_progress" ? (
        <Button
          style={buttonStyle}
          loading={busyStatus === "done"}
          disabled={busyStatus !== null}
          onClick={() => progress("done")}
        >
          Mark done
        </Button>
      ) : null}
      {canVerify && (status === "done" || status === "in_progress" || status === "open") ? (
        <Button
          style={buttonStyle}
          loading={busyStatus === "verified"}
          disabled={busyStatus !== null}
          onClick={() => progress("verified")}
        >
          Verify
        </Button>
      ) : null}
    </div>
  );
}
