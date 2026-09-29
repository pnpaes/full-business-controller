"use client";

import { Button, FormModal, NumberField, SelectField, TextField } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not plan the shift. Please try again.";

export interface ShiftLocationOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

/** One catalogue position the shift may be staffed for (`DEC-151`). */
export interface ShiftPositionOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface CreateShiftFormProps {
  /** Locations the caller may plan a shift at; already filtered to scope. */
  readonly locations: readonly ShiftLocationOption[];
  /** The position catalogue (`DEC-151`); a position is required to publish. */
  readonly positions: readonly ShiftPositionOption[];
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
 * The roster's header primary action (`WF-002`, `DEC-037`): "Plan shift" opens
 * the create form in a `FormModal` (the register recipe: a header carries one
 * primary button and no inline form). A new shift starts `open`; publishing and
 * assignment are separate roster actions. The window is entered as local
 * date-times and sent as ISO instants (the browser resolves the zone).
 */
export function CreateShiftForm({ locations, positions, defaultLocationId }: CreateShiftFormProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [locationId, setLocationId] = useState(defaultLocationId);
  const [positionId, setPositionId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [breakMinutes, setBreakMinutes] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
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
          positionId: positionId.length === 0 ? null : positionId,
          startsAt: start,
          endsAt: end,
          breakMinutes: breakValue,
        }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      setOpen(false);
      setPositionId("");
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
    <>
      <Button
        type="button"
        variant="primary"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        Plan shift
      </Button>
      <FormModal
        title="Plan a shift"
        description="A new shift starts open; publish it on the roster to make it assignable (WF-002)."
        open={open}
        onClose={() => setOpen(false)}
        onSubmit={submit}
        busy={busy}
        submitLabel="Plan shift"
        error={error}
      >
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
        <SelectField
          name="positionId"
          label="Position"
          value={positionId}
          onChange={(event) => setPositionId(event.target.value)}
          options={[
            { value: "", label: "Any position" },
            ...positions.map((position) => ({ value: position.id, label: position.name })),
          ]}
          help="The position this shift is staffed for (DEC-151). Only employees who hold it can take the shift; a position is required before publishing."
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
      </FormModal>
    </>
  );
}
