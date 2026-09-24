"use client";

import { Alert, Button, SectionCard, SelectField, TextareaField, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not log the maintenance. Please try again.";

const KINDS = [
  { value: "service", label: "Service" },
  { value: "repair", label: "Repair" },
  { value: "inspection", label: "Inspection" },
] as const;

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

/**
 * Appends a maintenance-log fact (`HMS-006`, `DEC-092`): kind, performed-at
 * (now) and notes. The log is create + read only — there is no update or delete
 * command — and evidence is metadata-only (`DEC-085`/`DEC-090`): the form
 * records no file, and the screen says so where a photo would be expected.
 * Mobile-first (§8.6): large kind buttons, performed "now" by default.
 */
export function LogMaintenanceForm({ equipmentId }: { readonly equipmentId: string }) {
  const router = useRouter();
  const [kind, setKind] = useState<string>("service");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    setBusy(true);
    try {
      const response = await fetch(`/api/v1/hms/equipment/${equipmentId}/maintenance-logs`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          performedAt: new Date().toISOString(),
          notes: notes.trim().length > 0 ? notes.trim() : null,
          fileObjectId: null,
        }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      setSuccess("Maintenance logged. The log is a fact — it cannot be edited or deleted.");
      setNotes("");
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Log maintenance" meta="performed now · append-only fact">
      <form
        onSubmit={submit}
        style={{ display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 640 }}
      >
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        {success !== null ? <Alert tone="success">{success}</Alert> : null}

        <SelectField
          name="kind"
          label="Kind"
          required
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          options={KINDS.map((option) => ({ ...option }))}
        />
        <TextareaField
          name="notes"
          label="Notes (optional)"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          help="What was done, by whom, and any follow-up needed."
        />

        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Log maintenance
          </Button>
        </div>
        <p style={{ margin: 0, opacity: 0.8 }}>
          Attaching the service report or photo is not possible yet — the file store has no upload
          port (DEC-085, DEC-090). Keep the paper evidence until the storage slice lands.
        </p>
      </form>
    </SectionCard>
  );
}
