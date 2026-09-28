"use client";

import {
  Alert,
  Button,
  NumberField,
  SectionCard,
  SelectField,
  TextField,
  spacing,
} from "@aquarela/ui";
import { parseDecimal } from "@aquarela/domain/decimal";
import { QUANTITY_SCALE } from "@aquarela/domain/quantity";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { FormEvent } from "react";

const LIFECYCLE_FALLBACK = "Could not update the batch. Please try again.";
const COMPLETE_FALLBACK = "Could not complete the batch. Please try again.";

/** `production_batch.actual_labour_hours` is `numeric(9,2)` (DEC-124). */
const HOURS_SCALE = 2;

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : fallback;
}

export interface BatchAreaOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

/**
 * Release / start / cancel actions for a batch that has not completed
 * (`PROD-001`). Each is a single POST to the corresponding lifecycle route; the
 * application command is the authority on which transition is allowed, so the
 * buttons offered here mirror the status but a rejected transition still returns
 * a 400 rather than being silently accepted.
 */
export function BatchLifecycleActions({
  batchId,
  status,
}: {
  readonly batchId: string;
  readonly status: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (status === "completed" || status === "cancelled") {
    return null;
  }

  async function post(action: string, body: Record<string, unknown>): Promise<void> {
    setError(null);
    setBusy(action);
    try {
      const response = await fetch(`/api/v1/production/batches/${batchId}/${action}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setError(await errorMessage(response, LIFECYCLE_FALLBACK));
        return;
      }
      router.refresh();
    } catch {
      setError(LIFECYCLE_FALLBACK);
    } finally {
      setBusy(null);
    }
  }

  return (
    <SectionCard title="Batch actions" meta="lifecycle">
      <div style={{ display: "flex", flexDirection: "column", gap: spacing[3] }}>
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[3] }}>
          {status === "planned" ? (
            <Button
              onClick={() => post("release", {})}
              loading={busy === "release"}
              disabled={busy !== null}
            >
              Release batch
            </Button>
          ) : null}
          {status === "released" ? (
            <Button
              onClick={() => post("start", {})}
              loading={busy === "start"}
              disabled={busy !== null}
            >
              Start batch
            </Button>
          ) : null}
          <Button
            variant="secondary"
            onClick={() => post("cancel", { reason: "cancelled from the batch screen" })}
            loading={busy === "cancel"}
            disabled={busy !== null}
          >
            Cancel batch
          </Button>
        </div>
        <p style={{ margin: 0, opacity: 0.8 }}>
          Releasing moves a planned batch into the queue; starting stamps the actual start and
          allows completion. Cancelling keeps the record for audit — nothing is posted to the ledger
          before completion, so there is nothing to reverse.
        </p>
      </div>
    </SectionCard>
  );
}

export interface CompleteInputLineOption {
  readonly itemId: string;
  readonly label: string;
  readonly unitCode: string | null;
  readonly plannedQty: string;
}

export interface CompleteOutputOption {
  readonly itemId: string;
  readonly label: string;
  readonly unitCode: string | null;
  readonly plannedQty: string;
}

export interface CompleteBatchFormProps {
  readonly batchId: string;
  readonly inputs: readonly CompleteInputLineOption[];
  readonly output: CompleteOutputOption;
  readonly areas: readonly BatchAreaOption[];
}

/**
 * Completion form (08_UI_UX.md §8.3, §8.6): actual quantities per planned input
 * (with a reason whenever the actual differs) plus the actual output, lot and
 * expiry, and the storage area the inputs are **drawn** from. There is no
 * WIP/source-draw area on the batch (open point (e)), so the draw area is an
 * explicit choice here, and the batch's own destination receives the output.
 */
export function CompleteBatchForm({ batchId, inputs, output, areas }: CompleteBatchFormProps) {
  const router = useRouter();
  const plannedByItem = useMemo(
    () => new Map(inputs.map((line) => [line.itemId, line.plannedQty])),
    [inputs],
  );
  const [actualInputs, setActualInputs] = useState<Record<string, string>>(() =>
    Object.fromEntries(inputs.map((line) => [line.itemId, line.plannedQty])),
  );
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [outputQty, setOutputQty] = useState(output.plannedQty);
  const [outputLotId, setOutputLotId] = useState("");
  const [outputExpiry, setOutputExpiry] = useState("");
  const [actualLabourHours, setActualLabourHours] = useState("");
  const [inputStorageAreaId, setInputStorageAreaId] = useState(areas[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (areas.length === 0) {
    return (
      <SectionCard title="Complete batch" meta="post consumption and output">
        <Alert tone="warning">
          Completing needs a storage area at this location to draw the inputs from. Register a
          storage area first, then complete the batch.
        </Alert>
      </SectionCard>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const payloadInputs: { itemId: string; actualQty: string; reasonCode?: string }[] = [];
    for (const line of inputs) {
      const raw = (actualInputs[line.itemId] ?? "").trim();
      if (raw.length === 0) {
        setError(`Enter the actual quantity for ${line.label}.`);
        return;
      }
      let scaled: bigint;
      try {
        scaled = parseDecimal(raw, QUANTITY_SCALE);
      } catch {
        setError(`"${line.label}" is not a valid quantity.`);
        return;
      }
      if (scaled < 0n) {
        setError(`"${line.label}" cannot be negative.`);
        return;
      }
      const planned = parseDecimal(plannedByItem.get(line.itemId) ?? "0", QUANTITY_SCALE);
      const reason = (reasons[line.itemId] ?? "").trim();
      if (scaled !== planned && reason.length === 0) {
        setError(
          `A reason is required when the actual for ${line.label} differs from the planned quantity.`,
        );
        return;
      }
      payloadInputs.push({
        itemId: line.itemId,
        actualQty: raw,
        ...(reason.length === 0 ? {} : { reasonCode: reason }),
      });
    }

    let outputScaled: bigint;
    try {
      outputScaled = parseDecimal(outputQty.trim(), QUANTITY_SCALE);
    } catch {
      setError("Enter a valid actual output quantity.");
      return;
    }
    if (outputScaled <= 0n) {
      setError("The actual output quantity must be greater than zero.");
      return;
    }

    const hoursRaw = actualLabourHours.trim();
    if (hoursRaw.length > 0) {
      let hoursScaled: bigint;
      try {
        hoursScaled = parseDecimal(hoursRaw, HOURS_SCALE);
      } catch {
        setError("Enter the actual labour hours as a number with at most 2 decimal places.");
        return;
      }
      if (hoursScaled < 0n) {
        setError("Actual labour hours cannot be negative.");
        return;
      }
    }

    setBusy(true);
    try {
      const response = await fetch(`/api/v1/production/batches/${batchId}/complete`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actualFinish: new Date().toISOString(),
          inputStorageAreaId,
          inputs: payloadInputs,
          output: {
            itemId: output.itemId,
            actualQty: outputQty.trim(),
            ...(outputLotId.trim().length === 0 ? {} : { lotId: outputLotId.trim() }),
            ...(outputExpiry.trim().length === 0 ? {} : { expiryDate: outputExpiry.trim() }),
          },
          ...(hoursRaw.length === 0 ? {} : { actualLabourHours: hoursRaw }),
        }),
      });
      if (!response.ok) {
        setError(await errorMessage(response, COMPLETE_FALLBACK));
        return;
      }
      const body = (await response.json()) as {
        yieldVariancePct?: string;
        replayed?: boolean;
      };
      setSuccess(
        `Completed${body.replayed === true ? " (already completed)" : ""}. Inputs are consumed and the output is posted to stock.`,
      );
      router.refresh();
    } catch {
      setError(COMPLETE_FALLBACK);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Complete batch" meta="post consumption and output">
      <form
        onSubmit={submit}
        style={{ display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 720 }}
      >
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        {success !== null ? <Alert tone="success">{success}</Alert> : null}

        <SelectField
          name="inputStorageAreaId"
          label="Draw inputs from"
          required
          value={inputStorageAreaId}
          onChange={(event) => setInputStorageAreaId(event.target.value)}
          options={areas.map((area) => ({
            value: area.id,
            label: `${area.code} · ${area.name}`,
          }))}
          help="The storage area the input quantities are consumed from."
        />

        {inputs.length === 0 ? (
          <Alert tone="info">
            This recipe has no input components, so only the output is recorded.
          </Alert>
        ) : (
          inputs.map((line) => {
            const planned = parseDecimal(plannedByItem.get(line.itemId) ?? "0", QUANTITY_SCALE);
            const actualRaw = (actualInputs[line.itemId] ?? "").trim();
            let differs = false;
            if (actualRaw.length > 0) {
              try {
                differs = parseDecimal(actualRaw, QUANTITY_SCALE) !== planned;
              } catch {
                differs = false;
              }
            }
            return (
              <div
                key={line.itemId}
                style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}
              >
                <NumberField
                  name={`actual-${line.itemId}`}
                  label={`${line.label} · planned ${line.plannedQty}`}
                  min="0"
                  step="0.001"
                  required
                  value={actualInputs[line.itemId] ?? ""}
                  onChange={(event) =>
                    setActualInputs((current) => ({
                      ...current,
                      [line.itemId]: event.target.value,
                    }))
                  }
                  {...(line.unitCode === null ? {} : { unit: line.unitCode })}
                  help="The actual quantity consumed, in the item's base unit."
                />
                {differs ? (
                  <TextField
                    name={`reason-${line.itemId}`}
                    label={`Reason for the variance on ${line.label}`}
                    required
                    value={reasons[line.itemId] ?? ""}
                    onChange={(event) =>
                      setReasons((current) => ({ ...current, [line.itemId]: event.target.value }))
                    }
                    placeholder="e.g. over-pour, spillage"
                    help="Required when the actual differs from the planned quantity."
                  />
                ) : null}
              </div>
            );
          })
        )}

        <NumberField
          name="outputQty"
          label={`Actual output · ${output.label}`}
          min="0.001"
          step="0.001"
          required
          value={outputQty}
          onChange={(event) => setOutputQty(event.target.value)}
          {...(output.unitCode === null ? {} : { unit: output.unitCode })}
          help={`Planned output ${output.plannedQty}. Consumption is valued at the locked moving average cost, and the output's unit cost is derived from it.`}
        />

        <NumberField
          name="actualLabourHours"
          label="Actual labour hours"
          min="0"
          step="0.01"
          value={actualLabourHours}
          onChange={(event) => setActualLabourHours(event.target.value)}
          unit="hours"
          help="Optional. The hours actually worked on this batch; the batch cost uses them with the hourly rate. Leave blank to record none."
        />

        <TextField
          name="outputLotId"
          label="Output lot id"
          value={outputLotId}
          onChange={(event) => setOutputLotId(event.target.value)}
          placeholder="Existing stock lot UUID (optional)"
          help="Optional. Must be an existing lot id; the form does not create lots."
        />

        <TextField
          name="outputExpiry"
          type="date"
          label="Output expiry date"
          value={outputExpiry}
          onChange={(event) => setOutputExpiry(event.target.value)}
          help="Optional. Recorded on the output line for shelf-life tracking."
        />

        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Complete and post
          </Button>
        </div>
        <p style={{ margin: 0, opacity: 0.8 }}>
          Completion posts one atomic movement batch — consumption negative, output positive — and
          cannot be edited. A mistake is corrected by a reversal, never by editing the batch.
        </p>
      </form>
    </SectionCard>
  );
}
