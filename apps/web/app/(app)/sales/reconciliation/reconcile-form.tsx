"use client";

import {
  Alert,
  Button,
  CheckboxField,
  SectionCard,
  SelectField,
  TextField,
  spacing,
} from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const RECONCILE_FALLBACK = "Could not reconcile. Please try again.";

export interface ReconcileRunOption {
  readonly id: string;
  readonly source: string;
  readonly period: string;
}

export interface ReconcileSettlementOption {
  readonly id: string;
  readonly provider: string;
  readonly period: string;
  readonly paidAmount: string | null;
  readonly currency: string;
}

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : RECONCILE_FALLBACK;
}

/**
 * Creates (or updates) a reconciliation for a posted import run or a channel
 * settlement (`REC-001`/`002`/`005`). The tolerance is either the explicit
 * value or an explicit opt-in to the published DEC-026 default — never a silent
 * default (open point (b)). Re-running for the same scope/period updates the
 * existing row.
 */
export function ReconcileForm({
  runs,
  settlements,
}: {
  readonly runs: readonly ReconcileRunOption[];
  readonly settlements: readonly ReconcileSettlementOption[];
}) {
  const router = useRouter();
  const [target, setTarget] = useState(
    runs[0] !== undefined ? `run:${runs[0].id}` : `settlement:${settlements[0]?.id ?? ""}`,
  );
  const [tolerance, setTolerance] = useState("");
  const [useDefault, setUseDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const options = [
    ...runs.map((run) => ({
      value: `run:${run.id}`,
      label: `Import run · ${run.source} · ${run.period}`,
    })),
    ...settlements.map((settlement) => ({
      value: `settlement:${settlement.id}`,
      label: `Settlement · ${settlement.provider} · ${settlement.period}${
        settlement.paidAmount === null
          ? " (no paid amount)"
          : ` · ${settlement.paidAmount} ${settlement.currency}`
      }`,
    })),
  ];

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const [kind, id] = target.split(":");
    if ((kind !== "run" && kind !== "settlement") || id === undefined || id.length === 0) {
      setError("Choose what to reconcile.");
      return;
    }
    if (!useDefault && tolerance.trim().length === 0) {
      setError("Enter a tolerance, or opt in to the DEC-026 default.");
      return;
    }

    setBusy(true);
    try {
      const body: Record<string, unknown> = useDefault
        ? { useDecisionDefaultTolerance: true }
        : { tolerance: tolerance.trim() };
      const response = await fetch(
        kind === "run"
          ? `/api/v1/reconciliations/import-runs/${id}`
          : "/api/v1/reconciliations/settlements",
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(kind === "settlement" ? { ...body, settlementId: id } : body),
        },
      );
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      setSuccess("Reconciliation recorded. Resolve any exception below.");
      router.refresh();
    } catch {
      setError(RECONCILE_FALLBACK);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Reconcile" meta="posted run · settlement">
      <form
        onSubmit={submit}
        style={{ display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 720 }}
      >
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        {success !== null ? <Alert tone="success">{success}</Alert> : null}

        <SelectField
          name="target"
          label="What to reconcile"
          required
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          options={options}
          help="A posted import run compares source against posted plus approved dispositions; a settlement compares its paid amount against posted sales for the channel/period."
        />

        <TextField
          name="tolerance"
          label="Tolerance"
          disabled={useDefault}
          value={tolerance}
          onChange={(event) => setTolerance(event.target.value)}
          placeholder="e.g. 0.005 or 25"
          help={
            useDefault
              ? "Not used while the DEC-026 default is selected — untick the box below to enter an explicit tolerance."
              : "A positive decimal: a relative fraction (≤ 1) or an absolute amount in the row's currency. Required unless you opt in to the DEC-026 default."
          }
        />
        <CheckboxField
          name="useDecisionDefaultTolerance"
          label="Use the DEC-026 default (max of 0.5% and 5 NOK)"
          checked={useDefault}
          onChange={(event) => setUseDefault(event.target.checked)}
        />

        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Reconcile
          </Button>
        </div>
        <p style={{ margin: 0, opacity: 0.8 }}>
          Reconciling snapshots the tolerance, the difference and the status; it changes nothing
          else. Re-running for the same scope and period updates the existing row.
        </p>
      </form>
    </SectionCard>
  );
}
