"use client";

import { Alert, Button, SectionCard, SelectField, TextField, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not create the plan. Please try again.";

export interface PlanLocationOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface CreatePlanFormProps {
  readonly locations: readonly PlanLocationOption[];
  readonly defaultLocationId: string;
}

interface ErrorBody {
  readonly error?: string;
}

/**
 * Creates a production-plan header (08_UI_UX.md §8.3). A plan is a dated
 * container: `production_plan` has no line table and no status vocabulary
 * authority (open point (f)), so the status is free text and defaults to
 * "planned" server-side.
 */
export function CreatePlanForm({ locations, defaultLocationId }: CreatePlanFormProps) {
  const router = useRouter();
  const [locationId, setLocationId] = useState(defaultLocationId);
  const [productionDate, setProductionDate] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (locations.length === 0) {
    return (
      <SectionCard title="Create a plan" meta="dated container">
        <Alert tone="info">
          A plan needs a location. Register a location first, then create the plan here.
        </Alert>
      </SectionCard>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(productionDate)) {
      setError("Enter the production date as YYYY-MM-DD.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/v1/production/plans", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId,
          productionDate,
          ...(status.trim().length === 0 ? {} : { status: status.trim() }),
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ErrorBody | null;
        setError(
          typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR,
        );
        return;
      }
      setSuccess(`Plan for ${productionDate} created.`);
      setProductionDate("");
      setStatus("");
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Create a plan" meta="dated container">
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
          options={locations.map((location) => ({
            value: location.id,
            label: `${location.code} · ${location.name}`,
          }))}
        />

        <TextField
          name="productionDate"
          type="date"
          label="Production date"
          required
          value={productionDate}
          onChange={(event) => setProductionDate(event.target.value)}
          help="The day the plan covers. Batches link to the plan through their plan id."
        />

        <TextField
          name="status"
          label="Status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          placeholder="planned"
          help="Free text: production_plan has no status vocabulary authority yet (open point (f)), so the server stores it exactly as given."
        />

        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Create plan
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
