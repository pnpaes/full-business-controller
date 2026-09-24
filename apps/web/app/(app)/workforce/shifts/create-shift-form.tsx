"use client";

import {
  Alert,
  Button,
  NumberField,
  SectionCard,
  SelectField,
  TextField,
  spacing,
} from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not plan the shift. Please try again.";

export interface ShiftLocationOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface CreateShiftFormProps {
  /** Locations the caller may plan a shift at; already filtered to scope. */
  readonly locations: readonly ShiftLocationOption[];
  readonly defaultLocationId: string;
}

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

/** `datetime-local` value → ISO instant, or null when it is not a valid date. */
function toIsoInstant(local: string): string | null {
  if (local.trim().length === 0) {
    return null;
  }
  const parsed = new Date(local);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Plans one shift (`WF-002`, `DEC-037`) through `POST /api/v1/workforce/shifts`.
 * A new shift starts `open`; publishing and assignment are separate actions on
 * the roster. The window is entered as local date-times and sent as ISO
 * instants (the browser resolves the zone, the production batch form's
 * precedent).
 */
export function CreateShiftForm({ locations, defaultLocationId }: CreateShiftFormProps) {
  const router = useRouter();
  const [locationId, setLocationId] = useState(defaultLocationId);
  const [roleCode, setRoleCode] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [breakMinutes, setBreakMinutes] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (locations.length === 0) {
    return (
      <SectionCard title="Plan a shift" meta="owner / general manager / location manager / admin">
        <Alert tone="info">
          Planning a shift needs a location in your scope. Ask an owner or administrator for a
          location-scoped role, or register a location first.
        </Alert>
      </SectionCard>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    const start = toIsoInstant(startsAt);
    const end = toIsoInstant(endsAt);
    if (locationId.length === 0) {
      setError("Choose a location.");
      return;
    }
    if (start === null || end === null) {
      setError("Choose the start and end times.");
      return;
    }
    if (Date.parse(end) <= Date.parse(start)) {
      setError("The end time must be after the start time.");
      return;
    }
    const breakValue = Number.parseInt(breakMinutes, 10);
    if (!Number.isInteger(breakValue) || breakValue < 0) {
      setError("Break must be a whole number of minutes, zero or more.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/v1/workforce/shifts", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId,
          roleCode: roleCode.trim().length === 0 ? null : roleCode.trim(),
          startsAt: start,
          endsAt: end,
          breakMinutes: breakValue,
        }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      setSuccess("Shift planned (open). Publish it to make it assignable.");
      setStartsAt("");
      setEndsAt("");
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Plan a shift" meta="starts open; publish to make it assignable">
      <form
        onSubmit={submit}
        style={{ display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 640 }}
      >
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        {success !== null ? <Alert tone="success">{success}</Alert> : null}

        <SelectField
          name="locationId"
          label="Location"
          required
          value={locationId}
          onChange={(event) => setLocationId(event.target.value)}
          options={locations.map((location) => ({
            value: location.id,
            label: `${location.code} · ${location.name}`,
          }))}
        />
        <TextField
          name="roleCode"
          label="Role"
          value={roleCode}
          onChange={(event) => setRoleCode(event.target.value)}
          help="Optional free text. When set, only employees with this exact role can be assigned (WF-003)."
        />
        <TextField
          name="startsAt"
          label="Starts"
          type="datetime-local"
          required
          value={startsAt}
          onChange={(event) => setStartsAt(event.target.value)}
        />
        <TextField
          name="endsAt"
          label="Ends"
          type="datetime-local"
          required
          value={endsAt}
          onChange={(event) => setEndsAt(event.target.value)}
        />
        <NumberField
          name="breakMinutes"
          label="Unpaid break"
          unit="min"
          min={0}
          step={1}
          inputMode="numeric"
          value={breakMinutes}
          onChange={(event) => setBreakMinutes(event.target.value)}
        />

        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Plan shift
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
