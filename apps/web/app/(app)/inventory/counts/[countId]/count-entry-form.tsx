"use client";

import { Alert, Button, SectionCard, TextField, spacing, typography } from "@aquarela/ui";
import { formatDecimal, parseDecimal } from "@aquarela/domain/decimal";
import { QUANTITY_SCALE } from "@aquarela/domain/quantity";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not save the counted quantities. Please try again.";

export interface CountEntryLine {
  /** Stable React key: item/storage-area/lot identity. */
  readonly key: string;
  readonly itemId: string;
  readonly storageAreaId: string;
  readonly lotId: string | null;
  readonly label: string;
  readonly unitCode: string | null;
  readonly countedQty: string | null;
}

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

/**
 * Blind/sighted entry sheet (08_UI_UX.md §8.6): one large, numeric-keyboard
 * field per count line, each paired with the item's base unit so the quantity is
 * unambiguous. A blind count's expected quantities are never sent to this
 * component, so there is nothing to reveal. Saving is explicit and
 * server-confirmed; the reported values are preserved on rejection.
 */
export function CountEntryForm({
  countId,
  lines,
}: {
  readonly countId: string;
  readonly lines: readonly CountEntryLine[];
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((line) => [line.key, line.countedQty ?? ""])),
  );
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (lines.length === 0) {
    return (
      <SectionCard title="Count entry" meta="nothing to count">
        <Alert tone="info">
          This count has no lines. That happens when the location had no stock movements at the
          cutoff — there is nothing projected to count.
        </Alert>
      </SectionCard>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const payloadLines: {
      itemId: string;
      storageAreaId: string;
      lotId: string | null;
      countedQty: string;
    }[] = [];
    for (const line of lines) {
      const raw = (values[line.key] ?? "").trim();
      if (raw.length === 0) {
        continue;
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
      payloadLines.push({
        itemId: line.itemId,
        storageAreaId: line.storageAreaId,
        lotId: line.lotId,
        countedQty: formatDecimal(scaled, QUANTITY_SCALE),
      });
    }

    if (payloadLines.length === 0) {
      setError("Enter at least one counted quantity.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`/api/v1/counts/${countId}/counted`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines: payloadLines }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      setSuccess(`Saved ${payloadLines.length} ${payloadLines.length === 1 ? "line" : "lines"}.`);
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard
      title="Count entry"
      meta={`${lines.length} ${lines.length === 1 ? "line" : "lines"}`}
    >
      <form
        onSubmit={submit}
        style={{ display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 720 }}
      >
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        {success !== null ? <Alert tone="success">{success}</Alert> : null}

        {lines.map((line) => (
          <TextField
            key={line.key}
            name={`counted-${line.key}`}
            label={line.label}
            inputMode="decimal"
            value={values[line.key] ?? ""}
            onChange={(event) =>
              setValues((current) => ({ ...current, [line.key]: event.target.value }))
            }
            {...(line.unitCode === null ? {} : { suffix: line.unitCode })}
            placeholder="0.000"
            help="Leave blank for a line that was not counted."
          />
        ))}

        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Save counted quantities
          </Button>
        </div>
        <p style={{ margin: 0, fontSize: typography.fontSize.xs, opacity: 0.8 }}>
          Saving an observation does not touch the ledger. A line saved twice is recorded as a
          recount.
        </p>
      </form>
    </SectionCard>
  );
}
