"use client";

import { Alert, Button, radius, spacing, typography } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { taskActionLabel } from "./task-labels";

const FALLBACK_ERROR = "Could not update the task. Please try again.";

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

const selectStyle = {
  minHeight: 44,
  padding: `${spacing[2]}px`,
  borderRadius: radius.sm,
  border: "1px solid currentColor",
  font: "inherit",
  maxWidth: 200,
} as const;

const buttonStyle = { minHeight: 44 } as const;

/**
 * The inline per-row controls of one task (`DEC-122`): the assignee picker and
 * the legal status transitions for the task's current status. The allowed
 * transitions are computed server-side from the same machine the API enforces,
 * so a button never offers a transition the server would reject; the server
 * remains the authority on every action.
 *
 * The assignee picker sends an explicit `null` to unassign. Both actions call the
 * task routes and refresh the server component on success.
 */
export function TaskRowControls({
  taskId,
  ownerId,
  users,
  allowedTargets,
}: {
  readonly taskId: string;
  readonly ownerId: string | null;
  readonly users: readonly { readonly id: string; readonly label: string }[];
  readonly allowedTargets: readonly string[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function assign(value: string): Promise<void> {
    setError(null);
    setBusy("assign");
    try {
      const response = await fetch(`/api/v1/tasks/${taskId}/assign`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerId: value.length === 0 ? null : value }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(null);
    }
  }

  async function transition(target: string): Promise<void> {
    setError(null);
    setBusy(target);
    try {
      const response = await fetch(`/api/v1/tasks/${taskId}/transition`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: target }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[2], minWidth: 200 }}>
      {error !== null ? <Alert tone="danger">{error}</Alert> : null}
      <label style={{ display: "flex", flexDirection: "column", gap: spacing[1] }}>
        <span style={{ fontSize: typography.fontSize.sm }}>Assignee</span>
        <select
          aria-label="Assignee"
          value={ownerId ?? ""}
          disabled={busy !== null}
          onChange={(event) => void assign(event.target.value)}
          style={selectStyle}
        >
          <option value="">Unassigned</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.label}
            </option>
          ))}
        </select>
      </label>
      {allowedTargets.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2] }}>
          {allowedTargets.map((target) => (
            <Button
              key={target}
              style={buttonStyle}
              loading={busy === target}
              disabled={busy !== null}
              onClick={() => void transition(target)}
            >
              {taskActionLabel(target)}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
