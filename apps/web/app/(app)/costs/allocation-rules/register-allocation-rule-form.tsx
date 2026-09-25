"use client";

import { Alert, Button, SectionCard, SelectField, TextField, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not register the allocation rule. Please try again.";

export interface AllocationPoolOption {
  readonly id: string;
  readonly code: string | null;
  readonly name: string | null;
}

export interface RegisterAllocationRuleFormProps {
  readonly pools: readonly AllocationPoolOption[];
  readonly drivers: readonly string[];
  readonly scopeTypes: readonly string[];
  readonly denominatorSources: readonly string[];
  readonly fallbacks: readonly string[];
}

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : fallback;
}

/** `equal_share` → `Equal share`, for a readable vocabulary option. */
function humanize(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Registers an allocation rule through `POST /api/v1/costing/allocation-rules`
 * (COST-007/011). Every vocabulary is a closed list; the denominator source is
 * validated by the command, so the select mirrors the server vocabulary exactly.
 */
export function RegisterAllocationRuleForm({
  pools,
  drivers,
  scopeTypes,
  denominatorSources,
  fallbacks,
}: RegisterAllocationRuleFormProps) {
  const router = useRouter();
  const [costPoolId, setCostPoolId] = useState(pools[0]?.id ?? "");
  const [driver, setDriver] = useState(drivers[0] ?? "equal_share");
  const [scopeType, setScopeType] = useState(scopeTypes[0] ?? "organization");
  const [denominatorSource, setDenominatorSource] = useState(
    denominatorSources[0] ?? "equal_share",
  );
  const [fallbackBehavior, setFallbackBehavior] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(today());
  const [effectiveTo, setEffectiveTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (pools.length === 0) {
    return (
      <SectionCard title="Register an allocation rule">
        <Alert tone="info">
          An allocation rule attaches to a cost pool. Register a cost pool first — none exist in
          this organization yet.
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
      const response = await fetch("/api/v1/costing/allocation-rules", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          costPoolId,
          driver,
          scopeType,
          denominatorSource,
          effectiveFrom,
          ...(fallbackBehavior === "" ? {} : { fallbackBehavior }),
          ...(effectiveTo === "" ? {} : { effectiveTo }),
        }),
      });
      if (!response.ok) {
        setError(await errorMessage(response, FALLBACK_ERROR));
        return;
      }
      setSuccess("Registered the allocation rule.");
      setEffectiveTo("");
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Register an allocation rule" meta="how a pool splits">
      <form
        onSubmit={submit}
        style={{ display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 640 }}
      >
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        {success !== null ? <Alert tone="success">{success}</Alert> : null}

        <SelectField
          name="costPoolId"
          label="Cost pool"
          required
          value={costPoolId}
          onChange={(event) => setCostPoolId(event.target.value)}
          options={pools.map((pool) => ({
            value: pool.id,
            label:
              pool.code === null ? (pool.name ?? pool.id) : `${pool.code} · ${pool.name ?? ""}`,
          }))}
        />

        <SelectField
          name="driver"
          label="Driver"
          required
          value={driver}
          onChange={(event) => setDriver(event.target.value)}
          options={drivers.map((value) => ({ value, label: humanize(value) }))}
          help="What the split follows — area, hours, transactions, revenue or an even share."
        />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: spacing[4],
          }}
        >
          <SelectField
            name="scopeType"
            label="Scope"
            required
            value={scopeType}
            onChange={(event) => setScopeType(event.target.value)}
            options={scopeTypes.map((value) => ({ value, label: humanize(value) }))}
          />
          <SelectField
            name="denominatorSource"
            label="Denominator source"
            required
            value={denominatorSource}
            onChange={(event) => setDenominatorSource(event.target.value)}
            options={denominatorSources.map((value) => ({ value, label: humanize(value) }))}
            help="Where the driver's denominator quantity comes from (DEC-112/114)."
          />
        </div>

        <SelectField
          name="fallbackBehavior"
          label="Fallback"
          placeholder="Stop (default)"
          value={fallbackBehavior}
          onChange={(event) => setFallbackBehavior(event.target.value)}
          options={fallbacks.map((value) => ({ value, label: humanize(value) }))}
          help="What happens when the denominator is zero: stop, or split equally."
        />

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
            help="Optional. Leave empty for an open-ended rule."
          />
        </div>

        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Register allocation rule
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
