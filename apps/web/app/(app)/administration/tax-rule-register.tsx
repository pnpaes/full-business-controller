"use client";

import {
  Alert,
  Badge,
  Button,
  DataTable,
  DateField,
  EmptyState,
  Modal,
  StatusPill,
  color,
  spacing,
  typography,
} from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

const FALLBACK_ERROR = "Could not end the tax rule. Please try again.";

export interface TaxRuleRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly ratePct: string;
  readonly taxBasis: string;
  readonly taxTreatment: string;
  readonly recoverable: boolean;
  /** Percentage for display, derived once from the stored fraction at TAX_RATE_SCALE. */
  readonly ratePercent: string;
  readonly appliesTo: string;
  readonly scopeType: string;
  readonly scopeLabel: string;
  /** "effective" | "future" | "ended", computed at the server's stated `asOf`. */
  readonly effectiveStatus: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}

export interface TaxRuleRegisterProps {
  readonly rows: readonly TaxRuleRow[];
  /** When false the register is read-only: no create form and no supersede action. */
  readonly canWrite: boolean;
}

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

const norwegianDate = new Intl.DateTimeFormat("nb-NO", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/** `yyyy-mm-dd` → `dd.MM.yyyy`; unparseable → an em dash (§7.8 locale-aware). */
function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? "—" : norwegianDate.format(date);
}

function statusTone(status: string): "success" | "warning" | "neutral" {
  if (status === "effective") {
    return "success";
  }
  return status === "future" ? "warning" : "neutral";
}

/**
 * The tax-rule register with its supersede action (`PRICE-005`,
 * `DEC-003`/`DEC-022`). The list is append-only: an existing rule's rate, basis,
 * recoverable flag and applicability are never editable, so the only action is
 * **End**, which sets `effective_to`; a rate change is a new rule from a date.
 * The copy states that, and the dialog asks for the end instant explicitly.
 */
export function TaxRuleRegister({ rows, canWrite }: TaxRuleRegisterProps) {
  const router = useRouter();
  const [target, setTarget] = useState<TaxRuleRow | null>(null);
  const [effectiveTo, setEffectiveTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function open(row: TaxRuleRow): void {
    setTarget(row);
    setEffectiveTo("");
    setError(null);
  }

  function close(): void {
    setTarget(null);
    setEffectiveTo("");
    setError(null);
  }

  async function submit(): Promise<void> {
    if (target === null) {
      return;
    }
    const day = effectiveTo.trim();
    if (day.length === 0) {
      setError("Choose the day the rule stops being effective.");
      return;
    }
    if (day <= target.effectiveFrom) {
      setError("The end date must be after the rule's effective-from date.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/costing/tax-rules/${target.id}/supersede`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ effectiveTo: `${day}T00:00:00.000Z` }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      close();
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  if (rows.length === 0) {
    return (
      <EmptyState title="No tax rules defined">
        A tax rule is an effective-dated rate for one applicability and scope. Nothing can resolve a
        rate until one exists, so create the first rule below.
      </EmptyState>
    );
  }

  return (
    <>
      <div style={{ overflowX: "auto", minWidth: 0 }}>
        <DataTable
          caption="Tax rules with their rate, applicability, basis and effective status at the stated as-of instant."
          columns={[
            { key: "code", header: "Code · name" },
            { key: "rate", header: "Rate", align: "right" },
            { key: "applies", header: "Applies to" },
            { key: "basis", header: "Basis" },
            { key: "recoverable", header: "Recoverable" },
            { key: "status", header: "Status" },
            { key: "effective", header: "Effective" },
            ...(canWrite ? [{ key: "actions", header: "Actions" }] : []),
          ]}
          rows={rows.map((row) => ({
            code: (
              <div style={{ display: "flex", flexDirection: "column", gap: spacing[1] }}>
                <span style={{ fontWeight: typography.fontWeight.medium }}>{row.code}</span>
                <span style={{ fontSize: typography.fontSize.sm, color: "inherit" }}>
                  {row.name}
                </span>
              </div>
            ),
            rate: `${row.ratePercent} %`,
            applies: (
              <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[1] }}>
                <Badge>{row.appliesTo}</Badge>
                <Badge>{row.scopeLabel}</Badge>
              </div>
            ),
            basis: `${row.taxBasis} · ${row.taxTreatment}`,
            recoverable: row.recoverable ? (
              <StatusPill tone="success">recoverable</StatusPill>
            ) : (
              "—"
            ),
            status: (
              <StatusPill tone={statusTone(row.effectiveStatus)}>{row.effectiveStatus}</StatusPill>
            ),
            effective: `${formatDate(row.effectiveFrom)} → ${
              row.effectiveTo === null ? "open" : formatDate(row.effectiveTo)
            }`,
            ...(canWrite
              ? {
                  actions: (
                    <Button size="sm" variant="secondary" onClick={() => open(row)}>
                      End
                    </Button>
                  ),
                }
              : {}),
          }))}
          emptyMessage="No tax rules defined."
        />
      </div>

      <p
        style={{
          margin: `${spacing[4]}px 0 0`,
          fontSize: typography.fontSize.sm,
          color: color.text.muted,
        }}
      >
        A rule&rsquo;s rate, basis, recoverable flag and applicability cannot be edited — changing a
        rate means creating a new rule effective from a date, so history stays intact. Ending a rule
        sets its <em>effective to</em> instant; a successor can begin at that same instant.
      </p>

      <Modal
        title={target === null ? "" : `End tax rule ${target.code}`}
        open={target !== null}
        onClose={close}
        footer={
          <>
            <Button variant="secondary" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submit} loading={busy} disabled={busy}>
              End rule
            </Button>
          </>
        }
      >
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        <DateField
          name="effectiveTo"
          label="Effective to"
          required
          value={effectiveTo}
          onChange={(event) => setEffectiveTo(event.target.value)}
          help="The rule stops being effective at this instant (exclusive)."
        />
      </Modal>
    </>
  );
}
