"use client";

import {
  Alert,
  Button,
  NumberField,
  SectionCard,
  SelectField,
  TextField,
  spacing,
} from "@aquarela/ui";
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

/** `DEC-125`: a plan line a batch can be created from. */
export interface BatchPlanLineOption {
  readonly id: string;
  readonly planId: string;
  readonly recipeVersionId: string;
  readonly label: string;
  readonly plannedQty: string;
}

export interface CreateBatchFormProps {
  readonly recipeVersions: readonly RecipeVersionOption[];
  readonly locations: readonly BatchLocationOption[];
  readonly areas: readonly BatchAreaOption[];
  readonly planLines: readonly BatchPlanLineOption[];
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
  planLines,
  defaultLocationId,
}: CreateBatchFormProps) {
  const router = useRouter();
  const [recipeVersionId, setRecipeVersionId] = useState(recipeVersions[0]?.id ?? "");
  const [locationId, setLocationId] = useState(defaultLocationId);
  const [destinationStorageAreaId, setDestinationStorageAreaId] = useState("");
  const [workstation, setWorkstation] = useState("");
  const [plannedStart, setPlannedStart] = useState("");
  const [planLineId, setPlanLineId] = useState("");
  const [plannedQty, setPlannedQty] = useState("");
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
    const qty = plannedQty.trim();
    if (qty.length > 0 && (!/^\d+(?:\.\d+)?$/.test(qty) || Number(qty) <= 0)) {
      setError("Enter a positive planned quantity (up to 6 decimals), or leave it blank.");
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
          ...(planLineId.length === 0 ? {} : { planLineId }),
          ...(qty.length === 0 ? {} : { plannedQty: qty }),
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
          name="planLineId"
          label="Create from a plan line"
          placeholder="None — plan from scratch"
          value={planLineId}
          onChange={(event) => {
            const id = event.target.value;
            setPlanLineId(id);
            const line = planLines.find((option) => option.id === id);
            if (line !== undefined) {
              setRecipeVersionId(line.recipeVersionId);
              setPlannedQty(line.plannedQty);
            }
          }}
          options={planLines.map((option) => ({ value: option.id, label: option.label }))}
          help="Optional. Choosing a plan line fixes the recipe version and its intended quantity."
        />

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
          help="Only approved versions can be produced. The planned inputs and output are taken from this version."
        />

        <NumberField
          name="plannedQty"
          label="Planned quantity"
          unit="output units"
          min={0}
          step="0.000001"
          value={plannedQty}
          onChange={(event) => setPlannedQty(event.target.value)}
          help="Optional. When set, the planned inputs and output are scaled to this quantity (up to 6 decimal places). Leave blank for a single recipe batch."
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
          help="Outputs are received here on completion, so the batch needs a destination to be completed."
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
