"use client";

import {
  Button,
  DateField,
  FormModal,
  InfoTip,
  SuccessToast,
  color,
  spacing,
  typography,
} from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not generate the report. Please try again.";

/**
 * Generates one monthly payroll-input report (`WF-005`, `DEC-104`) through
 * `POST /api/v1/workforce/payroll-reports`. The register's header primary action
 * opens this modal; generation is on demand (the scheduler is ADR-0004-gated)
 * and a same-period regeneration supersedes the prior live report server-side.
 * The DEC-104 projection caveat is stated as an InfoTip: only assigned/completed
 * shifts count, so a pre-month-end run under-counts.
 */
export function GeneratePayrollReportModal({
  defaultPeriodStart,
  defaultPeriodEnd,
}: {
  readonly defaultPeriodStart: string;
  readonly defaultPeriodEnd: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [periodStart, setPeriodStart] = useState(defaultPeriodStart);
  const [periodEnd, setPeriodEnd] = useState(defaultPeriodEnd);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function close(): void {
    if (!busy) {
      setOpen(false);
      setError(null);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
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
      setOpen(false);
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Generate a report</Button>
      <FormModal
        title="Generate a payroll report"
        description="Freezes each employee's hours × base hourly rate as expected pay (decimal only, NOK). Generate after month-end, or regenerate once the remaining shifts are completed."
        open={open}
        onClose={close}
        onSubmit={submit}
        busy={busy}
        submitLabel="Generate report"
        error={error}
      >
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

        <p
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: spacing[1],
            margin: 0,
            color: color.ink.tertiary,
            fontSize: typography.fontSize.sm,
          }}
        >
          <span>
            Only shifts in state assigned or completed count, so a report generated before month-end
            under-counts. A same-period regeneration supersedes the prior live report — the prior
            row is retained, never deleted.
          </span>
          <InfoTip
            content="Regenerating for the same period supersedes the prior live report; the prior report is kept as superseded, never deleted."
            label="About regenerating a report"
          />
        </p>
      </FormModal>
      <SuccessToast
        open={success !== null}
        onDismiss={() => setSuccess(null)}
        message={success ?? ""}
      />
    </>
  );
}
