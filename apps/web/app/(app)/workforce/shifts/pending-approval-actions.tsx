"use client";

import { Alert, Button, TextField, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

const FALLBACK_ERROR = "Could not complete the decision. Please try again.";

interface ErrorBody {
  readonly error?: string;
}

/**
 * The manager's approve/reject controls for one pending self-assignment
 * (`WF-003`, `DEC-146`), posting to
 * `POST /api/v1/workforce/shift-assignments/[id]/decide`. A rejection requires a
 * non-blank reason (the server enforces it too); the reason is recorded in the
 * audit fact.
 */
export function PendingApprovalActions({ assignmentId }: { readonly assignmentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  async function decide(
    decision: "approved" | "rejected",
    rejectionReason?: string,
  ): Promise<void> {
    setError(null);
    setBusy(decision);
    try {
      const response = await fetch(`/api/v1/workforce/shift-assignments/${assignmentId}/decide`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          rejectionReason === undefined ? { decision } : { decision, reason: rejectionReason },
        ),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ErrorBody | null;
        setError(
          typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR,
        );
        return;
      }
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(null);
    }
  }

  if (rejecting) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: spacing[2], minWidth: 220 }}>
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        <TextField
          name={`reject-reason-${assignmentId}`}
          label="Reason for rejection"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        <div style={{ display: "flex", gap: spacing[2] }}>
          <Button
            type="button"
            variant="danger"
            size="sm"
            loading={busy === "rejected"}
            disabled={busy !== null || reason.trim().length === 0}
            onClick={() => {
              void decide("rejected", reason.trim());
            }}
          >
            Reject
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy !== null}
            onClick={() => {
              setRejecting(false);
              setReason("");
              setError(null);
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[1], minWidth: 160 }}>
      {error !== null ? <Alert tone="danger">{error}</Alert> : null}
      <div style={{ display: "flex", gap: spacing[2] }}>
        <Button
          type="button"
          size="sm"
          loading={busy === "approved"}
          disabled={busy !== null}
          onClick={() => {
            void decide("approved");
          }}
        >
          Approve
        </Button>
        <Button
          type="button"
          variant="danger"
          size="sm"
          disabled={busy !== null}
          onClick={() => setRejecting(true)}
        >
          Reject
        </Button>
      </div>
    </div>
  );
}
