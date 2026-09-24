"use client";

import { Button, color, typography } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

const FALLBACK_ERROR = "Could not publish the version. Please try again.";

interface ErrorBody {
  readonly error?: string;
}

/**
 * Publishes one document version (`DEC-088`, `DOC-002`) through the existing
 * `POST /api/v1/document-versions/[id]/publish` route. Only the latest
 * unpublished version is offered this action (the command enforces the same
 * rule server-side).
 */
export function PublishVersionButton({
  documentVersionId,
}: {
  readonly documentVersionId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function publish(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/document-versions/${documentVersionId}/publish`, {
        method: "POST",
        credentials: "same-origin",
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
    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
      <Button size="sm" variant="secondary" onClick={publish} loading={busy} disabled={busy}>
        Publish
      </Button>
      {error !== null ? (
        <span style={{ fontSize: typography.fontSize.xs, color: color.status.danger.fg }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
