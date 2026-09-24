"use client";

import { Alert, Button, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

const FALLBACK_ERROR = "Could not withdraw the assignment. Please try again.";

/**
 * Withdraws one approved shift assignment (`WF-003`, `DEC-037`) through
 * `PATCH /api/v1/workforce/shift-assignments/[id]` with `{ state: "withdrawn" }`
 * — the only transition the route exposes. The shift reverts to `published`
 * (or `open` when never published) server-side.
 */
export function WithdrawAssignmentButton({ assignmentId }: { readonly assignmentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function withdraw(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/workforce/shift-assignments/${assignmentId}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: "withdrawn" }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(
          typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR,
        );
        return;
      }
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[1] }}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        loading={busy}
        disabled={busy}
        onClick={withdraw}
      >
        Withdraw
      </Button>
      {error !== null ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}
