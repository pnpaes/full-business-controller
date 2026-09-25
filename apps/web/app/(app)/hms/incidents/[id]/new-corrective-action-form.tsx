"use client";

import {
  Alert,
  Button,
  DateField,
  SectionCard,
  SelectField,
  TextareaField,
  spacing,
} from "@aquarela/ui";
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
 * link is the path id; the action opens `open` and progresses on the corrective
 * actions screen. The owner is optional: options are the organization's active
 * users, loaded server-side and passed as props from the same candidate-assignee
 * read the register and incident pickers use; the `Unassigned` placeholder
 * leaves it empty.
 */
export function NewCorrectiveActionForm({
  incidentId,
  owners,
}: {
  readonly incidentId: string;
  readonly owners: readonly { readonly id: string; readonly label: string }[];
}) {
  const router = useRouter();
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [ownerId, setOwnerId] = useState("");
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
          ownerId: ownerId.length > 0 ? ownerId : null,
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
      setOwnerId("");
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Add corrective action" meta="opens open · owner optional">
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
        <SelectField
          name="ownerId"
          label="Owner"
          value={ownerId}
          onChange={(event) => setOwnerId(event.target.value)}
          placeholder="Unassigned"
          options={owners.map((owner) => ({ value: owner.id, label: owner.label }))}
          help="An owner must be an active user in the organization."
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
