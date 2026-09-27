"use client";

import { Alert, Button, Modal, SelectField, TextField, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const REGISTER_FALLBACK = "Could not register the source. Please try again.";
const TERMS_FALLBACK = "Could not record the terms decision. Please try again.";
const DEACTIVATE_FALLBACK = "Could not deactivate the source. Please try again.";

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : fallback;
}

const SOURCE_TYPE_OPTIONS = [
  { value: "website", label: "Website" },
  { value: "wolt", label: "Wolt" },
  { value: "instagram_manual", label: "Instagram (manual only)" },
  { value: "other", label: "Other" },
];

const COLLECTION_MODE_OPTIONS = [
  { value: "manual", label: "Manual" },
  { value: "automated", label: "Automated (requires approved terms)" },
];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Registers one competitor source (`ADR-0010`/`DEC-143`, `DEC-149`). A `manual`
 * source opens `pending`; an `automated` source registers already approved, so
 * that path is offered only to the terms roles (`owner`/`admin`) — the server
 * and the DB check are the authority.
 */
export function RegisterSourceForm({
  canRegisterAutomated,
}: {
  readonly canRegisterAutomated: boolean;
}) {
  const router = useRouter();
  const [competitorName, setCompetitorName] = useState("");
  const [sourceType, setSourceType] = useState("website");
  const [urlOrIdentifier, setUrlOrIdentifier] = useState("");
  const [collectionMode, setCollectionMode] = useState("manual");
  const [rateLimitNote, setRateLimitNote] = useState("");
  const [activeFrom, setActiveFrom] = useState(today());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const response = await fetch("/api/v1/competitors/sources", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          competitorName: competitorName.trim(),
          sourceType,
          urlOrIdentifier: urlOrIdentifier.trim(),
          collectionMode,
          ...(rateLimitNote.trim().length === 0 ? {} : { rateLimitNote: rateLimitNote.trim() }),
          activeFrom,
        }),
      });
      if (!response.ok) {
        setError(await errorMessage(response, REGISTER_FALLBACK));
        return;
      }
      setNotice(
        collectionMode === "automated"
          ? "Automated source registered with approved terms — collection stays disabled until the kill switch is on."
          : "Source registered as pending terms — a terms decision is required before it can be collected.",
      );
      setCompetitorName("");
      setUrlOrIdentifier("");
      setRateLimitNote("");
      router.refresh();
    } catch {
      setError(REGISTER_FALLBACK);
    } finally {
      setBusy(false);
    }
  }

  const automatedBlocked = collectionMode === "automated" && !canRegisterAutomated;

  return (
    <form
      onSubmit={submit}
      style={{ display: "flex", flexDirection: "column", gap: spacing[3], minWidth: 0 }}
    >
      {notice !== null ? <Alert tone="success">{notice}</Alert> : null}
      {error !== null ? <Alert tone="danger">{error}</Alert> : null}
      <TextField
        name="competitorName"
        label="Competitor name"
        required
        value={competitorName}
        onChange={(event) => setCompetitorName(event.target.value)}
        placeholder="e.g. Example Café"
      />
      <SelectField
        name="sourceType"
        label="Source type"
        options={SOURCE_TYPE_OPTIONS}
        value={sourceType}
        onChange={(event) => setSourceType(event.target.value)}
      />
      <TextField
        name="urlOrIdentifier"
        label="URL or identifier"
        required
        value={urlOrIdentifier}
        onChange={(event) => setUrlOrIdentifier(event.target.value)}
        placeholder="https://example.no/menu"
        help="One source per URL in the organization."
      />
      <SelectField
        name="collectionMode"
        label="Collection mode"
        options={
          canRegisterAutomated
            ? COLLECTION_MODE_OPTIONS
            : COLLECTION_MODE_OPTIONS.filter((option) => option.value !== "automated")
        }
        value={collectionMode}
        onChange={(event) => setCollectionMode(event.target.value)}
        help="Automated collection is permitted only with approved terms (DEC-143)."
      />
      <TextField
        name="rateLimitNote"
        label="Rate-limit note (optional)"
        value={rateLimitNote}
        onChange={(event) => setRateLimitNote(event.target.value)}
        placeholder="e.g. robots allows /menu; 1 req/s"
      />
      <TextField
        name="activeFrom"
        label="Active from"
        required
        value={activeFrom}
        onChange={(event) => setActiveFrom(event.target.value)}
        help="ISO date (YYYY-MM-DD)."
      />
      <div>
        <Button type="submit" loading={busy} disabled={busy || automatedBlocked}>
          Register source
        </Button>
      </div>
    </form>
  );
}

type SourceAction = "approve-terms" | "reject-terms" | "deactivate";

const ACTION_COPY: Record<SourceAction, { title: string; body: string; confirm: string }> = {
  "approve-terms": {
    title: "Approve this source's terms?",
    body: "Approving permits automated collection for this source once the collector is enabled. It does not start collection now.",
    confirm: "Approve terms",
  },
  "reject-terms": {
    title: "Reject this source's terms?",
    body: "Rejecting records that automation is not permitted for this source; it stays manual.",
    confirm: "Reject terms",
  },
  deactivate: {
    title: "Deactivate this source?",
    body: "The source stops being active from the chosen date and is no longer collected or shown as active.",
    confirm: "Deactivate",
  },
};

/**
 * Per-row terms/deactivate controls (`ADR-0010`, `DEC-149`). Terms decisions
 * are a higher bar (`owner`/`admin`); deactivation follows the write roles. The
 * server is the authority, so a rejected action surfaces its message.
 */
export function CompetitorSourceActions({
  sourceId,
  termsStatus,
  activeTo,
  canManageTerms,
  canWrite,
}: {
  readonly sourceId: string;
  readonly termsStatus: string;
  readonly activeTo: string | null;
  readonly canManageTerms: boolean;
  readonly canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<SourceAction | null>(null);
  const [activeToValue, setActiveToValue] = useState(today());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const showTerms = canManageTerms && termsStatus === "pending";
  const showDeactivate = canWrite && activeTo === null;
  if (!showTerms && !showDeactivate) {
    return <span aria-hidden="true">—</span>;
  }

  async function run(action: SourceAction): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    const fallback = action === "deactivate" ? DEACTIVATE_FALLBACK : TERMS_FALLBACK;
    try {
      const response = await fetch(`/api/v1/competitors/sources/${sourceId}/${action}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "deactivate" ? { activeTo: activeToValue } : {}),
      });
      if (!response.ok) {
        setError(await errorMessage(response, fallback));
        return;
      }
      setNotice(
        action === "approve-terms"
          ? "Terms approved — automated collection is permitted once the collector is enabled."
          : action === "reject-terms"
            ? "Terms rejected — the source stays manual."
            : "Source deactivated.",
      );
      setPending(null);
      router.refresh();
    } catch {
      setError(fallback);
    } finally {
      setBusy(false);
    }
  }

  const copy = pending === null ? null : ACTION_COPY[pending];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[2], minWidth: 200 }}>
      {notice !== null ? <Alert tone="success">{notice}</Alert> : null}
      {error !== null ? <Alert tone="danger">{error}</Alert> : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2] }}>
        {showTerms ? (
          <>
            <Button onClick={() => setPending("approve-terms")}>Approve terms</Button>
            <Button variant="secondary" onClick={() => setPending("reject-terms")}>
              Reject terms
            </Button>
          </>
        ) : null}
        {showDeactivate ? (
          <Button variant="secondary" onClick={() => setPending("deactivate")}>
            Deactivate
          </Button>
        ) : null}
      </div>

      <Modal
        title={copy?.title ?? ""}
        open={pending !== null}
        onClose={() => (busy ? undefined : setPending(null))}
      >
        {copy === null || pending === null ? null : (
          <div style={{ display: "flex", flexDirection: "column", gap: spacing[3] }}>
            <p style={{ margin: 0 }}>{copy.body}</p>
            {pending === "deactivate" ? (
              <TextField
                name={`source-active-to-${sourceId}`}
                label="Active to"
                required
                value={activeToValue}
                onChange={(event) => setActiveToValue(event.target.value)}
                help="ISO date (YYYY-MM-DD), after the source's active-from date."
              />
            ) : null}
            <div style={{ display: "flex", gap: spacing[2], justifyContent: "flex-end" }}>
              <Button variant="secondary" onClick={() => setPending(null)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={() => void run(pending)} loading={busy} disabled={busy}>
                {copy.confirm}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
