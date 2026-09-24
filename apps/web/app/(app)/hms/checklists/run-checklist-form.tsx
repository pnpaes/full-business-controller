"use client";

import {
  Alert,
  Button,
  SectionCard,
  SelectField,
  TextareaField,
  StatusPill,
  color,
  radius,
  spacing,
  typography,
} from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { FormEvent } from "react";

import { checklistOutcomeView, type ChecklistItem } from "../hms-labels";

const FALLBACK_ERROR = "Could not record the run. Please try again.";

export interface RunTemplateOption {
  readonly id: string;
  readonly name: string;
  readonly categoryLabel: string;
  readonly items: readonly ChecklistItem[];
}

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

const outcomeButton = (active: boolean) =>
  ({
    minHeight: 44,
    minWidth: 64,
    border: "1px solid currentColor",
    borderRadius: radius.md,
    background: active ? color.surface.muted : "transparent",
    fontWeight: active ? typography.fontWeight.semibold : typography.fontWeight.regular,
    cursor: "pointer",
  }) as const;

type Outcome = "pass" | "fail" | "not_applicable";

/**
 * Walks a checklist template (`HMS-005`, `DEC-091`, `DEC-096`): pick the
 * template and location, answer each item pass / fail / not-applicable with a
 * large touch target, capture a note on a non-conformity, and submit the run as
 * `completed` with the run instant at submission. A `fail` is the
 * non-conformity capture; the backend records no automatic incident link
 * (`DEC-096` keeps the shapes provisional), so a fail is surfaced in the run
 * history for follow-up.
 */
export function RunChecklistForm({
  templates,
  locations,
}: {
  readonly templates: readonly RunTemplateOption[];
  readonly locations: readonly { readonly id: string; readonly label: string }[];
}) {
  const router = useRouter();
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [failNotes, setFailNotes] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const template = templates.find((candidate) => candidate.id === templateId) ?? templates[0];
  const items = useMemo(() => template?.items ?? [], [template]);
  const answeredCount = items.filter((item) => outcomes[item.key] !== undefined).length;
  const failCount = items.filter((item) => outcomes[item.key] === "fail").length;

  if (templates.length === 0 || locations.length === 0) {
    return (
      <SectionCard title="Run a checklist" meta="question flow">
        <Alert tone="info">
          {templates.length === 0
            ? "No active checklist template exists yet. Register one through the API (owner, general manager or admin)."
            : "There is no location in your scope yet, so a run cannot be recorded."}
        </Alert>
      </SectionCard>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (template === undefined || locationId.length === 0) {
      setError("Choose a template and a location.");
      return;
    }
    const missingRequired = items.filter(
      (item) => item.required && outcomes[item.key] === undefined,
    );
    if (missingRequired.length > 0) {
      const first = missingRequired[0];
      if (first === undefined) {
        return;
      }
      setError(
        `Answer every required item (${missingRequired.length} still unanswered, e.g. "${first.label}"). A completed run may omit optional items (DEC-096).`,
      );
      return;
    }

    const results = items
      .filter((item) => outcomes[item.key] !== undefined)
      .map((item) => {
        const outcome = outcomes[item.key];
        const note = failNotes[item.key]?.trim();
        return {
          key: item.key,
          outcome: outcome as Outcome,
          ...(outcome === "fail" && note !== undefined && note.length > 0 ? { note } : {}),
        };
      });

    setBusy(true);
    try {
      const response = await fetch("/api/v1/hms/checklist-runs", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: template.id,
          locationId,
          runAt: new Date().toISOString(),
          status: "completed",
          results,
          notes: notes.trim().length > 0 ? notes.trim() : null,
        }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      setSuccess(
        failCount > 0
          ? `Run recorded with ${failCount} non-conformit${failCount === 1 ? "y" : "ies"}. Follow up in the incidents register.`
          : "Run recorded — all answered items passed.",
      );
      setOutcomes({});
      setFailNotes({});
      setNotes("");
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard
      title="Run a checklist"
      meta={`${answeredCount}/${items.length} answered · ${failCount} failing`}
    >
      <form
        onSubmit={submit}
        style={{ display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 720 }}
      >
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        {success !== null ? <Alert tone="success">{success}</Alert> : null}

        <SelectField
          name="templateId"
          label="Template"
          required
          value={templateId === "" ? (templates[0]?.id ?? "") : templateId}
          onChange={(event) => {
            setTemplateId(event.target.value);
            setOutcomes({});
            setFailNotes({});
          }}
          options={templates.map((candidate) => ({
            value: candidate.id,
            label: `${candidate.name} · ${candidate.categoryLabel}`,
          }))}
        />
        <SelectField
          name="locationId"
          label="Location"
          required
          value={locationId}
          onChange={(event) => setLocationId(event.target.value)}
          options={locations.map((location) => ({ value: location.id, label: location.label }))}
        />

        <ol
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: spacing[3],
          }}
        >
          {items.map((item, index) => (
            <li
              key={item.key}
              style={{
                border: `1px solid ${color.border.default}`,
                borderRadius: radius.lg,
                padding: spacing[3],
                display: "flex",
                flexDirection: "column",
                gap: spacing[2],
              }}
            >
              <div style={{ display: "flex", gap: spacing[2], alignItems: "baseline" }}>
                <span style={{ fontWeight: typography.fontWeight.semibold }}>
                  {index + 1}. {item.label}
                </span>
                {item.required ? <StatusPill tone="warning">Required</StatusPill> : null}
              </div>
              <div style={{ display: "flex", gap: spacing[2], flexWrap: "wrap" }}>
                {(["pass", "fail", "not_applicable"] as const).map((outcome) => {
                  const view = checklistOutcomeView(outcome);
                  return (
                    <button
                      key={outcome}
                      type="button"
                      aria-pressed={outcomes[item.key] === outcome}
                      style={outcomeButton(outcomes[item.key] === outcome)}
                      onClick={() =>
                        setOutcomes((previous) => ({ ...previous, [item.key]: outcome }))
                      }
                    >
                      {view.label}
                    </button>
                  );
                })}
              </div>
              {outcomes[item.key] === "fail" ? (
                <TextareaField
                  name={`note-${item.key}`}
                  label="What went wrong (non-conformity note)"
                  value={failNotes[item.key] ?? ""}
                  onChange={(event) =>
                    setFailNotes((previous) => ({ ...previous, [item.key]: event.target.value }))
                  }
                />
              ) : null}
            </li>
          ))}
        </ol>

        <TextareaField
          name="notes"
          label="Run notes (optional)"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />

        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Complete run
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
