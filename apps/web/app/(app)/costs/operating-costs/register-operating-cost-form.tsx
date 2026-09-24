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

const FALLBACK_ERROR = "Could not register the operating cost. Please try again.";

export interface OperatingCostCenterOption {
  readonly id: string;
  readonly code: string | null;
  readonly name: string;
}

export interface OperatingCostLocationOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface OperatingCostPoolOption {
  readonly id: string;
  readonly code: string | null;
  readonly name: string | null;
}

export interface RegisterOperatingCostFormProps {
  readonly costCenters: readonly OperatingCostCenterOption[];
  readonly locations: readonly OperatingCostLocationOption[];
  readonly pools: readonly OperatingCostPoolOption[];
  readonly currency: string | null;
  readonly recurrences: readonly string[];
  readonly behaviors: readonly string[];
  readonly taxBases: readonly string[];
}

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : fallback;
}

/** `one_off` → `One off`, for a readable vocabulary option. */
function humanize(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Registers an operating cost through `POST /api/v1/costing/operating-costs`
 * (COST-003). The cost-centre options come from the cost centres already
 * referenced by this organization's costing facts — cost centres are seeded
 * master data with no authoring screen yet. Amount carries its currency; the
 * tax basis is explicit (brief §8.4: money is never shown without its basis).
 */
export function RegisterOperatingCostForm({
  costCenters,
  locations,
  pools,
  currency,
  recurrences,
  behaviors,
  taxBases,
}: RegisterOperatingCostFormProps) {
  const router = useRouter();
  const [costCenterId, setCostCenterId] = useState(costCenters[0]?.id ?? "");
  const [locationId, setLocationId] = useState("");
  const [costPoolId, setCostPoolId] = useState("");
  const [amount, setAmount] = useState("");
  const [currencyText, setCurrencyText] = useState(currency ?? "");
  const [recurrence, setRecurrence] = useState(recurrences[0] ?? "monthly");
  const [behavior, setBehavior] = useState(behaviors[0] ?? "fixed");
  const [taxBasis, setTaxBasis] = useState(taxBases[0] ?? "exclusive");
  const [effectiveFrom, setEffectiveFrom] = useState(today());
  const [effectiveTo, setEffectiveTo] = useState("");
  const [vendor, setVendor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const trimmedCurrency = currencyText.trim();

  if (costCenters.length === 0) {
    return (
      <SectionCard title="Register an operating cost">
        <Alert tone="info">
          Registering an operating cost needs a cost centre. No cost centre is referenced by this
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
      const response = await fetch("/api/v1/costing/operating-costs", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          costCenterId,
          amount: amount.trim(),
          recurrence,
          behavior,
          taxBasis,
          effectiveFrom,
          ...(locationId === "" ? {} : { locationId }),
          ...(costPoolId === "" ? {} : { costPoolId }),
          ...(trimmedCurrency.length === 0 ? {} : { currency: trimmedCurrency }),
          ...(effectiveTo === "" ? {} : { effectiveTo }),
          ...(vendor.trim().length === 0 ? {} : { vendor: vendor.trim() }),
        }),
      });
      if (!response.ok) {
        setError(await errorMessage(response, FALLBACK_ERROR));
        return;
      }
      setSuccess(`Registered the operating cost, effective from ${effectiveFrom}.`);
      setAmount("");
      setVendor("");
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Register an operating cost" meta="dated fact">
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
          name="locationId"
          label="Location"
          placeholder="Company shared (all locations)"
          value={locationId}
          onChange={(event) => setLocationId(event.target.value)}
          options={locations.map((location) => ({
            value: location.id,
            label: `${location.code} · ${location.name}`,
          }))}
          help="Leave empty for a company-shared cost; a null location is a scope, not a gap."
        />

        <SelectField
          name="costPoolId"
          label="Cost pool"
          placeholder="Direct (unpooled)"
          value={costPoolId}
          onChange={(event) => setCostPoolId(event.target.value)}
          options={pools.map((pool) => ({
            value: pool.id,
            label:
              pool.code === null ? (pool.name ?? pool.id) : `${pool.code} · ${pool.name ?? ""}`,
          }))}
          help="Optional (DEC-112): link the cost to a shared pool so an allocation rule can split it."
        />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: spacing[4] }}>
          <NumberField
            name="amount"
            label="Amount"
            required
            min="0"
            step="0.0001"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.00"
            {...(trimmedCurrency === "" ? {} : { unit: trimmedCurrency })}
          />
          <TextField
            name="currency"
            label="Currency"
            value={currencyText}
            onChange={(event) => setCurrencyText(event.target.value)}
            placeholder="NOK"
            help="Leave empty to record the cost in NOK — the server's default currency."
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: spacing[4] }}>
          <SelectField
            name="recurrence"
            label="Recurrence"
            required
            value={recurrence}
            onChange={(event) => setRecurrence(event.target.value)}
            options={recurrences.map((value) => ({ value, label: humanize(value) }))}
          />
          <SelectField
            name="behavior"
            label="Behaviour"
            required
            value={behavior}
            onChange={(event) => setBehavior(event.target.value)}
            options={behaviors.map((value) => ({ value, label: humanize(value) }))}
          />
          <SelectField
            name="taxBasis"
            label="Tax basis"
            required
            value={taxBasis}
            onChange={(event) => setTaxBasis(event.target.value)}
            options={taxBases.map((value) => ({ value, label: humanize(value) }))}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: spacing[4] }}>
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
            help="Optional. Leave empty for an open-ended cost."
          />
        </div>

        <TextField
          name="vendor"
          label="Vendor"
          value={vendor}
          onChange={(event) => setVendor(event.target.value)}
          placeholder="e.g. Glitre Energi"
          help="Optional."
        />

        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Register operating cost
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
