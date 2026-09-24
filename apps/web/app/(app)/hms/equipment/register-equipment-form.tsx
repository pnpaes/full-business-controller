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

const FALLBACK_ERROR = "Could not register the equipment. Please try again.";

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

/**
 * Registers a piece of equipment (`HMS-006`, `DEC-092`, `DEC-097`): the
 * `(organization, code)` register key, description, location and optional
 * dates. The code is immutable afterwards, so it is asked for explicitly here.
 */
export function RegisterEquipmentForm({
  locations,
}: {
  readonly locations: readonly { readonly id: string; readonly label: string }[];
}) {
  const router = useRouter();
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState("");
  const [serialNo, setSerialNo] = useState("");
  const [installedAt, setInstalledAt] = useState("");
  const [warrantyUntil, setWarrantyUntil] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (locations.length === 0) {
    return (
      <SectionCard title="Register equipment" meta="new">
        <Alert tone="info">
          There is no location in your scope yet, so equipment cannot be registered.
        </Alert>
      </SectionCard>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (
      locationId.length === 0 ||
      code.trim().length === 0 ||
      name.trim().length === 0 ||
      kind.trim().length === 0
    ) {
      setError("Location, code, name and kind are required.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/v1/hms/equipment", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId,
          code: code.trim(),
          name: name.trim(),
          kind: kind.trim(),
          serialNo: serialNo.trim().length > 0 ? serialNo.trim() : null,
          installedAt: installedAt.trim().length > 0 ? installedAt.trim() : null,
          warrantyUntil: warrantyUntil.trim().length > 0 ? warrantyUntil.trim() : null,
        }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      setSuccess("Equipment registered. Open it to log maintenance.");
      setCode("");
      setName("");
      setKind("");
      setSerialNo("");
      setInstalledAt("");
      setWarrantyUntil("");
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Register equipment" meta="new · code is permanent">
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
        <TextField
          name="code"
          label="Code"
          required
          value={code}
          onChange={(event) => setCode(event.target.value)}
          help="The register key — it cannot be changed after registration."
        />
        <TextField
          name="name"
          label="Name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <TextField
          name="kind"
          label="Kind"
          required
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          help="Free text (DEC-092 names no vocabulary) — e.g. oven, dishwasher, cold room."
        />
        <TextField
          name="serialNo"
          label="Serial number (optional)"
          value={serialNo}
          onChange={(event) => setSerialNo(event.target.value)}
        />
        <DateField
          name="installedAt"
          label="Installed at (optional)"
          value={installedAt}
          onChange={(event) => setInstalledAt(event.target.value)}
        />
        <DateField
          name="warrantyUntil"
          label="Warranty until (optional)"
          value={warrantyUntil}
          onChange={(event) => setWarrantyUntil(event.target.value)}
        />

        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Register equipment
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
