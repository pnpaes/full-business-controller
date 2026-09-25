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
 * severity, title, description and due date. The close instant is derived by the
 * command from `status`, so the form sends the status alone. Owner assignment is
 * not offered — no HMS-scoped user-list read is wired for this screen, so a
 * picker would be invented access; the gap is recorded, not faked.
 */
export function IncidentUpdateForm({
  incidentId,
  current,
}: {
  readonly incidentId: string;
  readonly current: {
    readonly status: string;
    readonly severity: string;
    readonly title: string;
    readonly description: string | null;
    readonly dueDate: string | null;
  };
}) {
  const router = useRouter();
  const [status, setStatus] = useState(current.status);
  const [severity, setSeverity] = useState(current.severity);
  const [title, setTitle] = useState(current.title);
  const [description, setDescription] = useState(current.description ?? "");
  const [dueDate, setDueDate] = useState(current.dueDate ?? "");
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
    <SectionCard title="Update or close" meta="audited · owner assignment not offered (see note)">
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
          Owner assignment is not offered here: no HMS-scoped user-list read is wired for this
          screen. Assign owners through the API until an HMS-scoped user list lands.
        </p>
      </form>
    </SectionCard>
  );
}
