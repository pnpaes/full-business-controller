"use client";

import { Alert, Button, DateField, SectionCard, color, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not generate the report. Please try again.";

/**
 * Generates one monthly payroll-input report (`WF-005`, `DEC-104`) through
 * `POST /api/v1/workforce/payroll-reports`. Generation is on demand (the
 * scheduler is ADR-0004-gated) and a same-period regeneration supersedes the
 * prior live report server-side. The DEC-104 caveat is stated on the form:
 * only assigned/completed shifts count, so a pre-month-end run under-counts.
 */
export function GeneratePayrollReportForm({
  defaultPeriodStart,
  defaultPeriodEnd,
}: {
  readonly defaultPeriodStart: string;
  readonly defaultPeriodEnd: string;
}) {
  const router = useRouter();
  const [periodStart, setPeriodStart] = useState(defaultPeriodStart);
  const [periodEnd, setPeriodEnd] = useState(defaultPeriodEnd);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (periodEnd.trim().length === 0 || periodEnd.trim() <= periodStart.trim()) {
      setError("The period end must be after the period start.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/v1/workforce/payroll-reports", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodStart: periodStart.trim(), periodEnd: periodEnd.trim() }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(
          typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR,
        );
        return;
      }
      setSuccess("Report generated. A regeneration for the same period supersedes this one.");
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Generate a report" meta="on demand; regeneration supersedes">
      <form
        onSubmit={submit}
        style={{ display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 640 }}
      >
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        {success !== null ? <Alert tone="success">{success}</Alert> : null}

        <DateField
          name="periodStart"
          label="Period start"
          required
          value={periodStart}
          onChange={(event) => setPeriodStart(event.target.value)}
        />
        <DateField
          name="periodEnd"
          label="Period end"
          required
          value={periodEnd}
          onChange={(event) => setPeriodEnd(event.target.value)}
          help="The whole end day is included (a UTC half-open instant window)."
        />

        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Generate report
          </Button>
        </div>
        <p style={{ margin: 0, color: color.ink.tertiary }}>
          The report freezes per-employee hours × base hourly rate as expected pay (decimal only,
          NOK). Generating again for the same period supersedes the prior live report — the prior
          row is retained, never deleted.
        </p>
      </form>
    </SectionCard>
  );
}
