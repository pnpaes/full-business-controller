"use client";

import { Alert, Button, TextField, color, spacing, typography } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not approve the scenario. Please try again.";

interface ErrorBody {
  readonly error?: string;
}

interface ApproveBody {
  readonly priceVersionId?: string;
}

/** `datetime-local` (no zone) → an ISO instant; blank → `undefined`. */
function readInstant(value: string): Date | undefined | "invalid" {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? "invalid" : parsed;
}

/**
 * Approves a draft/submitted price scenario (PRICE-005 → PRICE-002/003): the
 * command creates the effective price version for the scenario's scope, so this
 * form collects the optional half-open effective window. On success the server
 * component refreshes and renders the created version. Only rendered for a
 * `draft`/`submitted` scenario.
 */
export function ApproveScenarioForm({ priceScenarioId }: { readonly priceScenarioId: string }) {
  const router = useRouter();
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveTo, setEffectiveTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const from = readInstant(effectiveFrom);
    if (from === "invalid") {
      setError("Enter the effective-from date and time, or leave it blank.");
      return;
    }
    const to = readInstant(effectiveTo);
    if (to === "invalid") {
      setError("Enter the effective-to date and time, or leave it blank for an open-ended window.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`/api/v1/costing/price-scenarios/${priceScenarioId}/approve`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(from === undefined ? {} : { effectiveFrom: from.toISOString() }),
          ...(to === undefined ? {} : { effectiveTo: to.toISOString() }),
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ErrorBody | null;
        setError(
          typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR,
        );
        return;
      }
      const body = (await response.json().catch(() => null)) as ApproveBody | null;
      setSuccess(
        typeof body?.priceVersionId === "string"
          ? `Approved. Price version ${body.priceVersionId} is now effective.`
          : "Approved. The price version is now effective.",
      );
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: spacing[4],
        maxWidth: 640,
        marginTop: spacing[3],
      }}
    >
      {error !== null ? <Alert tone="danger">{error}</Alert> : null}
      {success !== null ? <Alert tone="success">{success}</Alert> : null}

      <TextField
        name="effectiveFrom"
        type="datetime-local"
        label="Effective from"
        value={effectiveFrom}
        onChange={(event) => setEffectiveFrom(event.target.value)}
        help="When this price becomes effective. Leave blank to start at approval time."
      />

      <TextField
        name="effectiveTo"
        type="datetime-local"
        label="Effective to"
        value={effectiveTo}
        onChange={(event) => setEffectiveTo(event.target.value)}
        help="When this price stops being effective (exclusive). Leave blank for open-ended."
      />

      <div>
        <Button type="submit" loading={busy} disabled={busy}>
          Approve and create price version
        </Button>
      </div>

      <p
        style={{
          margin: 0,
          fontSize: typography.fontSize.sm,
          color: color.text.muted,
        }}
      >
        Approving creates the effective price version for this scenario&apos;s scope. Two versions
        for the same scope may not overlap in time; an unapproved scenario can never become
        effective.
      </p>
    </form>
  );
}
