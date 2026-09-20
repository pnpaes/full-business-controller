"use client";

import { Alert, Button, SectionCard, TextField, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

import { CheckboxField, SelectField } from "../form-controls";

const FALLBACK_ERROR = "Could not open the count. Please try again.";

export interface OpenCountLocationOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
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
 * Opens a count (08_UI_UX.md §8.3): a location, the cutoff instant the expected
 * quantities are snapshotted at, and whether the count is blind (DEC-017). The
 * actor and organization are the server's. On success the operator is taken to
 * the count's entry screen.
 */
export function OpenCountForm({
  locations,
}: {
  readonly locations: readonly OpenCountLocationOption[];
}) {
  const router = useRouter();
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [cutoff, setCutoff] = useState("");
  const [blind, setBlind] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (locations.length === 0) {
    return (
      <SectionCard title="Open a count" meta="cycle count">
        <Alert tone="info">
          Opening a count needs a location. Register a location (and its storage areas) first.
        </Alert>
      </SectionCard>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    const cutoffIso = toIsoInstant(cutoff);
    if (cutoffIso === null) {
      setError("Enter a valid cutoff date and time.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/v1/counts", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId, cutoff: cutoffIso, blind }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      const body = (await response.json()) as { stockCountId?: string };
      if (typeof body.stockCountId === "string") {
        router.push(`/inventory/counts/${body.stockCountId}`);
      }
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Open a count" meta="cycle count">
      <form
        onSubmit={submit}
        style={{ display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 640 }}
      >
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}

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
          name="cutoff"
          type="datetime-local"
          label="Cutoff"
          required
          value={cutoff}
          onChange={(event) => setCutoff(event.target.value)}
          help="The instant the expected quantities are snapshotted at. Use the count session's end."
        />

        <CheckboxField
          name="blind"
          label="Blind count"
          checked={blind}
          onChange={(event) => setBlind(event.target.checked)}
          help="Blind counts hide the expected quantities until approval (DEC-017), for controlled or high-value stock."
        />

        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Open count
          </Button>
        </div>
        <p style={{ margin: 0, opacity: 0.8 }}>
          Opening snapshots the projected balance of every stocked item at this location; nothing is
          posted to the ledger until the variances are approved.
        </p>
      </form>
    </SectionCard>
  );
}
