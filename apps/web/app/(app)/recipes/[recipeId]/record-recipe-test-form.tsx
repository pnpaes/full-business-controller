"use client";

import {
  Alert,
  Button,
  DateField,
  FormActions,
  NumberField,
  TextField,
  TextareaField,
  spacing,
} from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not record the test. Check the values and try again.";

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Records one `DEC-123` trial for a recipe version: posts
 * `{ recipeVersionId, testedAt, batchInputQty, …observed }` to
 * `POST /api/v1/recipes/[id]/tests`. The route is same-origin and session-guarded
 * and the command owns the domain rules (positivity, non-negativity, trimming),
 * so this only collects values; a blank optional field is omitted rather than
 * sent (the API rejects an empty observed quantity). On success the page refresh
 * shows the new append-only trial.
 */
export function RecordRecipeTestForm({
  recipeId,
  recipeVersionId,
}: {
  readonly recipeId: string;
  readonly recipeVersionId: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const data = new FormData(formElement);

    const testedAt = field(data, "testedAt");
    const batchInputQty = field(data, "batchInputQty");
    const actualOutputQty = field(data, "actualOutputQty");
    const actualDurationMinutes = field(data, "actualDurationMinutes");
    const actualCost = field(data, "actualCost");
    const currency = field(data, "currency");
    const qualityComments = field(data, "qualityComments");
    const proposedAdjustment = field(data, "proposedAdjustment");

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/recipes/${recipeId}/tests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipeVersionId,
          testedAt,
          batchInputQty,
          ...(actualOutputQty.length === 0 ? {} : { actualOutputQty }),
          ...(actualDurationMinutes.length === 0
            ? {}
            : { actualDurationMinutes: Number(actualDurationMinutes) }),
          ...(actualCost.length === 0 ? {} : { actualCost }),
          ...(currency.length === 0 ? {} : { currency }),
          ...(qualityComments.length === 0 ? {} : { qualityComments }),
          ...(proposedAdjustment.length === 0 ? {} : { proposedAdjustment }),
        }),
      });
      if (!response.ok) {
        setError(FALLBACK_ERROR);
        return;
      }
      formElement.reset();
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      aria-label="Record a recipe test"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: spacing[3],
        alignItems: "start",
      }}
    >
      {error !== null ? (
        <div style={{ gridColumn: "1 / -1" }}>
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}
      <DateField name="testedAt" label="Tested on" required disabled={busy} />
      <NumberField
        name="batchInputQty"
        label="Batch input"
        required
        min={0}
        step="0.000001"
        disabled={busy}
        help="Positive. The recipe's planned input quantity for the batch."
      />
      <NumberField
        name="actualOutputQty"
        label="Actual output"
        min={0}
        step="0.000001"
        disabled={busy}
        help="Optional. The measured usable output."
      />
      <NumberField
        name="actualDurationMinutes"
        label="Duration"
        min={0}
        step={1}
        disabled={busy}
        help="Optional, whole minutes."
      />
      <NumberField
        name="actualCost"
        label="Actual cost"
        min={0}
        step="0.0001"
        disabled={busy}
        help="Optional. An observed, illustrative figure — not a computed verified cost."
      />
      <TextField
        name="currency"
        label="Currency"
        disabled={busy}
        help="Optional three-letter code, e.g. NOK."
      />
      <TextareaField
        name="qualityComments"
        label="Quality comments"
        rows={2}
        disabled={busy}
        help="Sensory and process observations."
      />
      <TextareaField
        name="proposedAdjustment"
        label="Proposed adjustment"
        rows={2}
        disabled={busy}
        help="What the next version should change."
      />
      <FormActions>
        <Button type="submit" loading={busy} disabled={busy}>
          Record test
        </Button>
      </FormActions>
    </form>
  );
}
