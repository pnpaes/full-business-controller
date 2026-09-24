"use client";

import {
  Alert,
  Button,
  DateField,
  NumberField,
  SectionCard,
  SelectField,
  TextField,
  spacing,
} from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not save. Please try again.";

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

/** Creates one competitor (`DEC-126`); re-registering the same name is a no-op. */
export function NewCompetitorForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (name.trim().length === 0) {
      setError("Give the competitor a name.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/v1/competitors", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), notes: notes.trim().length > 0 ? notes : null }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      setSuccess("Competitor saved. Recording the same name again is a no-op.");
      setName("");
      setNotes("");
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Register a competitor" meta="idempotent on name">
      <form
        onSubmit={submit}
        style={{ display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 640 }}
      >
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        {success !== null ? <Alert tone="success">{success}</Alert> : null}
        <TextField
          name="name"
          label="Competitor name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          help="Registering a name that already exists returns the existing competitor."
        />
        <TextField
          name="notes"
          label="Notes (optional)"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Save competitor
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

/**
 * Captures one competitor observation (`DEC-126`). It always opens **pending** —
 * the form says so and the observation cannot influence the comparison until a
 * reviewer decides it. The observation date is a day; it is sent as the UTC
 * instant that opens that day.
 */
export function RecordObservationForm({
  competitors,
  currency,
}: {
  readonly competitors: readonly { readonly id: string; readonly name: string }[];
  readonly currency: string;
}) {
  const router = useRouter();
  const [competitorId, setCompetitorId] = useState(competitors[0]?.id ?? "");
  const [observedAt, setObservedAt] = useState("");
  const [source, setSource] = useState("");
  const [externalName, setExternalName] = useState("");
  const [itemId, setItemId] = useState("");
  const [price, setPrice] = useState("");
  const [currencyCode, setCurrencyCode] = useState(currency);
  const [sourceUrl, setSourceUrl] = useState("");
  const [offerNotes, setOfferNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (competitorId.length === 0 || observedAt.length === 0) {
      setError("Choose a competitor and an observation date.");
      return;
    }
    if (source.trim().length === 0 || externalName.trim().length === 0) {
      setError("Record where you saw it and what the competitor calls it.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/v1/competitors/observations", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          competitorId,
          observedAt: `${observedAt}T00:00:00.000Z`,
          source: source.trim(),
          externalName: externalName.trim(),
          sourceUrl: sourceUrl.trim().length > 0 ? sourceUrl.trim() : null,
          itemId: itemId.trim().length > 0 ? itemId.trim() : null,
          price: price.trim().length > 0 ? price.trim() : null,
          currency: currencyCode.trim().length > 0 ? currencyCode.trim() : null,
          offerNotes: offerNotes.trim().length > 0 ? offerNotes.trim() : null,
        }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      setSuccess("Recorded as pending. It is not intelligence until a reviewer admits it.");
      setObservedAt("");
      setSource("");
      setExternalName("");
      setItemId("");
      setPrice("");
      setSourceUrl("");
      setOfferNotes("");
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard
      title="Record an observation"
      meta="opens pending · not intelligence until reviewed"
    >
      <form
        onSubmit={submit}
        style={{ display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 720 }}
      >
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        {success !== null ? <Alert tone="success">{success}</Alert> : null}

        <SelectField
          name="competitorId"
          label="Competitor"
          value={competitorId}
          onChange={(event) => setCompetitorId(event.target.value)}
          options={competitors.map((competitor) => ({
            value: competitor.id,
            label: competitor.name,
          }))}
        />
        <DateField
          name="observedAt"
          label="Observed on"
          value={observedAt}
          onChange={(event) => setObservedAt(event.target.value)}
          help="The day the price or offer was seen."
        />
        <TextField
          name="source"
          label="Source"
          required
          value={source}
          onChange={(event) => setSource(event.target.value)}
          help="A receipt, a menu photo, a website, a staff note."
        />
        <TextField
          name="externalName"
          label="What the competitor calls it"
          required
          value={externalName}
          onChange={(event) => setExternalName(event.target.value)}
        />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: spacing[3],
          }}
        >
          <NumberField
            name="price"
            label="Price (optional)"
            unit={currency}
            min="0"
            step="0.01"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
          />
          <TextField
            name="currency"
            label="Currency (optional)"
            value={currencyCode}
            onChange={(event) => setCurrencyCode(event.target.value)}
            help="3-letter ISO code; leave as the organization currency if unsure."
          />
        </div>
        <TextField
          name="itemId"
          label="Comparable item id (optional)"
          value={itemId}
          onChange={(event) => setItemId(event.target.value)}
          help="The item we sell that this offer compares to. Without it the observation is never compared."
        />
        <TextField
          name="sourceUrl"
          label="Source URL (optional)"
          value={sourceUrl}
          onChange={(event) => setSourceUrl(event.target.value)}
        />
        <TextField
          name="offerNotes"
          label="Offer notes (optional)"
          value={offerNotes}
          onChange={(event) => setOfferNotes(event.target.value)}
        />
        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Record as pending
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
