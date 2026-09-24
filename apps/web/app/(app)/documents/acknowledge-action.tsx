"use client";

import { Button, color, typography } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

const FALLBACK_ERROR = "Could not record the acknowledgement. Please try again.";

interface ErrorBody {
  readonly error?: string;
}

/**
 * Records the signed-in user's acknowledgement of the document's current
 * published version (`DEC-088`, `DOC-003`) through the existing
 * `POST /api/v1/documents/[id]/acknowledgements` route (no explicit version —
 * the command resolves the current published version). Idempotent server-side.
 */
export function AcknowledgeAction({ documentId }: { readonly documentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function acknowledge(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/documents/${documentId}/acknowledgements`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
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
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
      <Button variant="secondary" onClick={acknowledge} loading={busy} disabled={busy}>
        Acknowledge this version
      </Button>
      {error !== null ? (
        <p
          style={{
            margin: 0,
            fontSize: typography.fontSize.sm,
            color: color.status.danger.fg,
          }}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
