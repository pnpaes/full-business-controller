"use client";

import { Alert, Button, SelectField, geometry, spacing } from "@aquarela/ui";
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

const buttonStyle = { minHeight: geometry.touchTarget } as const;

/**
 * The audited controls of one corrective action (`DEC-090`, `DEC-095`): its owner
 * and its status progression. An operator (kitchen/FOH) may move an action to
 * `in_progress`/`done` but never `verified` — verification is a manager-level
 * transition and the server rejects it for operators, so the button only renders
 * for verifier roles. The completion/verification instants and the verifier
 * identity are derived by the command; the form sends the status alone.
 *
 * The owner is the organization's active users, loaded server-side and passed as
 * props (the incident and task picker pattern). It is optional — the
 * `Unassigned` placeholder clears it — and a currently-assigned owner who is no
 * longer active stays an option (added by the page) so the picker shows the real
 * assignment. Owner and status send separate patches, so changing one never
 * rewrites the other.
 */
export function CorrectiveActionControls({
  actionId,
  status,
  ownerId,
  owners,
  canEdit,
  canVerify,
}: {
  readonly actionId: string;
  readonly status: string;
  readonly ownerId: string | null;
  readonly owners: readonly { readonly id: string; readonly label: string }[];
  readonly canEdit: boolean;
  readonly canVerify: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busyStatus, setBusyStatus] = useState<string | null>(null);
  const [owner, setOwner] = useState(ownerId ?? "");
  const [busyOwner, setBusyOwner] = useState(false);

  if (!canEdit) {
    return error !== null ? <Alert tone="danger">{error}</Alert> : null;
  }

  const busy = busyStatus !== null || busyOwner;

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

  async function saveOwner(): Promise<void> {
    setError(null);
    setBusyOwner(true);
    try {
      const response = await fetch(`/api/v1/hms/corrective-actions/${actionId}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerId: owner.length > 0 ? owner : null }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusyOwner(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}>
      {error !== null ? <Alert tone="danger">{error}</Alert> : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2], alignItems: "flex-end" }}>
        <SelectField
          name={`ownerId-${actionId}`}
          label="Owner"
          value={owner}
          onChange={(event) => setOwner(event.target.value)}
          placeholder="Unassigned"
          options={owners.map((option) => ({ value: option.id, label: option.label }))}
          disabled={busy}
        />
        <Button
          style={buttonStyle}
          loading={busyOwner}
          disabled={busy || owner === (ownerId ?? "")}
          onClick={saveOwner}
        >
          Save owner
        </Button>
      </div>
      {status === "verified" ? null : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2] }}>
          {status === "open" ? (
            <Button
              style={buttonStyle}
              loading={busyStatus === "in_progress"}
              disabled={busy}
              onClick={() => progress("in_progress")}
            >
              Start
            </Button>
          ) : null}
          {status === "open" || status === "in_progress" ? (
            <Button
              style={buttonStyle}
              loading={busyStatus === "done"}
              disabled={busy}
              onClick={() => progress("done")}
            >
              Mark done
            </Button>
          ) : null}
          {canVerify && (status === "done" || status === "in_progress" || status === "open") ? (
            <Button
              style={buttonStyle}
              loading={busyStatus === "verified"}
              disabled={busy}
              onClick={() => progress("verified")}
            >
              Verify
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
