"use client";

import { Alert, Button, SectionCard, SelectField, TextField, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not plan the batch. Please try again.";

export interface RecipeVersionOption {
  readonly id: string;
  readonly recipeCode: string;
  readonly recipeName: string;
  readonly versionNo: number;
}

export interface BatchLocationOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface BatchAreaOption {
  readonly id: string;
  readonly locationId: string;
  readonly code: string;
  readonly name: string;
}

export interface CreateBatchFormProps {
  readonly recipeVersions: readonly RecipeVersionOption[];
  readonly locations: readonly BatchLocationOption[];
  readonly areas: readonly BatchAreaOption[];
  readonly defaultLocationId: string;
}

interface ErrorBody {
  readonly error?: string;
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
 * Plans a batch (08_UI_UX.md §8.3): the **approved** recipe version, the
 * location, the destination storage area for the outputs and an optional
 * planned start. The actor and organization are the server's. The planned
 * snapshot (inputs/output) is derived server-side from the recipe version — the
 * form never invents quantities.
 */
export function CreateBatchForm({
  recipeVersions,
  locations,
  areas,
  defaultLocationId,
}: CreateBatchFormProps) {
  const router = useRouter();
  const [recipeVersionId, setRecipeVersionId] = useState(recipeVersions[0]?.id ?? "");
  const [locationId, setLocationId] = useState(defaultLocationId);
  const [destinationStorageAreaId, setDestinationStorageAreaId] = useState("");
  const [workstation, setWorkstation] = useState("");
  const [plannedStart, setPlannedStart] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const visibleAreas = useMemo(
    () => areas.filter((area) => area.locationId === locationId),
    [areas, locationId],
  );

  if (recipeVersions.length === 0 || locations.length === 0) {
    return (
      <SectionCard title="Plan a batch" meta="against an approved recipe">
        <Alert tone="info">
          Planning needs at least one location and one <strong>approved</strong> recipe version.
          Register a recipe and approve a version (Recipes), then plan a batch here. The demo seed
          (`seed-recipes`) creates an approved version.
        </Alert>
      </SectionCard>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    const plannedStartIso = toIsoInstant(plannedStart);
    if (plannedStart.trim().length > 0 && plannedStartIso === null) {
      setError("Enter a valid planned start date and time, or leave it blank.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/v1/production/batches", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId,
          recipeVersionId,
          ...(destinationStorageAreaId.length === 0 ? {} : { destinationStorageAreaId }),
          ...(workstation.trim().length === 0 ? {} : { workstation: workstation.trim() }),
          ...(plannedStartIso === null ? {} : { plannedStart: plannedStartIso }),
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ErrorBody | null;
        setError(
          typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR,
        );
        return;
      }
      const body = (await response.json()) as { productionBatchId?: string };
      if (typeof body.productionBatchId === "string") {
        router.push(`/production/batches/${body.productionBatchId}`);
      }
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Plan a batch" meta="against an approved recipe version">
      <form
        onSubmit={submit}
        style={{ display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 640 }}
      >
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}

        <SelectField
          name="recipeVersionId"
          label="Recipe version"
          required
          value={recipeVersionId}
          onChange={(event) => setRecipeVersionId(event.target.value)}
          options={recipeVersions.map((option) => ({
            value: option.id,
            label: `${option.recipeCode} · ${option.recipeName} v${option.versionNo}`,
          }))}
          help="Only approved versions can be produced (PROD-001). The planned snapshot is derived from this version."
        />

        <SelectField
          name="locationId"
          label="Location"
          required
          value={locationId}
          onChange={(event) => {
            setLocationId(event.target.value);
            setDestinationStorageAreaId("");
          }}
          options={locations.map((location) => ({
            value: location.id,
            label: `${location.code} · ${location.name}`,
          }))}
        />

        <SelectField
          name="destinationStorageAreaId"
          label="Destination storage area"
          placeholder={
            visibleAreas.length === 0
              ? "No storage area at this location"
              : "Select where the output is stored"
          }
          value={destinationStorageAreaId}
          onChange={(event) => setDestinationStorageAreaId(event.target.value)}
          options={visibleAreas.map((area) => ({
            value: area.id,
            label: `${area.code} · ${area.name}`,
          }))}
          help="Outputs are received here on completion. There is no WIP area: the batch must have a destination to be completed (open point (e))."
        />

        <TextField
          name="workstation"
          label="Workstation"
          value={workstation}
          onChange={(event) => setWorkstation(event.target.value)}
          placeholder="e.g. bar, kitchen"
          help="Optional. Useful when a location runs several production stations."
        />

        <TextField
          name="plannedStart"
          type="datetime-local"
          label="Planned start"
          value={plannedStart}
          onChange={(event) => setPlannedStart(event.target.value)}
          help="Optional. Also the effective date used to resolve unit conversions when the plan is snapshotted."
        />

        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Plan batch
          </Button>
        </div>
        <p style={{ margin: 0, opacity: 0.8 }}>
          Planning writes the batch header and snapshots the recipe's planned output; no movement is
          posted until the batch is completed.
        </p>
      </form>
    </SectionCard>
  );
}
