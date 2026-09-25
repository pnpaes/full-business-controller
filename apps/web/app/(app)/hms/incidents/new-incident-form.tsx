"use client";

import {
  Alert,
  Button,
  DateField,
  SectionCard,
  SelectField,
  TextareaField,
  TextField,
  spacing,
} from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not raise the incident. Please try again.";

const CATEGORIES = [
  { value: "work_accident", label: "Work accident" },
  { value: "electrical", label: "Electrical" },
  { value: "equipment", label: "Equipment" },
  { value: "fire", label: "Fire" },
  { value: "near_miss", label: "Near miss" },
  { value: "other", label: "Other" },
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
 * Raises an incident (`HMS-003`, `DEC-090`): where, what, when, severity and the
 * personal-data flag. The reporter is the session actor and the initial status
 * is `open`, both filled server-side. Evidence is attached after the incident
 * exists, from its detail page (`DEC-134`), not here.
 */
export function NewIncidentForm({
  locations,
}: {
  readonly locations: readonly { readonly id: string; readonly label: string }[];
}) {
  const router = useRouter();
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [category, setCategory] = useState<string>("other");
  const [severity, setSeverity] = useState<string>("low");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [involvesPersonalData, setInvolvesPersonalData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (locations.length === 0) {
    return (
      <SectionCard title="Raise an incident" meta="new">
        <Alert tone="info">
          There is no location in your scope yet, so an incident cannot be raised. Ask an owner or
          administrator for a location-scoped role.
        </Alert>
      </SectionCard>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (locationId.length === 0 || title.trim().length === 0) {
      setError("Choose a location and give the incident a title.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/v1/hms/incidents", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId,
          category,
          severity,
          occurredAt: new Date().toISOString(),
          reportedAt: null,
          ownerId: null,
          title: title.trim(),
          description: description.trim().length > 0 ? description.trim() : null,
          dueDate: dueDate.trim().length > 0 ? dueDate.trim() : null,
          involvesPersonalData,
        }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      setSuccess("Incident raised. Open it from the list to assign an owner or add actions.");
      setTitle("");
      setDescription("");
      setDueDate("");
      setInvolvesPersonalData(false);
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Raise an incident" meta="new · reported as you">
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
          options={locations.map((location) => ({ value: location.id, label: location.label }))}
        />
        <SelectField
          name="category"
          label="Category"
          required
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          options={CATEGORIES.map((option) => ({ ...option }))}
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
          label="Description (optional)"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <DateField
          name="dueDate"
          label="Due date (optional)"
          value={dueDate}
          onChange={(event) => setDueDate(event.target.value)}
        />
        <label style={{ display: "flex", gap: spacing[2], alignItems: "center" }}>
          <input
            type="checkbox"
            name="involvesPersonalData"
            checked={involvesPersonalData}
            onChange={(event) => setInvolvesPersonalData(event.target.checked)}
            style={{ width: 20, height: 20 }}
          />
          Involves personal data
        </label>

        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Raise incident
          </Button>
        </div>
        <p style={{ margin: 0, opacity: 0.8 }}>
          The incident opens with status <code>open</code> and no owner. Open it from the list to
          attach a photo or report — evidence storage is wired (DEC-134) — and to assign an owner.
        </p>
      </form>
    </SectionCard>
  );
}
