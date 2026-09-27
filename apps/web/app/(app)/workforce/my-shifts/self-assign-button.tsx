"use client";

import { Alert, Button, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

const FALLBACK_ERROR = "Could not request this shift. Please try again.";

/**
 * Self-assigns one open/published shift (`WF-003`, `DEC-146`) through
 * `POST /api/v1/workforce/shifts/[id]/self-assign`. The shift opens as
 * `pending_approval`; the weekly maximum and the location/role rules are
 * enforced server-side, so an over-limit request surfaces the server message.
 */
export function SelfAssignButton({ shiftId }: { readonly shiftId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function selfAssign(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/workforce/shifts/${shiftId}/self-assign`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
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
      <Button type="button" size="sm" loading={busy} disabled={busy} onClick={selfAssign}>
        Self-assign
      </Button>
      {error !== null ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}
