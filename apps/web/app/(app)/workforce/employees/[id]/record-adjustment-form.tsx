"use client";

import { Alert, Button, NumberField, SectionCard, TextField, color, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not record the adjustment. Please try again.";

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

/**
 * Records one hour correction against one shift assignment (`WF-004`,
 * `DEC-103`) through the existing
 * `POST /api/v1/workforce/shift-assignments/[id]/adjustments` route. The
 * adjustment is an append-only payroll-input fact: the latest recorded
 * adjustment wins in the worked-hours derivation, and no adjustment is ever
 * edited or deleted. `adjustedHours` is sent as a decimal string (the API
 * rejects a JSON number — money/hours are never floats).
 */
export function RecordAdjustmentForm({
  assignmentId,
  employeeName,
  shiftLabel,
}: {
  readonly assignmentId: string;
  readonly employeeName: string;
  readonly shiftLabel: string;
}) {
  const router = useRouter();
  const [adjustedHours, setAdjustedHours] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (adjustedHours.trim().length === 0 || reason.trim().length === 0) {
      setError("Enter the corrected hours and the reason.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(
        `/api/v1/workforce/shift-assignments/${assignmentId}/adjustments`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ adjustedHours: adjustedHours.trim(), reason: reason.trim() }),
        },
      );
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      setSuccess("Adjustment recorded. It overrides this assignment's hours in the derivation.");
      setAdjustedHours("");
      setReason("");
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard
      title="Adjust worked hours"
      meta={`append-only correction · ${employeeName} · ${shiftLabel}`}
    >
      <form
        onSubmit={submit}
        style={{ display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 640 }}
      >
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        {success !== null ? <Alert tone="success">{success}</Alert> : null}

        <NumberField
          name="adjustedHours"
          label="Corrected hours"
          unit="h"
          required
          step="0.01"
          min="0"
          value={adjustedHours}
          onChange={(event) => setAdjustedHours(event.target.value)}
          help="The hours this assignment contributes after the correction (at most two decimals)."
        />
        <TextField
          name="reason"
          label="Reason"
          required
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />

        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Record adjustment
          </Button>
        </div>
        <p style={{ margin: 0, color: color.ink.tertiary }}>
          Adjustments are facts: the latest one for an assignment wins and none can be edited or
          deleted (DEC-103). The worked-hours report applies the latest adjustment automatically.
        </p>
      </form>
    </SectionCard>
  );
}
