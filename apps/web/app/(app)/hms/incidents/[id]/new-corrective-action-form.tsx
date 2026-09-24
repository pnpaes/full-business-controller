"use client";

import { Alert, Button, DateField, SectionCard, TextareaField, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not add the corrective action. Please try again.";

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

/**
 * Adds a corrective action to the incident (`HMS-004`, `DEC-090`). The incident
 * link is the path id; the action opens `open` with no owner (the same
 * no-user-list gap as the incident form) and progresses on the corrective
 * actions screen.
 */
export function NewCorrectiveActionForm({ incidentId }: { readonly incidentId: string }) {
  const router = useRouter();
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (description.trim().length === 0) {
      setError("Describe the action to take.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`/api/v1/hms/incidents/${incidentId}/corrective-actions`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: description.trim(),
          ownerId: null,
          dueDate: dueDate.trim().length > 0 ? dueDate.trim() : null,
        }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      setSuccess("Corrective action added. Progress it from the corrective actions screen.");
      setDescription("");
      setDueDate("");
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Add corrective action" meta="opens open · no owner yet">
      <form
        onSubmit={submit}
        style={{ display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 640 }}
      >
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        {success !== null ? <Alert tone="success">{success}</Alert> : null}

        <TextareaField
          name="description"
          label="What must be done"
          required
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <DateField
          name="dueDate"
          label="Due date (optional)"
          value={dueDate}
          onChange={(event) => setDueDate(event.target.value)}
        />

        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Add action
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
