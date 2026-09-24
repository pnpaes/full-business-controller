"use client";

import { Alert, Button, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

const FALLBACK_ERROR = "Could not record the decision. Please try again.";

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

/**
 * The per-row review gate of one pending observation (`DEC-126`, the `DEC-020`
 * human-review gate): **Review** admits it as intelligence, **Reject** sets it
 * aside. A decision is taken once; the server rejects a second one, so the
 * controls are shown only while the observation is pending.
 */
export function ObservationReviewControls({ observationId }: { readonly observationId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function decide(decision: "reviewed" | "rejected"): Promise<void> {
    setError(null);
    setBusy(decision);
    try {
      const response = await fetch(`/api/v1/competitors/observations/${observationId}/review`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
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
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[2], minWidth: 160 }}>
      {error !== null ? <Alert tone="danger">{error}</Alert> : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2] }}>
        <Button
          style={{ minHeight: 44 }}
          loading={busy === "reviewed"}
          disabled={busy !== null}
          onClick={() => void decide("reviewed")}
        >
          Review
        </Button>
        <Button
          variant="secondary"
          style={{ minHeight: 44 }}
          loading={busy === "rejected"}
          disabled={busy !== null}
          onClick={() => void decide("rejected")}
        >
          Reject
        </Button>
      </div>
    </div>
  );
}
