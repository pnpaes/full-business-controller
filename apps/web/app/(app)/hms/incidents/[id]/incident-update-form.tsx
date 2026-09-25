"use client";

import {
  Alert,
  Button,
  DateField,
  SectionCard,
  SelectField,
  TextareaField,
  TextField,
  color,
  spacing,
} from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not update the incident. Please try again.";

const STATUSES = [
  { value: "open", label: "Open" },
  { value: "investigating", label: "Investigating" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
] as const;

const SEVERITIES = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
] as const;

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

/**
 * The audited incident update (`DEC-090`, `DEC-095`): status (closing included),
 * severity, owner, title, description and due date. The close instant is derived
 * by the command from `status`, so the form sends the status alone. Owner
 * options are the organization's active users, from the same candidate-assignee
 * read the task picker uses; the field is optional and choosing "Unassigned"
 * clears the owner.
 */
export function IncidentUpdateForm({
  incidentId,
  owners,
  current,
}: {
  readonly incidentId: string;
  readonly owners: readonly { readonly id: string; readonly label: string }[];
  readonly current: {
    readonly status: string;
    readonly severity: string;
    readonly title: string;
    readonly description: string | null;
    readonly dueDate: string | null;
    readonly ownerId: string | null;
  };
}) {
  const router = useRouter();
  const [status, setStatus] = useState(current.status);
  const [severity, setSeverity] = useState(current.severity);
  const [title, setTitle] = useState(current.title);
  const [description, setDescription] = useState(current.description ?? "");
  const [dueDate, setDueDate] = useState(current.dueDate ?? "");
  const [ownerId, setOwnerId] = useState(current.ownerId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (title.trim().length === 0) {
      setError("The title cannot be empty.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`/api/v1/hms/incidents/${incidentId}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          severity,
          title: title.trim(),
          description: description.trim().length > 0 ? description.trim() : null,
          dueDate: dueDate.trim().length > 0 ? dueDate.trim() : null,
          // Only send the owner when it changed, so an unrelated edit does not
          // re-validate (or clear) an existing owner.
          ...(ownerId === (current.ownerId ?? "")
            ? {}
            : { ownerId: ownerId.length > 0 ? ownerId : null }),
        }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      setSuccess(
        status === "closed"
          ? "Incident closed. Reopen it from the status list if it turns out not to be resolved."
          : "Incident updated. Every change is audit-logged.",
      );
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Update or close" meta="audited · owner assignable">
      <form
        onSubmit={submit}
        style={{ display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 640 }}
      >
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        {success !== null ? <Alert tone="success">{success}</Alert> : null}

        <SelectField
          name="status"
          label="Status"
          required
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          options={STATUSES.map((option) => ({ ...option }))}
          help="Closed sets the close instant server-side; reopening clears it."
        />
        <SelectField
          name="severity"
          label="Severity"
          required
          value={severity}
          onChange={(event) => setSeverity(event.target.value)}
          options={SEVERITIES.map((option) => ({ ...option }))}
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
        <TextField
          name="title"
          label="Title"
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <TextareaField
          name="description"
          label="Description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <DateField
          name="dueDate"
          label="Due date"
          value={dueDate}
          onChange={(event) => setDueDate(event.target.value)}
          help="Leave empty to clear the due date."
        />

        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Save changes
          </Button>
        </div>
        <p style={{ margin: 0, color: color.ink.tertiary }}>
          The owner list is the organization&apos;s active users. Choose <em>Unassigned</em> to
          clear the owner.
        </p>
      </form>
    </SectionCard>
  );
}
