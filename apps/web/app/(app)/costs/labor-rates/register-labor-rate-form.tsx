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

const FALLBACK_ERROR = "Could not register the labour rate. Please try again.";

export interface LaborRateCenterOption {
  readonly id: string;
  readonly code: string | null;
  readonly name: string;
}

export interface RegisterLaborRateFormProps {
  readonly costCenters: readonly LaborRateCenterOption[];
  readonly currency: string | null;
  readonly roleCodes: readonly string[];
}

interface ErrorBody {
  readonly error?: string;
}

interface RegisterResult {
  readonly loadedHourlyRate?: string;
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : fallback;
}

/** `general_manager` → `General manager`, for a readable role option. */
function humanize(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Registers a labour rate through `POST /api/v1/costing/labor-rates` (COST-004).
 * The statutory percentages are optional; the loaded hourly rate is derived by
 * the domain command and echoed back in the confirmation. The cost-centre
 * options come from the cost centres already referenced by costing facts —
 * cost centres are seeded master data with no authoring screen yet.
 */
export function RegisterLaborRateForm({
  costCenters,
  currency,
  roleCodes,
}: RegisterLaborRateFormProps) {
  const router = useRouter();
  const [costCenterId, setCostCenterId] = useState(costCenters[0]?.id ?? "");
  const [roleCode, setRoleCode] = useState(roleCodes[0] ?? "kitchen");
  const [baseHourlyRate, setBaseHourlyRate] = useState("");
  const [feriepengerPct, setFeriepengerPct] = useState("");
  const [employerContributionPct, setEmployerContributionPct] = useState("");
  const [pensionPct, setPensionPct] = useState("");
  const [productiveHoursPct, setProductiveHoursPct] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(today());
  const [effectiveTo, setEffectiveTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (costCenters.length === 0) {
    return (
      <SectionCard title="Register a labour rate">
        <Alert tone="info">
          Registering a labour rate needs a cost centre. No cost centre is referenced by this
          organization&apos;s costing facts yet — cost centres are seeded master data, so seed the
          demo data first.
        </Alert>
      </SectionCard>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const response = await fetch("/api/v1/costing/labor-rates", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          costCenterId,
          roleCode,
          baseHourlyRate: baseHourlyRate.trim(),
          effectiveFrom,
          ...(feriepengerPct.trim() === "" ? {} : { feriepengerPct: feriepengerPct.trim() }),
          ...(employerContributionPct.trim() === ""
            ? {}
            : { employerContributionPct: employerContributionPct.trim() }),
          ...(pensionPct.trim() === "" ? {} : { pensionPct: pensionPct.trim() }),
          ...(productiveHoursPct.trim() === ""
            ? {}
            : { productiveHoursPct: productiveHoursPct.trim() }),
          ...(effectiveTo === "" ? {} : { effectiveTo }),
        }),
      });
      if (!response.ok) {
        setError(await errorMessage(response, FALLBACK_ERROR));
        return;
      }
      const body = (await response.json()) as RegisterResult;
      setSuccess(
        `Registered the ${humanize(roleCode)} rate. Loaded hourly rate: ${
          body.loadedHourlyRate ?? "—"
        }${currency === null ? "" : ` ${currency}`}/hour.`,
      );
      setBaseHourlyRate("");
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  const pctField = (
    name: string,
    label: string,
    value: string,
    onChange: (next: string) => void,
    help?: string,
  ) => (
    <NumberField
      name={name}
      label={label}
      step="0.0001"
      inputMode="decimal"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder="0.0000"
      {...(help === undefined ? {} : { help })}
    />
  );

  return (
    <SectionCard title="Register a labour rate" meta="loaded rate derived">
      <form
        onSubmit={submit}
        style={{ display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 640 }}
      >
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        {success !== null ? <Alert tone="success">{success}</Alert> : null}

        <SelectField
          name="costCenterId"
          label="Cost centre"
          required
          value={costCenterId}
          onChange={(event) => setCostCenterId(event.target.value)}
          options={costCenters.map((center) => ({
            value: center.id,
            label: center.code === null ? center.name : `${center.code} · ${center.name}`,
          }))}
        />

        <SelectField
          name="roleCode"
          label="Role"
          required
          value={roleCode}
          onChange={(event) => setRoleCode(event.target.value)}
          options={roleCodes.map((value) => ({ value, label: humanize(value) }))}
        />

        <NumberField
          name="baseHourlyRate"
          label="Base hourly rate"
          required
          min="0"
          step="0.0001"
          inputMode="decimal"
          value={baseHourlyRate}
          onChange={(event) => setBaseHourlyRate(event.target.value)}
          {...(currency === null ? {} : { unit: currency })}
          placeholder="0.00"
          help={
            currency === null
              ? "The wage before statutory additions; the loaded rate is derived from it. The rate is stored without a currency."
              : "The wage before statutory additions; the loaded rate is derived from it."
          }
        />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: spacing[4],
          }}
        >
          {pctField(
            "feriepengerPct",
            "Feriepenger",
            feriepengerPct,
            setFeriepengerPct,
            "A fraction of 1 — enter 0.12 for 12%. Leave empty to omit.",
          )}
          {pctField(
            "employerContributionPct",
            "Employer contribution",
            employerContributionPct,
            setEmployerContributionPct,
            "A fraction of 1 — enter 0.141 for 14.1%. Leave empty to omit.",
          )}
          {pctField(
            "pensionPct",
            "Pension",
            pensionPct,
            setPensionPct,
            "A fraction of 1 — enter 0.05 for 5%. Leave empty to omit.",
          )}
          {pctField(
            "productiveHoursPct",
            "Productive hours",
            productiveHoursPct,
            setProductiveHoursPct,
            "A fraction of 1 — enter 0.8 for 80%. Leave empty for the default of 1 (a full share, not the same as zero).",
          )}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: spacing[4],
          }}
        >
          <TextField
            name="effectiveFrom"
            type="date"
            label="Effective from"
            required
            value={effectiveFrom}
            onChange={(event) => setEffectiveFrom(event.target.value)}
          />
          <TextField
            name="effectiveTo"
            type="date"
            label="Effective to"
            value={effectiveTo}
            onChange={(event) => setEffectiveTo(event.target.value)}
            help="Optional. Leave empty for an open-ended rate."
          />
        </div>

        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Register labour rate
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
