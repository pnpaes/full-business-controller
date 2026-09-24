"use client";

import { Alert, Button, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

const FALLBACK_ERROR = "Could not retire the employee. Please try again.";

/**
 * Retires one employee (`WF-007`, `DEC-087`): the tombstone action — employees
 * are retired, never deleted, and retirement is idempotent server-side. The
 * button is rendered only for a not-yet-retired row the caller may write.
 */
export function RetireEmployeeButton({ employeeId }: { readonly employeeId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retire(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/workforce/employees/${employeeId}/retire`, {
        method: "POST",
        credentials: "same-origin",
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
        variant="danger"
        size="sm"
        loading={busy}
        disabled={busy}
        onClick={retire}
      >
        Retire
      </Button>
      {error !== null ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}
