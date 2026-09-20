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

const VALIDATE_FALLBACK = "Could not validate the run. Please try again.";
const MAP_FALLBACK = "Could not map the run. Please try again.";
const DISPOSITION_FALLBACK = "Could not record the disposition. Please try again.";
const POST_FALLBACK = "Could not post the run. Please try again.";

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : fallback;
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

interface RunActionProps {
  readonly runId: string;
  readonly status: string;
  /** The run's source, used to narrow the external mappings for the map action. */
  readonly sourceSystem: string;
}

/**
 * Validate and map actions for a run that has not finished review.
 *
 * Validation rules are **caller-supplied** here because there is no
 * import-profile table to look them up in (recorded open point): the form
 * exposes the rule set the profile would otherwise provide. Mapping narrows the
 * external mappings to the run's source system and the `item` entity type
 * (`DEC-041`, SKU-first).
 *
 * Neither action posts anything; posting a validated run is the separate
 * `PostRunForm` below.
 */
export function RunActions({ runId, status, sourceSystem }: RunActionProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [expectedCurrency, setExpectedCurrency] = useState("NOK");
  const [requireCurrency, setRequireCurrency] = useState(true);
  const [requireOccurredAt, setRequireOccurredAt] = useState(true);
  const [requireAmounts, setRequireAmounts] = useState(true);
  const [requiredFields, setRequiredFields] = useState("");
  const [allowedLocations, setAllowedLocations] = useState("");

  const [mapSource, setMapSource] = useState(sourceSystem);
  const [mapEntityType, setMapEntityType] = useState("item");

  const canValidate = status === "parsed";
  const canMap = status === "parsed" || status === "needs_review" || status === "validated";
  if (!canValidate && !canMap) {
    return null;
  }

  async function validate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy("validate");
    try {
      const rules: Record<string, unknown> = {
        requireCurrency,
        requireOccurredAt,
        requireAmounts,
      };
      if (expectedCurrency.trim().length > 0) {
        rules.expectedCurrency = expectedCurrency.trim();
      }
      const fields = splitList(requiredFields);
      if (fields.length > 0) {
        rules.requiredNormalizedFields = fields;
      }
      const locations = splitList(allowedLocations);
      if (locations.length > 0) {
        rules.allowedLocationExternalIds = locations;
      }

      const response = await fetch(`/api/v1/imports/runs/${runId}/validate`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rules),
      });
      if (!response.ok) {
        setError(await errorMessage(response, VALIDATE_FALLBACK));
        return;
      }
      router.refresh();
    } catch {
      setError(VALIDATE_FALLBACK);
    } finally {
      setBusy(null);
    }
  }

  async function map(): Promise<void> {
    setError(null);
    setBusy("map");
    try {
      const body: Record<string, unknown> = {};
      if (mapSource.trim().length > 0) {
        body.sourceSystem = mapSource.trim();
      }
      if (mapEntityType.trim().length > 0) {
        body.entityType = mapEntityType.trim();
      }
      const response = await fetch(`/api/v1/imports/runs/${runId}/map`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setError(await errorMessage(response, MAP_FALLBACK));
        return;
      }
      router.refresh();
    } catch {
      setError(MAP_FALLBACK);
    } finally {
      setBusy(null);
    }
  }

  return (
    <SectionCard title="Validate and map" meta="review actions">
      <div style={{ display: "flex", flexDirection: "column", gap: spacing[5] }}>
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}

        {canValidate ? (
          <form
            onSubmit={validate}
            style={{ display: "flex", flexDirection: "column", gap: spacing[3], maxWidth: 720 }}
          >
            <p style={{ margin: 0, opacity: 0.85 }}>
              Validation marks each row and records the per-currency source totals. There is no
              import-profile table, so these rules travel with the request.
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: spacing[3],
              }}
            >
              <TextField
                name="expectedCurrency"
                label="Expected currency"
                value={expectedCurrency}
                onChange={(event) => setExpectedCurrency(event.target.value)}
                help="Optional ISO 4217 code; rows with a different currency fail validation."
              />
              <TextField
                name="requiredFields"
                label="Required normalized fields"
                value={requiredFields}
                onChange={(event) => setRequiredFields(event.target.value)}
                placeholder="occurred_at, currency, gross_amount"
                help="Comma-separated keys that must be present on every row."
              />
              <TextField
                name="allowedLocations"
                label="Allowed location external ids"
                value={allowedLocations}
                onChange={(event) => setAllowedLocations(event.target.value)}
                placeholder="Aquarela Kongens Gate, Aquarela Tullinløkka"
                help="Comma-separated; a row naming another location fails validation."
              />
            </div>
            <CheckboxField
              name="requireOccurredAt"
              label="Require occurred_at"
              checked={requireOccurredAt}
              onChange={(event) => setRequireOccurredAt(event.target.checked)}
            />
            <CheckboxField
              name="requireCurrency"
              label="Require currency"
              checked={requireCurrency}
              onChange={(event) => setRequireCurrency(event.target.checked)}
            />
            <CheckboxField
              name="requireAmounts"
              label="Require gross_amount"
              checked={requireAmounts}
              onChange={(event) => setRequireAmounts(event.target.checked)}
            />
            <div>
              <Button type="submit" loading={busy === "validate"} disabled={busy !== null}>
                Validate rows
              </Button>
            </div>
          </form>
        ) : (
          <p style={{ margin: 0, opacity: 0.85 }}>
            This run is <strong>{status}</strong>, so it can no longer be validated. Mapping can
            still be re-run while the run is open for review.
          </p>
        )}

        {canMap ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: spacing[3],
              maxWidth: 720,
              borderTop: "1px solid #e5e0d8",
              paddingTop: spacing[4],
            }}
          >
            <p style={{ margin: 0, opacity: 0.85 }}>
              Mapping resolves each row SKU-first, then by external id (`DEC-041`). A conflict is
              flagged and blocked, never remapped in place (`DEC-033`).
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: spacing[3],
              }}
            >
              <TextField
                name="mapSource"
                label="Source system"
                value={mapSource}
                onChange={(event) => setMapSource(event.target.value)}
                help="Narrows which external mappings are consulted."
              />
              <TextField
                name="mapEntityType"
                label="Entity type"
                value={mapEntityType}
                onChange={(event) => setMapEntityType(event.target.value)}
                help="Only `item` has a SKU lookup today (recorded open point)."
              />
            </div>
            <div>
              <Button
                variant="secondary"
                onClick={map}
                loading={busy === "map"}
                disabled={busy !== null}
              >
                Map rows
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}

export interface DispositionRow {
  readonly id: string;
  readonly sourceRowNo: number;
  readonly mappingState: string;
  readonly errorCode: string | null;
}

const DISPOSITION_OPTIONS = [
  { value: "unmapped", label: "Unmapped — leave it out of posting" },
  { value: "ignored", label: "Ignored — intentionally skipped" },
  { value: "rejected", label: "Rejected — invalid, with a reason" },
];

/**
 * Records an approved disposition for a non-posted row (`SALE-007`, `DEC-035`):
 * a run cannot close while a row lacks one. There is no disposition table or
 * approval workflow, so the actor recording it is the approval and the record is
 * appended to the run's diagnostics.
 */
export function DispositionForm({
  runId,
  rows,
}: {
  readonly runId: string;
  readonly rows: readonly DispositionRow[];
}) {
  const router = useRouter();
  const [stagingRowId, setStagingRowId] = useState(rows[0]?.id ?? "");
  const [disposition, setDisposition] = useState("unmapped");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (stagingRowId.length === 0) {
      setError("Choose the row to disposition.");
      return;
    }
    if (disposition === "rejected" && reason.trim().length === 0) {
      setError("A rejected disposition requires a reason.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`/api/v1/imports/runs/${runId}/dispositions`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stagingRowId,
          disposition,
          ...(reason.trim().length === 0 ? {} : { reason: reason.trim() }),
        }),
      });
      if (!response.ok) {
        setError(await errorMessage(response, DISPOSITION_FALLBACK));
        return;
      }
      setSuccess("Disposition recorded.");
      setReason("");
      router.refresh();
    } catch {
      setError(DISPOSITION_FALLBACK);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Record a disposition" meta={`${rows.length} row(s) undecided`}>
      <form
        onSubmit={submit}
        style={{ display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 720 }}
      >
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        {success !== null ? <Alert tone="success">{success}</Alert> : null}

        <SelectField
          name="stagingRowId"
          label="Row"
          required
          value={stagingRowId}
          onChange={(event) => setStagingRowId(event.target.value)}
          options={rows.map((row) => ({
            value: row.id,
            label: `Row ${row.sourceRowNo} · ${row.mappingState}${
              row.errorCode === null ? "" : ` (${row.errorCode})`
            }`,
          }))}
          help="Only rows that are neither mapped nor already dispositioned are listed."
        />

        <SelectField
          name="disposition"
          label="Disposition"
          required
          value={disposition}
          onChange={(event) => setDisposition(event.target.value)}
          options={DISPOSITION_OPTIONS}
        />

        <TextField
          name="reason"
          label="Reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          required={disposition === "rejected"}
          help="Required for a rejected disposition; recorded on the run and the audit trail."
        />

        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Record disposition
          </Button>
        </div>
        <p style={{ margin: 0, opacity: 0.8 }}>
          A disposition is an approval that the row will not be posted. A posted row cannot be
          dispositioned — correcting it needs a reversal, which is not implemented (`DEC-028`).
        </p>
      </form>
    </SectionCard>
  );
}

/**
 * Posts the run's staged rows into `sales_transaction`/`sales_line`
 * (`SALE-003`/`005`). Only a `validated` or `needs_review` run can post; a run
 * that posts every row becomes `posted` and a partial one `partially_posted`.
 *
 * Posting is **idempotent** on the external transaction/line keys, so pressing it
 * again (or retrying after a failure) reuses the existing rows instead of
 * duplicating them. The optional source system overrides the
 * `sales_transaction.source_system` label; there is no source-system column on
 * the run (recorded open point).
 */
export function PostRunForm({
  runId,
  sourceSystem,
}: {
  readonly runId: string;
  readonly sourceSystem: string;
}) {
  const router = useRouter();
  const [source, setSource] = useState(sourceSystem);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/sales/import-runs/${runId}/post`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(source.trim().length === 0 ? {} : { sourceSystem: source.trim() }),
      });
      const body = (await response.json().catch(() => null)) as {
        readonly postedCount?: number;
        readonly notPostedCount?: number;
      } | null;
      if (!response.ok) {
        setError(await errorMessage(response, POST_FALLBACK));
        return;
      }
      setSuccess(
        `Posted ${body?.postedCount ?? 0} row(s); ${body?.notPostedCount ?? 0} left unposted.`,
      );
      router.refresh();
    } catch {
      setError(POST_FALLBACK);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Post to sales" meta="validated run">
      <form
        onSubmit={submit}
        style={{ display: "flex", flexDirection: "column", gap: spacing[3], maxWidth: 720 }}
      >
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        {success !== null ? <Alert tone="success">{success}</Alert> : null}
        <p style={{ margin: 0, opacity: 0.85 }}>
          Posting writes a <code>sales_transaction</code> and its <code>sales_line</code> rows. It
          is idempotent on the external transaction/line keys, so a replay cannot duplicate a
          transaction. A row that is not mapped stays unposted in the review queue and is covered by
          its disposition.
        </p>
        <TextField
          name="sourceSystem"
          label="Source system"
          value={source}
          onChange={(event) => setSource(event.target.value)}
          help="The sales_transaction.source_system label; defaults to the run's source."
        />
        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Post run
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
