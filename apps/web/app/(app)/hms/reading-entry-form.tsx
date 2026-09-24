"use client";

import {
  Alert,
  Button,
  NumberField,
  SectionCard,
  SelectField,
  TextareaField,
  spacing,
} from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not record the reading. Please try again.";

export interface ReadingPointOption {
  readonly id: string;
  readonly label: string;
  readonly unit: string;
  readonly targetMin: string;
  readonly targetMax: string;
}

interface RecordReadingResponse {
  readonly inRange?: boolean;
  readonly value?: string;
}

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

/**
 * Fast reading entry (§8.6): the point defaults to the first active one, the
 * value field opens a decimal keyboard, and after a successful record the form
 * keeps the point and notes context, clears the value and refocuses it so a
 * round of readings can be keyed in rapid succession.
 *
 * The measured instant is the submission time (the honest default for a walk
 * with a phone); the unit and the in-range verdict are derived server-side from
 * the point (`DEC-089` — the body cannot set them). Readings are append-only:
 * this form only appends, it never edits.
 */
export function ReadingEntryForm({ points }: { readonly points: readonly ReadingPointOption[] }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pointId, setPointId] = useState(points[0]?.id ?? "");
  const [value, setValue] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const point = points.find((candidate) => candidate.id === pointId) ?? points[0];

  if (points.length === 0) {
    return (
      <SectionCard title="Record a reading" meta="fast entry">
        <Alert tone="info">
          There is no active monitoring point in your location scope yet. Register the first point
          in the "Register a monitoring point" form below (owner, general manager, location manager,
          kitchen or front of house).
        </Alert>
      </SectionCard>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    const trimmed = value.trim();
    if (point === undefined || trimmed.length === 0) {
      setError("Enter the measured value.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`/api/v1/hms/monitoring-points/${point.id}/readings`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          value: trimmed,
          measuredAt: new Date().toISOString(),
          notes: notes.trim().length > 0 ? notes.trim() : null,
        }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      const body = (await response.json().catch(() => null)) as RecordReadingResponse | null;
      setSuccess(
        `Recorded ${body?.value ?? trimmed} ${point.unit} — ${
          body?.inRange === false ? "out of range" : "in range"
        }. Ready for the next reading.`,
      );
      setValue("");
      router.refresh();
      formRef.current?.querySelector<HTMLInputElement>('input[name="value"]')?.focus();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Record a reading" meta="fast entry · measured now">
      <form
        ref={formRef}
        onSubmit={submit}
        style={{ display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 640 }}
      >
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        {success !== null ? <Alert tone="success">{success}</Alert> : null}

        <SelectField
          name="monitoringPointId"
          label="Monitoring point"
          required
          value={pointId === "" ? (points[0]?.id ?? "") : pointId}
          onChange={(event) => setPointId(event.target.value)}
          options={points.map((candidate) => ({ value: candidate.id, label: candidate.label }))}
          help={`Target range ${point?.targetMin ?? "—"} – ${point?.targetMax ?? "—"} ${
            point?.unit ?? ""
          }.`}
        />

        <NumberField
          name="value"
          label="Measured value"
          required
          unit={point?.unit ?? ""}
          step="any"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          help="The measured instant is the submission time; the unit and in-range verdict come from the point."
        />

        <TextareaField
          name="notes"
          label="Notes (optional)"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          help="The only field that can be amended later — the value itself is immutable (DEC-089)."
        />

        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Record reading
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
