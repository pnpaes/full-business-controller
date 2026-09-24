"use client";

import { Alert, Button, DateField, SelectField, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not assign the recipe. Please try again.";

export interface AssignRecipeFormProps {
  readonly productVariantId: string;
  readonly locations: readonly {
    readonly id: string;
    readonly code: string;
    readonly name: string;
  }[];
  readonly recipeVersions: readonly {
    readonly id: string;
    readonly recipeCode: string;
    readonly recipeName: string;
    readonly versionNo: number;
  }[];
}

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

/**
 * Assigns an approved recipe version to the variant at a location for an
 * effective window (`assignRecipeToVariant`, `DEC-128`). Only approved versions
 * are offered; the server rejects a draft and an overlapping window, so those
 * never reach the database. The window uses native date fields.
 */
export function AssignRecipeForm({
  productVariantId,
  locations,
  recipeVersions,
}: AssignRecipeFormProps) {
  const router = useRouter();
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [recipeVersionId, setRecipeVersionId] = useState(recipeVersions[0]?.id ?? "");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveTo, setEffectiveTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (locationId === "") {
      setError("Choose a location.");
      document.getElementById("field-locationId")?.focus();
      return;
    }
    if (recipeVersionId === "") {
      setError("Choose an approved recipe version.");
      document.getElementById("field-recipeVersionId")?.focus();
      return;
    }
    if (effectiveFrom === "") {
      setError("Enter the effective-from date.");
      document.getElementById("field-effectiveFrom")?.focus();
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(
        `/api/v1/products/variants/${productVariantId}/recipe-assignment`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            locationId,
            recipeVersionId,
            effectiveFrom,
            ...(effectiveTo === "" ? {} : { effectiveTo }),
          }),
        },
      );
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      setSuccess("Recipe assigned.");
      setEffectiveFrom("");
      setEffectiveTo("");
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  const noVersions = recipeVersions.length === 0;

  return (
    <form
      onSubmit={submit}
      style={{ display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 640 }}
    >
      {error !== null ? <Alert tone="danger">{error}</Alert> : null}
      {success !== null ? <Alert tone="success">{success}</Alert> : null}
      {noVersions ? (
        <Alert tone="info">
          No approved recipe versions exist yet. Approve a recipe version before assigning it.
        </Alert>
      ) : null}

      <SelectField
        name="locationId"
        label="Location"
        required
        value={locationId}
        onChange={(event) => setLocationId(event.target.value)}
        placeholder="Select a location"
        options={locations.map((location) => ({
          value: location.id,
          label: `${location.code} — ${location.name}`,
        }))}
      />
      <SelectField
        name="recipeVersionId"
        label="Approved recipe version"
        required
        value={recipeVersionId}
        onChange={(event) => setRecipeVersionId(event.target.value)}
        placeholder="Select an approved version"
        disabled={noVersions}
        options={recipeVersions.map((version) => ({
          value: version.id,
          label: `${version.recipeCode} v${version.versionNo} — ${version.recipeName}`,
        }))}
      />
      <DateField
        name="effectiveFrom"
        label="Effective from"
        required
        value={effectiveFrom}
        onChange={(event) => setEffectiveFrom(event.target.value)}
      />
      <DateField
        name="effectiveTo"
        label="Effective to (optional)"
        value={effectiveTo}
        onChange={(event) => setEffectiveTo(event.target.value)}
        help="Leave blank for an open-ended assignment."
      />
      <div>
        <Button type="submit" loading={busy} disabled={busy || noVersions}>
          Assign recipe
        </Button>
      </div>
    </form>
  );
}
