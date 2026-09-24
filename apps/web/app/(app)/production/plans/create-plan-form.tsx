"use client";

import {
  Alert,
  Button,
  NumberField,
  SelectField,
  SectionCard,
  TextField,
  spacing,
} from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not create the plan. Please try again.";

export interface PlanLocationOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface PlanRecipeVersionOption {
  readonly id: string;
  readonly recipeCode: string;
  readonly recipeName: string;
  readonly versionNo: number;
}

export interface CreatePlanFormProps {
  readonly locations: readonly PlanLocationOption[];
  readonly recipeVersions: readonly PlanRecipeVersionOption[];
  readonly defaultLocationId: string;
}

interface ErrorBody {
  readonly error?: string;
}

interface DraftLine {
  readonly key: number;
  readonly recipeVersionId: string;
  readonly plannedQty: string;
}

/**
 * Creates a production plan (08_UI_UX.md §8.3) with optional lines (`DEC-125`).
 * Each line pairs an approved recipe version with the intended output quantity;
 * the status stays free text because `production_plan` has no status vocabulary
 * authority (open point (f)) and defaults to "planned" server-side.
 */
export function CreatePlanForm({
  locations,
  recipeVersions,
  defaultLocationId,
}: CreatePlanFormProps) {
  const router = useRouter();
  const [locationId, setLocationId] = useState(defaultLocationId);
  const [productionDate, setProductionDate] = useState("");
  const [status, setStatus] = useState("");
  const [lines, setLines] = useState<readonly DraftLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lineKey, setLineKey] = useState(0);

  if (locations.length === 0) {
    return (
      <SectionCard title="Create a plan" meta="dated plan">
        <Alert tone="info">
          A plan needs a location. Register a location first, then create the plan here.
        </Alert>
      </SectionCard>
    );
  }

  function addLine(): void {
    setLines((current) => [
      ...current,
      { key: lineKey, recipeVersionId: recipeVersions[0]?.id ?? "", plannedQty: "" },
    ]);
    setLineKey((key) => key + 1);
  }

  function updateLine(key: number, patch: Partial<DraftLine>): void {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function removeLine(key: number): void {
    setLines((current) => current.filter((line) => line.key !== key));
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(productionDate)) {
      setError("Enter the production date as YYYY-MM-DD.");
      return;
    }
    const payloadLines: { recipeVersionId: string; plannedQty: string }[] = [];
    for (const line of lines) {
      if (line.recipeVersionId.length === 0) {
        setError("Choose a recipe version for every plan line.");
        return;
      }
      const qty = line.plannedQty.trim();
      if (!/^\d+(?:\.\d+)?$/.test(qty) || Number(qty) <= 0) {
        setError("Enter a positive planned quantity (up to 6 decimals) for every plan line.");
        return;
      }
      payloadLines.push({ recipeVersionId: line.recipeVersionId, plannedQty: qty });
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
          ...(payloadLines.length === 0 ? {} : { lines: payloadLines }),
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ErrorBody | null;
        setError(
          typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR,
        );
        return;
      }
      setSuccess(`Plan for ${productionDate} created with ${payloadLines.length} line(s).`);
      setProductionDate("");
      setStatus("");
      setLines([]);
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Create a plan" meta="dated plan with optional lines">
      <form
        onSubmit={submit}
        style={{ display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 720 }}
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

        <div style={{ display: "flex", flexDirection: "column", gap: spacing[3] }}>
          <strong style={{ fontSize: 14 }}>Plan lines (optional)</strong>
          {lines.length === 0 ? (
            <p style={{ margin: 0, opacity: 0.8 }}>
              No lines yet — the plan is a dated container. Add a line to state which approved
              recipe version and how much output is intended.
            </p>
          ) : (
            lines.map((line) => (
              <div
                key={line.key}
                style={{
                  display: "grid",
                  gridTemplateColumns: "2fr 1fr auto",
                  gap: spacing[3],
                  alignItems: "end",
                }}
              >
                <SelectField
                  name={`line-recipe-${line.key}`}
                  label="Recipe version"
                  value={line.recipeVersionId}
                  onChange={(event) =>
                    updateLine(line.key, { recipeVersionId: event.target.value })
                  }
                  options={recipeVersions.map((option) => ({
                    value: option.id,
                    label: `${option.recipeCode} · ${option.recipeName} v${option.versionNo}`,
                  }))}
                />
                <NumberField
                  name={`line-qty-${line.key}`}
                  label="Planned quantity"
                  unit="output units"
                  min={0}
                  step="0.000001"
                  value={line.plannedQty}
                  onChange={(event) => updateLine(line.key, { plannedQty: event.target.value })}
                />
                <Button type="button" variant="secondary" onClick={() => removeLine(line.key)}>
                  Remove
                </Button>
              </div>
            ))
          )}
          <div>
            <Button
              type="button"
              variant="secondary"
              onClick={addLine}
              disabled={recipeVersions.length === 0}
            >
              Add line
            </Button>
          </div>
          {recipeVersions.length === 0 ? (
            <Alert tone="info">
              Plan lines need an <strong>approved</strong> recipe version. Register and approve a
              recipe (Recipes) first; the plan header can still be created without lines.
            </Alert>
          ) : null}
        </div>

        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Create plan
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
