"use client";

import type { AnalyticsMetric, ForecastGrain } from "@aquarela/application";
import { Alert, Button, TextField, color, geometry, spacing, typography } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not save the forecast tracking change. Please try again.";
const DAY_PERIOD = /^\d{4}-\d{2}-\d{2}$/;

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

export interface ForecastTrackingActionsProps {
  readonly metric: AnalyticsMetric;
  readonly grain: ForecastGrain;
  /** The grain's human label, passed from the server so this client chunk does not import the application barrel. */
  readonly grainText: string;
  readonly locationId: string | null;
  readonly channelId: string | null;
  readonly snapshotId: string | null;
  /** The completed periods a recorded snapshot covers (for the override periods). */
  readonly periods: readonly string[];
}

const summaryStyle = {
  cursor: "pointer",
  minHeight: geometry.touchTarget,
  display: "flex",
  alignItems: "center",
  fontWeight: typography.fontWeight.semibold,
  color: color.brand.navy,
} as const;

/**
 * The management actions on the forecast-tracking section (`DEC-138`):
 * **record a snapshot** of the current model, and **append an override** with a
 * mandatory reason. Both post to the role-gated tracking routes (owner /
 * general_manager / admin) and refresh the server-rendered section. The client
 * validates shape and the required reason before posting; the command and the
 * database remain the authority, and an override is advisory and append-only —
 * it is never auto-applied.
 */
export function ForecastTrackingActions(props: ForecastTrackingActionsProps) {
  const router = useRouter();
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [snapshotNotice, setSnapshotNotice] = useState<string | null>(null);
  const [historyPeriods, setHistoryPeriods] = useState("");
  const [horizonPeriods, setHorizonPeriods] = useState("");

  const [overrideBusy, setOverrideBusy] = useState(false);
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [overrideNotice, setOverrideNotice] = useState<string | null>(null);
  const [period, setPeriod] = useState(props.periods[0] ?? "");
  const [reason, setReason] = useState("");

  function scopePayload(): Record<string, string> {
    return {
      ...(props.locationId === null ? {} : { locationId: props.locationId }),
      ...(props.channelId === null ? {} : { channelId: props.channelId }),
    };
  }

  function optionalWindow(value: string, label: string): number | string | undefined {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    if (!/^\d+$/.test(trimmed)) {
      return `${label} must be a whole number.`;
    }
    return Number(trimmed);
  }

  async function submitSnapshot(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSnapshotError(null);
    setSnapshotNotice(null);

    const history = optionalWindow(historyPeriods, "History periods");
    if (typeof history === "string") {
      setSnapshotError(history);
      return;
    }
    const horizon = optionalWindow(horizonPeriods, "Horizon periods");
    if (typeof horizon === "string") {
      setSnapshotError(horizon);
      return;
    }

    setSnapshotBusy(true);
    try {
      const response = await fetch("/api/v1/analytics/forecasts", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metric: props.metric,
          grain: props.grain,
          ...scopePayload(),
          ...(history === undefined ? {} : { historyPeriods: history }),
          ...(horizon === undefined ? {} : { horizonPeriods: horizon }),
        }),
      });
      if (!response.ok) {
        setSnapshotError(await errorMessage(response));
        return;
      }
      setSnapshotNotice("Snapshot recorded. Tracking compares it with posted actuals.");
      setHistoryPeriods("");
      setHorizonPeriods("");
      router.refresh();
    } catch {
      setSnapshotError(FALLBACK_ERROR);
    } finally {
      setSnapshotBusy(false);
    }
  }

  async function submitOverride(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setOverrideError(null);
    setOverrideNotice(null);

    const trimmedPeriod = period.trim();
    if (!DAY_PERIOD.test(trimmedPeriod)) {
      setOverrideError("Enter the period as YYYY-MM-DD.");
      return;
    }
    const trimmedReason = reason.trim();
    if (trimmedReason.length === 0) {
      setOverrideError("An override must state why.");
      return;
    }

    setOverrideBusy(true);
    try {
      const response = await fetch("/api/v1/analytics/forecasts/overrides", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metric: props.metric,
          grain: props.grain,
          period: trimmedPeriod,
          reason: trimmedReason,
          ...scopePayload(),
          ...(props.snapshotId === null ? {} : { snapshotId: props.snapshotId }),
        }),
      });
      if (!response.ok) {
        setOverrideError(await errorMessage(response));
        return;
      }
      setOverrideNotice("Override appended. It is advisory and never auto-applied.");
      setReason("");
      router.refresh();
    } catch {
      setOverrideError(FALLBACK_ERROR);
    } finally {
      setOverrideBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[4] }}>
      {snapshotNotice !== null ? <Alert tone="success">{snapshotNotice}</Alert> : null}
      {overrideNotice !== null ? <Alert tone="success">{overrideNotice}</Alert> : null}

      <details>
        <summary style={summaryStyle}>Record a snapshot</summary>
        <form
          onSubmit={submitSnapshot}
          style={{
            marginTop: spacing[4],
            display: "flex",
            flexDirection: "column",
            gap: spacing[3],
            maxWidth: 480,
          }}
        >
          {snapshotError !== null ? <Alert tone="danger">{snapshotError}</Alert> : null}
          <span style={{ fontSize: typography.fontSize.xs, color: color.text.muted }}>
            Records the current model output at {props.grainText.toLowerCase()} as an auditable
            fact. A forecast without enough history is refused.
          </span>
          <TextField
            name="historyPeriods"
            label="History periods"
            type="number"
            inputMode="numeric"
            value={historyPeriods}
            onChange={(event) => setHistoryPeriods(event.target.value)}
            placeholder="12 (default)"
          />
          <TextField
            name="horizonPeriods"
            label="Horizon periods"
            type="number"
            inputMode="numeric"
            value={horizonPeriods}
            onChange={(event) => setHorizonPeriods(event.target.value)}
            placeholder="3 (default)"
          />
          <div>
            <Button type="submit" loading={snapshotBusy} disabled={snapshotBusy}>
              Record snapshot
            </Button>
          </div>
        </form>
      </details>

      <details>
        <summary style={summaryStyle}>Add an override</summary>
        <form
          onSubmit={submitOverride}
          style={{
            marginTop: spacing[4],
            display: "flex",
            flexDirection: "column",
            gap: spacing[3],
            maxWidth: 480,
          }}
        >
          {overrideError !== null ? <Alert tone="danger">{overrideError}</Alert> : null}
          <span style={{ fontSize: typography.fontSize.xs, color: color.text.muted }}>
            Appends a reasoned annotation of a projected day. It is advisory, append-only and never
            applied automatically.
          </span>
          <TextField
            name="period"
            label="Period"
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
            placeholder="YYYY-MM-DD"
            help="The projected day bucket being annotated."
          />
          <TextField
            name="reason"
            label="Reason"
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why the projection is off"
            help="Mandatory: an override without a reason is refused."
          />
          <div>
            <Button type="submit" loading={overrideBusy} disabled={overrideBusy}>
              Append override
            </Button>
          </div>
        </form>
      </details>
    </div>
  );
}
