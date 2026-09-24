"use client";

import {
  Alert,
  Button,
  DateField,
  SectionCard,
  SelectField,
  TextField,
  spacing,
} from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not create the task. Please try again.";

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

/**
 * Creates a task (`DEC-122`). The type and priority are free text — the spec
 * defines no vocabulary for either (`DEC-101`) — so both are text fields, with
 * the priority pre-filled `normal`. The task always opens with status `open`; an
 * optional due date and assignee may be set now, and the assignee list is the
 * active-user read that also backs the row pickers.
 */
export function NewTaskForm({
  users,
}: {
  readonly users: readonly { readonly id: string; readonly label: string }[];
}) {
  const router = useRouter();
  const [type, setType] = useState("");
  const [priority, setPriority] = useState("normal");
  const [dueDate, setDueDate] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (type.trim().length === 0 || priority.trim().length === 0) {
      setError("Give the task a type and a priority.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/v1/tasks", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: type.trim(),
          priority: priority.trim(),
          dueDate: dueDate.trim().length > 0 ? dueDate.trim() : null,
          ownerId: ownerId.length > 0 ? ownerId : null,
        }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      setSuccess("Task created. Use the row controls to assign or progress it.");
      setType("");
      setPriority("normal");
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
    <SectionCard title="Create a task" meta="new · opens as Open">
      <form
        onSubmit={submit}
        style={{ display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 640 }}
      >
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        {success !== null ? <Alert tone="success">{success}</Alert> : null}

        <TextField
          name="type"
          label="Type"
          required
          value={type}
          onChange={(event) => setType(event.target.value)}
          help="Free text — the spec defines no task-type vocabulary yet (DEC-101)."
        />
        <TextField
          name="priority"
          label="Priority"
          required
          value={priority}
          onChange={(event) => setPriority(event.target.value)}
          help="Free text — the spec defines no task-priority vocabulary yet (DEC-101)."
        />
        <DateField
          name="dueDate"
          label="Due date (optional)"
          value={dueDate}
          onChange={(event) => setDueDate(event.target.value)}
        />
        <SelectField
          name="ownerId"
          label="Assignee (optional)"
          value={ownerId}
          onChange={(event) => setOwnerId(event.target.value)}
          options={[
            { value: "", label: "Unassigned" },
            ...users.map((user) => ({ value: user.id, label: user.label })),
          ]}
        />

        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Create task
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
