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
import { useState } from "react";
import type { FormEvent } from "react";

import {
  CHECK_FREQUENCIES,
  MONITORING_POINT_KINDS,
  checkFrequencyLabel,
  monitoringPointKindLabel,
} from "./hms-labels";

const FALLBACK_ERROR = "Could not register the monitoring point. Please try again.";

export interface RegisterLocationOption {
  readonly id: string;
  readonly label: string;
}

export interface RegisterStorageAreaOption {
  readonly id: string;
  readonly locationId: string;
  readonly label: string;
}

interface RegisterPointResponse {
  readonly code?: string;
}

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  if (response.status === 403) {
    return "That location is outside your location scope, so you cannot register a point there.";
  }
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

const EMPTY_FORM = {
  code: "",
  name: "",
  kind: MONITORING_POINT_KINDS[0] ?? "",
  unit: "",
  targetMin: "",
  targetMax: "",
  checkFrequency: CHECK_FREQUENCIES[0] ?? "",
  locationId: "",
  storageAreaId: "",
};

/**
 * Registers a monitoring point (`HMS-002`): the form the recording flow was
 * missing. Posts to `POST /api/v1/hms/monitoring-points`; a command rejection
 * (unknown kind/frequency, inverted target range) comes back as a 400 with an
 * actionable message, an out-of-scope location as a 403. Inputs are preserved
 * on failure and cleared on success.
 *
 * `unit` is provisional free text with no closed vocabulary yet (`DEC-071`).
 */
export function RegisterPointForm({
  locations,
  storageAreas,
}: {
  readonly locations: readonly RegisterLocationOption[];
  readonly storageAreas: readonly RegisterStorageAreaOption[];
}) {
  const router = useRouter();
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const locationAreas = storageAreas.filter((area) => area.locationId === form.locationId);

  function set<K extends keyof typeof EMPTY_FORM>(key: K, value: string): void {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (form.locationId === "") {
      setError("Choose the location the point belongs to.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/v1/hms/monitoring-points", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: form.code.trim(),
          name: form.name.trim(),
          kind: form.kind,
          unit: form.unit.trim(),
          targetMin: form.targetMin.trim(),
          targetMax: form.targetMax.trim(),
          checkFrequency: form.checkFrequency,
          locationId: form.locationId,
          storageAreaId: form.storageAreaId === "" ? null : form.storageAreaId,
        }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      const body = (await response.json().catch(() => null)) as RegisterPointResponse | null;
      setSuccess(`Registered ${body?.code ?? form.code.trim()}. It is ready for readings.`);
      setForm(EMPTY_FORM);
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard
      title="Register a monitoring point"
      meta="owner, general manager, location manager, kitchen, front of house"
    >
      <form
        onSubmit={submit}
        style={{ display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 640 }}
      >
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        {success !== null ? <Alert tone="success">{success}</Alert> : null}

        <TextField
          name="code"
          label="Code"
          required
          value={form.code}
          onChange={(event) => set("code", event.target.value)}
          help="Short unique identifier, e.g. FRZ-1."
        />

        <TextField
          name="name"
          label="Name"
          required
          value={form.name}
          onChange={(event) => set("name", event.target.value)}
          help="Human-readable name, e.g. Kitchen freezer 1."
        />

        <SelectField
          name="kind"
          label="Kind"
          required
          value={form.kind}
          onChange={(event) => set("kind", event.target.value)}
          options={MONITORING_POINT_KINDS.map((kind) => ({
            value: kind,
            label: monitoringPointKindLabel(kind),
          }))}
        />

        <TextField
          name="unit"
          label="Unit"
          required
          value={form.unit}
          onChange={(event) => set("unit", event.target.value)}
          help="Free text for now — no closed unit vocabulary yet (DEC-071), e.g. celsius."
        />

        <NumberField
          name="targetMin"
          label="Target minimum"
          required
          step="any"
          value={form.targetMin}
          onChange={(event) => set("targetMin", event.target.value)}
          help="Inclusive lower bound of the target range."
        />

        <NumberField
          name="targetMax"
          label="Target maximum"
          required
          step="any"
          value={form.targetMax}
          onChange={(event) => set("targetMax", event.target.value)}
          help="Inclusive upper bound; must not be lower than the minimum."
        />

        <SelectField
          name="checkFrequency"
          label="Check frequency"
          required
          value={form.checkFrequency}
          onChange={(event) => set("checkFrequency", event.target.value)}
          options={CHECK_FREQUENCIES.map((frequency) => ({
            value: frequency,
            label: checkFrequencyLabel(frequency),
          }))}
        />

        <SelectField
          name="locationId"
          label="Location"
          required
          value={form.locationId}
          onChange={(event) => {
            set("locationId", event.target.value);
            set("storageAreaId", "");
          }}
          options={locations.map((location) => ({ value: location.id, label: location.label }))}
          help="Only locations inside your location scope are accepted."
        />

        <SelectField
          name="storageAreaId"
          label="Storage area (optional)"
          value={form.storageAreaId}
          onChange={(event) => set("storageAreaId", event.target.value)}
          options={locationAreas.map((area) => ({ value: area.id, label: area.label }))}
          placeholder="None"
          help="Optional storage area at the chosen location."
        />

        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Register point
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
