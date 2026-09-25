"use client";

import { Alert, Button, SectionCard, SelectField, TextareaField, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ChangeEvent, FormEvent } from "react";

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
 * (now), notes and optional evidence. The log is create + read only — there is
 * no update or delete command. When a photo or service report is chosen the
 * request is `multipart/form-data` and the bytes are stored through the
 * `DEC-132` port, linked to the equipment and referenced by the log
 * (`DEC-133`); with no file the log records metadata only. Mobile-first (§8.6):
 * large kind buttons, performed "now" by default.
 */
export function LogMaintenanceForm({ equipmentId }: { readonly equipmentId: string }) {
  const router = useRouter();
  const [kind, setKind] = useState<string>("service");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function onFileChange(event: ChangeEvent<HTMLInputElement>): void {
    setFile(event.target.files?.[0] ?? null);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const formElement = event.currentTarget;
    setError(null);
    setSuccess(null);

    setBusy(true);
    try {
      const form = new FormData();
      form.append("kind", kind);
      form.append("performedAt", new Date().toISOString());
      if (notes.trim().length > 0) {
        form.append("notes", notes.trim());
      }
      if (file !== null) {
        form.append("file", file);
      }
      const response = await fetch(`/api/v1/hms/equipment/${equipmentId}/maintenance-logs`, {
        method: "POST",
        credentials: "same-origin",
        body: form,
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      setSuccess(
        file === null
          ? "Maintenance logged. The log is a fact — it cannot be edited or deleted."
          : "Maintenance logged with evidence. The log is a fact — it cannot be edited or deleted.",
      );
      setNotes("");
      setFile(null);
      formElement.reset();
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
        <label style={{ display: "flex", flexDirection: "column", gap: spacing[1] }}>
          <span>Evidence (optional)</span>
          <input
            type="file"
            name="file"
            accept=".jpg,.jpeg,.png,.webp,.pdf,image/*,application/pdf"
            onChange={onFileChange}
            disabled={busy}
          />
          <span style={{ opacity: 0.8 }}>
            A photo of the work or a service report (JPEG, PNG, WebP or PDF, up to 10 MiB). The file
            is stored privately and linked to this maintenance log.
          </span>
        </label>

        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Log maintenance
          </Button>
        </div>
        <p style={{ margin: 0, opacity: 0.8 }}>
          Retention is not enforced and file contents are not scanned for malware; the type is
          checked against an allow-list only (DEC-133).
        </p>
      </form>
    </SectionCard>
  );
}
