"use client";

import { Alert, Button, SectionCard, TextField, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const APPROVE_FALLBACK = "Could not approve the count. Please try again.";
const CANCEL_FALLBACK = "Could not cancel the count. Please try again.";

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : fallback;
}

export interface ApproveCountFormProps {
  readonly countId: string;
  /** True when at least one line has a positive variance (the cost guard may bite). */
  readonly hasPositiveVariance: boolean;
}

/**
 * Approve action (INV-004, DEC-017): posts every non-zero variance as one atomic
 * `count_adjustment` batch and marks the count approved. A positive variance
 * needs a unit cost; the field is offered when one is likely and the server is
 * the authority either way (the item `current_cost` fallback is provisional — see
 * the slice-9 open points).
 */
export function ApproveCountForm({ countId, hasPositiveVariance }: ApproveCountFormProps) {
  const router = useRouter();
  const [unitCost, setUnitCost] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/counts/${countId}/approve`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(unitCost.trim().length === 0 ? {} : { unitCost: unitCost.trim() }),
          ...(reasonCode.trim().length === 0 ? {} : { reasonCode: reasonCode.trim() }),
        }),
      });
      if (!response.ok) {
        setError(await errorMessage(response, APPROVE_FALLBACK));
        return;
      }
      const body = (await response.json()) as { varianceCount?: number };
      setSuccess(
        `Approved. ${body.varianceCount ?? 0} ${
          body.varianceCount === 1 ? "variance was" : "variances were"
        } posted to the ledger.`,
      );
      router.refresh();
    } catch {
      setError(APPROVE_FALLBACK);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Approve" meta="post variances">
      <form
        onSubmit={submit}
        style={{ display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 640 }}
      >
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        {success !== null ? <Alert tone="success">{success}</Alert> : null}

        <p style={{ margin: 0 }}>
          Approving posts one <strong>count adjustment</strong> movement per non-zero variance and
          marks the count approved. It is not reversible by editing — a correction is a reversal
          (DEC-028).
        </p>

        <TextField
          name="unitCost"
          label="Unit cost for positive variances"
          inputMode="decimal"
          value={unitCost}
          onChange={(event) => setUnitCost(event.target.value)}
          placeholder="0.0000"
          required={hasPositiveVariance}
          help={
            hasPositiveVariance
              ? "Required for stock found above the book quantity. Falls back to the item's current cost when left blank."
              : "Only needed when stock is found above the book quantity."
          }
        />

        <TextField
          name="reasonCode"
          label="Reason"
          value={reasonCode}
          onChange={(event) => setReasonCode(event.target.value)}
          placeholder="e.g. cycle count"
          help='Recorded on every posted movement and the audit trail. Defaults to "count adjustment".'
        />

        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Approve and post variances
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

/** Cancel action: an approved count cannot be cancelled (its movements are posted). */
export function CancelCountButton({ countId }: { readonly countId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function cancel(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/counts/${countId}/cancel`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        setError(await errorMessage(response, CANCEL_FALLBACK));
        return;
      }
      router.refresh();
    } catch {
      setError(CANCEL_FALLBACK);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}>
      {error !== null ? <Alert tone="danger">{error}</Alert> : null}
      <div>
        <Button variant="secondary" onClick={cancel} loading={busy} disabled={busy}>
          Cancel count
        </Button>
      </div>
    </div>
  );
}
