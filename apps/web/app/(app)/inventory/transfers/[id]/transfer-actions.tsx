"use client";

import {
  Alert,
  Button,
  SectionCard,
  SelectField,
  TextField,
  TextareaField,
  spacing,
} from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not complete the action. Please try again.";

export interface TransferActionItemOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly unitCode: string | null;
}

export interface TransferActionLineOption {
  readonly itemId: string;
  readonly itemCode: string | null;
  readonly itemName: string | null;
  readonly unitCode: string | null;
  readonly lotId: string | null;
  readonly dispatchedQuantity: string;
}

export interface TransferActionsProps {
  readonly transferId: string;
  readonly status: string;
  readonly items: readonly TransferActionItemOption[];
  readonly dispatchedLines: readonly TransferActionLineOption[];
}

interface ErrorBody {
  readonly error?: string;
}

interface DispatchLineDraft {
  readonly key: number;
  readonly itemId: string;
  readonly quantity: string;
}

function lineKey(itemId: string, lotId: string | null): string {
  return `${itemId}\u0000${lotId ?? ""}`;
}

function lineLabel(line: TransferActionLineOption): string {
  const name = line.itemName ?? line.itemCode ?? line.itemId;
  return line.lotId === null ? name : `${name} · lot ${line.lotId}`;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

/**
 * The transfer workflow actions (08_UI_UX.md §8.3, §8.5, §8.6): approve, cancel,
 * dispatch (with the item lines, since there is no line table) and receive (with
 * the received quantities and a discrepancy note). The actor and organization
 * are the server's; every action is explicit and server-confirmed. Mobile-first
 * with ≥44px targets and single-column forms.
 */
export function TransferActions({
  transferId,
  status,
  items,
  dispatchedLines,
}: TransferActionsProps) {
  const router = useRouter();
  const nextKey = useRef(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [dispatchLines, setDispatchLines] = useState<readonly DispatchLineDraft[]>([
    { key: 0, itemId: "", quantity: "" },
  ]);
  const [cancelReason, setCancelReason] = useState("");
  const [received, setReceived] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      dispatchedLines.map((line) => [lineKey(line.itemId, line.lotId), line.dispatchedQuantity]),
    ),
  );
  const [note, setNote] = useState("");

  async function post(path: string, body?: Record<string, unknown>): Promise<boolean> {
    setError(null);
    setSuccess(null);
    setBusy(path);
    try {
      const response = await fetch(`/api/v1/transfers/${transferId}/${path}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError(FALLBACK_ERROR);
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function approve(): Promise<void> {
    if (await post("approve")) {
      setSuccess("Approved. Dispatch it when the goods leave the source.");
    }
  }

  async function cancel(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (
      await post("cancel", cancelReason.trim().length === 0 ? {} : { reasonCode: cancelReason })
    ) {
      setSuccess("Cancelled.");
    }
  }

  async function dispatch(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const lines = dispatchLines
      .filter((line) => line.itemId !== "" && line.quantity.trim().length > 0)
      .map((line) => ({ itemId: line.itemId, quantity: line.quantity.trim() }));
    if (lines.length === 0) {
      setError("Add at least one item and quantity to dispatch.");
      return;
    }
    if (await post("dispatch", { lines })) {
      setSuccess("Dispatched. Stock is now held in transit until it is received.");
    }
  }

  async function receive(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const receivedLines = dispatchedLines
      .map((line) => ({
        itemId: line.itemId,
        lotId: line.lotId,
        quantity: (received[lineKey(line.itemId, line.lotId)] ?? "").trim(),
      }))
      .filter((line) => line.quantity.length > 0);
    if (receivedLines.length === 0) {
      setError("Enter at least one received quantity.");
      return;
    }
    if (await post("receive", { received: receivedLines, discrepancyNote: note })) {
      setSuccess(
        "Received. Any difference from the dispatched quantity is recorded as a discrepancy.",
      );
    }
  }

  function updateLine(key: number, patch: Partial<DispatchLineDraft>): void {
    setDispatchLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }

  const itemOptions = items.map((item) => ({
    value: item.id,
    label: `${item.code} · ${item.name}`,
  }));

  return (
    <SectionCard title="Workflow" meta={status}>
      <div style={{ display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 720 }}>
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        {success !== null ? <Alert tone="success">{success}</Alert> : null}

        {status === "requested" ? (
          <div style={{ display: "flex", gap: spacing[3], flexWrap: "wrap" }}>
            <Button
              type="button"
              loading={busy === "approve"}
              disabled={busy !== null}
              onClick={approve}
            >
              Approve transfer
            </Button>
          </div>
        ) : null}

        {status === "approved" ? (
          <form
            onSubmit={dispatch}
            style={{ display: "flex", flexDirection: "column", gap: spacing[4] }}
          >
            <p style={{ margin: 0 }}>
              Choose the items and quantities leaving the source. Each line posts a source → transit
              pair valued at the moving average.
            </p>
            {items.length === 0 ? (
              <Alert tone="info">No stocked items are available to dispatch.</Alert>
            ) : null}
            {dispatchLines.map((line) => (
              <div
                key={line.key}
                style={{
                  display: "flex",
                  gap: spacing[3],
                  alignItems: "flex-end",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ flex: "1 1 260px" }}>
                  <SelectField
                    name={`item-${line.key}`}
                    label="Item"
                    required
                    placeholder="Select an item"
                    value={line.itemId}
                    onChange={(event) => updateLine(line.key, { itemId: event.target.value })}
                    options={itemOptions}
                  />
                </div>
                <div style={{ flex: "1 1 160px" }}>
                  <TextField
                    name={`quantity-${line.key}`}
                    label="Quantity"
                    inputMode="decimal"
                    value={line.quantity}
                    onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                    placeholder="0.000"
                  />
                </div>
                {dispatchLines.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() =>
                      setDispatchLines((current) => current.filter((row) => row.key !== line.key))
                    }
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
            ))}
            <div style={{ display: "flex", gap: spacing[3], flexWrap: "wrap" }}>
              <Button
                type="button"
                variant="secondary"
                disabled={busy !== null}
                onClick={() =>
                  setDispatchLines((current) => [
                    ...current,
                    { key: nextKey.current++, itemId: "", quantity: "" },
                  ])
                }
              >
                Add line
              </Button>
              <Button type="submit" loading={busy === "dispatch"} disabled={busy !== null}>
                Dispatch transfer
              </Button>
            </div>
          </form>
        ) : null}

        {status === "dispatched" ? (
          <form
            onSubmit={receive}
            style={{ display: "flex", flexDirection: "column", gap: spacing[4] }}
          >
            <p style={{ margin: 0 }}>
              Enter what actually arrived. The field is prefilled with the dispatched quantity;
              change it only when the delivery differs.
            </p>
            {dispatchedLines.map((line) => {
              const key = lineKey(line.itemId, line.lotId);
              return (
                <TextField
                  key={key}
                  name={`received-${key}`}
                  label={lineLabel(line)}
                  inputMode="decimal"
                  value={received[key] ?? ""}
                  onChange={(event) =>
                    setReceived((current) => ({ ...current, [key]: event.target.value }))
                  }
                  {...(line.unitCode === null ? {} : { suffix: line.unitCode })}
                  help={`Dispatched ${line.dispatchedQuantity}${line.unitCode === null ? "" : ` ${line.unitCode}`}`}
                />
              );
            })}
            <TextareaField
              name="discrepancyNote"
              label="Discrepancy note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              help="Optional. Recorded on the transfer when the received quantity differs from dispatched."
            />
            <div>
              <Button type="submit" loading={busy === "receive"} disabled={busy !== null}>
                Receive transfer
              </Button>
            </div>
          </form>
        ) : null}

        {status === "requested" || status === "approved" ? (
          <form
            onSubmit={cancel}
            style={{ display: "flex", flexDirection: "column", gap: spacing[3] }}
          >
            <TextField
              name="cancelReason"
              label="Cancellation reason"
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              placeholder="e.g. requested by mistake"
            />
            <div>
              <Button
                type="submit"
                variant="danger"
                loading={busy === "cancel"}
                disabled={busy !== null}
              >
                Cancel transfer
              </Button>
            </div>
          </form>
        ) : null}

        {status === "received" || status === "cancelled" ? (
          <p style={{ margin: 0 }}>This transfer is {status}; no further action is available.</p>
        ) : null}
      </div>
    </SectionCard>
  );
}
