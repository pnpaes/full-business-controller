"use client";

import { Alert, Button, TextField, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

import { CheckboxField, SelectField } from "./form-controls";

const FALLBACK_ERROR = "Could not register the storage area. Please try again.";

export interface StorageAreaLocationOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly kind: string;
}

export interface RegisterStorageAreaFormProps {
  readonly locations: readonly StorageAreaLocationOption[];
  readonly kinds: readonly string[];
}

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

/** `dry_store` → `Dry store`, for a readable kind option. */
function humanize(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Registers a storage area (DATA_DICTIONARY §4, 08_UI_UX.md §8.5). The transit
 * flag is only offered on a `virtual_transit` location; the server re-checks
 * that against the location row, so the disabled checkbox is a convenience, not
 * the control.
 */
export function RegisterStorageAreaForm({ locations, kinds }: RegisterStorageAreaFormProps) {
  const router = useRouter();
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState(kinds[0] ?? "dry_store");
  const [isTransit, setIsTransit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedLocation = locations.find((location) => location.id === locationId);
  const transitAllowed = selectedLocation?.kind === "virtual_transit";

  if (locations.length === 0) {
    return (
      <Alert tone="info">
        Registering a storage area needs a location. Seed the demo data or add a location first.
      </Alert>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const response = await fetch("/api/v1/inventory/storage-areas", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId,
          code,
          name,
          kind,
          isTransit: transitAllowed && isTransit,
        }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      setSuccess(`Registered ${code}.`);
      setCode("");
      setName("");
      setIsTransit(false);
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
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
        name="code"
        label="Code"
        required
        value={code}
        onChange={(event) => setCode(event.target.value)}
        placeholder="e.g. WALKIN"
        help="Unique within the location."
      />
      <TextField
        name="name"
        label="Name"
        required
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="e.g. Walk-in refrigerator"
      />
      <SelectField
        name="kind"
        label="Kind"
        required
        value={kind}
        onChange={(event) => setKind(event.target.value)}
        options={kinds.map((value) => ({ value, label: humanize(value) }))}
      />
      <CheckboxField
        name="isTransit"
        label="Logical transit bucket"
        checked={transitAllowed && isTransit}
        disabled={!transitAllowed}
        onChange={(event) => setIsTransit(event.target.checked)}
        help={
          transitAllowed
            ? "Marks this area as the in-transit holding point for transfers."
            : "Only available on a virtual transit location."
        }
      />
      <div>
        <Button type="submit" loading={busy} disabled={busy}>
          Register storage area
        </Button>
      </div>
    </form>
  );
}
