"use client";

import { Alert, Button, SectionCard, SelectField, TextField, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not begin the close. Please try again.";

export interface CloseLocationOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface BeginCloseFormProps {
  /** Locations the caller may close; already filtered to the caller's scope. */
  readonly locations: readonly CloseLocationOption[];
  readonly defaultLocationId: string;
  /** The served organization id; the `company` scope's `scopeId` (`DEC-027`). */
  readonly organizationId: string;
  /** True when the caller holds `PERIOD_CLOSE_COMPANY_WRITE_ROLES`. */
  readonly canCompanyClose: boolean;
}

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

/**
 * Begins a close (`DEC-119`, `REC-003`, `DEC-027`): a **location** daily close by
 * default (a location and a day), or the **company** calendar-month close when the
 * caller holds the company-write roles (then the `periodStart` is the first of the
 * month and the `scopeId` is the organization). The checklist starts empty — a
 * checklist editor is out of scope for this slice — and the actor and
 * organization are the server's. The block on unresolved prerequisites is
 * evaluated server-side (`DEC-107`); a blocked begin returns the blocker message.
 */
export function BeginCloseForm({
  locations,
  defaultLocationId,
  organizationId,
  canCompanyClose,
}: BeginCloseFormProps) {
  const router = useRouter();
  const [scopeType, setScopeType] = useState<"location" | "company">(
    locations.length === 0 && canCompanyClose ? "company" : "location",
  );
  const [locationId, setLocationId] = useState(defaultLocationId);
  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (locations.length === 0 && !canCompanyClose) {
    return (
      <SectionCard title="Begin a close" meta="daily location or company month">
        <Alert tone="info">
          Beginning a location close needs a location in your scope. Ask an owner or administrator
          for a location-scoped role, or register a location first.
        </Alert>
      </SectionCard>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    let periodStart: string;
    let scopeId: string;
    if (scopeType === "company") {
      if (!MONTH.test(month.trim())) {
        setError("Choose the month to close.");
        return;
      }
      periodStart = `${month.trim()}-01`;
      scopeId = organizationId;
    } else {
      if (locationId.length === 0) {
        setError("Choose a location.");
        return;
      }
      if (!DAY.test(day.trim())) {
        setError("Choose the day to close.");
        return;
      }
      periodStart = day.trim();
      scopeId = locationId;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/v1/period-closes", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scopeType, scopeId, periodStart, checklist: [] }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      setSuccess(
        scopeType === "company"
          ? "Company month close begun. Lock it once the checks pass."
          : "Location close begun. Lock it once the checks pass.",
      );
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Begin a close" meta="daily location or company month">
      <form
        onSubmit={submit}
        style={{ display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 640 }}
      >
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        {success !== null ? <Alert tone="success">{success}</Alert> : null}

        {canCompanyClose ? (
          <SelectField
            name="scopeType"
            label="Scope"
            required
            value={scopeType}
            onChange={(event) =>
              setScopeType(event.target.value === "company" ? "company" : "location")
            }
            options={[
              { value: "location", label: "A location (daily close)" },
              { value: "company", label: "Company (calendar month)" },
            ]}
            help="A daily close locks one location and one day; the company close locks the whole organization's month (DEC-027)."
          />
        ) : null}

        {scopeType === "location" ? (
          <>
            <SelectField
              name="locationId"
              label="Location"
              required
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
              options={locations.map((location) => ({
                value: location.id,
                label: `${location.code} · ${location.name}`,
              }))}
            />
            <TextField
              name="periodStart"
              type="date"
              label="Day"
              required
              value={day}
              onChange={(event) => setDay(event.target.value)}
              help="A location close covers this single day (DEC-027)."
            />
          </>
        ) : (
          <TextField
            name="month"
            type="month"
            label="Month"
            required
            value={month}
            onChange={(event) => setMonth(event.target.value)}
            help="The whole UTC calendar month is closed; the period start is the first of the month (DEC-027)."
          />
        )}

        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Begin close
          </Button>
        </div>
        <p style={{ margin: 0, opacity: 0.8 }}>
          Beginning evaluates the DEC-107 prerequisites (open reconciliations and unfinished import
          runs) and freezes the snapshot; a blocked close writes nothing. The close-task checklist
          starts empty — a checklist editor is out of scope for this slice.
        </p>
      </form>
    </SectionCard>
  );
}
