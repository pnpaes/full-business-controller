"use client";

import { Alert, Button, DateField, SectionCard, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not build the export. Please try again.";

interface ExportCounts {
  readonly monitoringReadings: number;
  readonly incidents: number;
  readonly correctiveActions: number;
  readonly checklistRuns: number;
  readonly maintenanceLogs: number;
}

interface ExportBundle {
  readonly generatedAt?: string;
  readonly period?: { readonly from: string | null; readonly to: string | null };
  readonly counts?: ExportCounts;
  readonly truncated?: Record<string, boolean>;
  readonly personalDataFields?: readonly string[];
}

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

/**
 * The compliance/evidence export (`DEC-093`, `DEC-098`): pick an inclusive
 * period, build the internal JSON bundle (monitoring readings, incidents,
 * corrective actions, checklist runs, maintenance logs) and download it. The
 * bundle is the route's response verbatim — an internal JSON object, not a
 * regulator-formatted document (`DEC-098`). Truncation is surfaced honestly per
 * source, and the personal-data field list is shown because no minimisation is
 * applied yet (`DEC-098` item 5).
 */
export function ComplianceExportForm() {
  const router = useRouter();
  const [fromDay, setFromDay] = useState("");
  const [toDay, setToDay] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [bundle, setBundle] = useState<ExportBundle | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setBundle(null);
    if (fromDay.trim().length === 0 || toDay.trim().length === 0) {
      setError("Choose both the first and the last day of the period.");
      return;
    }
    if (fromDay.trim() > toDay.trim()) {
      setError("The first day must not be after the last day.");
      return;
    }

    setBusy(true);
    try {
      const query = new URLSearchParams({
        from: `${fromDay.trim()}T00:00:00.000Z`,
        to: `${toDay.trim()}T23:59:59.999Z`,
      });
      const response = await fetch(`/api/v1/hms/compliance-export?${query.toString()}`, {
        credentials: "same-origin",
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      const body = (await response.json()) as ExportBundle;
      setBundle(body);
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  function download(): void {
    if (bundle === undefined || bundle === null) {
      return;
    }
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `hms-compliance-export-${fromDay}-${toDay}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const counts = bundle?.counts;
  const truncated = bundle?.truncated ?? {};
  const truncatedSources = Object.entries(truncated).filter(([, value]) => value === true);

  return (
    <SectionCard title="Build the evidence bundle" meta="internal JSON · DEC-098">
      <form
        onSubmit={submit}
        style={{ display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 640 }}
      >
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}

        <DateField
          name="from"
          label="Period from"
          required
          value={fromDay}
          onChange={(event) => setFromDay(event.target.value)}
          help="Inclusive: the window starts at 00:00:00 UTC on this day."
        />
        <DateField
          name="to"
          label="Period to"
          required
          value={toDay}
          onChange={(event) => setToDay(event.target.value)}
          help="Inclusive: the window ends at 23:59:59 UTC on this day."
        />

        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Build bundle
          </Button>
        </div>
      </form>

      {bundle !== null && counts !== undefined ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: spacing[3],
            marginTop: spacing[4],
          }}
        >
          <Alert tone="info" title="Personal data is included">
            The bundle carries {bundle.personalDataFields?.length ?? 0} personal-data fields
            verbatim — no minimisation is applied yet (DEC-098 item 5, privacy review pending).
            Store and share it accordingly.
          </Alert>
          {truncatedSources.length > 0 ? (
            <Alert tone="warning" title="Some sources hit the ceiling">
              Truncated sources: {truncatedSources.map(([key]) => key).join(", ")}. The bundle may
              be missing in-scope rows for them — the safe direction for a completeness attestation.
            </Alert>
          ) : null}
          <ul style={{ margin: 0, paddingLeft: spacing[5] }}>
            <li>{counts.monitoringReadings} monitoring readings</li>
            <li>{counts.incidents} incidents</li>
            <li>{counts.correctiveActions} corrective actions</li>
            <li>{counts.checklistRuns} checklist runs</li>
            <li>{counts.maintenanceLogs} maintenance logs</li>
          </ul>
          <div>
            <Button onClick={download}>Download JSON bundle</Button>
          </div>
        </div>
      ) : null}
    </SectionCard>
  );
}
