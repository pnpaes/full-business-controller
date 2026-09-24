"use client";

import { Alert, Button, NumberField, TextField, spacing } from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not register the conversion. Please try again.";
const DECIMAL = /^\d{1,12}(\.\d{1,6})?$/;

export interface UnitConversionFormProps {
  /** Example unit codes already registered, for the placeholder only. */
  readonly knownCodes: readonly string[];
}

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

/**
 * Registers one org-wide unit conversion (`registerUnitConversion`, FND-003):
 * 1 `from` = factor × `to`, effective from now. The units are entered as their
 * organization-unique codes (no unit-picker read model exists yet); the server
 * resolves them and reports an unknown code. A failed save keeps the entered
 * values and returns focus to the first invalid field.
 */
export function UnitConversionForm({ knownCodes }: UnitConversionFormProps) {
  const router = useRouter();
  const [fromUnitCode, setFromUnitCode] = useState("");
  const [toUnitCode, setToUnitCode] = useState("");
  const [factor, setFactor] = useState("");
  const [fromError, setFromError] = useState<string | null>(null);
  const [toError, setToError] = useState<string | null>(null);
  const [factorError, setFactorError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const example = knownCodes.length > 0 ? `e.g. ${knownCodes[0]}` : "e.g. kg";

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setFromError(null);
    setToError(null);
    setFactorError(null);

    const from = fromUnitCode.trim();
    const to = toUnitCode.trim();
    const value = factor.trim();
    if (from.length === 0) {
      setFromError("Enter the from unit code.");
      document.getElementById("field-fromUnitCode")?.focus();
      return;
    }
    if (to.length === 0) {
      setToError("Enter the to unit code.");
      document.getElementById("field-toUnitCode")?.focus();
      return;
    }
    if (from === to) {
      setToError("From and to units must differ.");
      document.getElementById("field-toUnitCode")?.focus();
      return;
    }
    if (!DECIMAL.test(value) || Number(value) <= 0) {
      setFactorError("Enter a positive factor with up to 6 decimals.");
      document.getElementById("field-factor")?.focus();
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/v1/products/unit-conversions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromUnitCode: from, toUnitCode: to, factor: value }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      setSuccess(`Registered 1 ${from} = ${value} ${to}.`);
      setFromUnitCode("");
      setToUnitCode("");
      setFactor("");
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
      style={{ display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 640 }}
    >
      {error !== null ? <Alert tone="danger">{error}</Alert> : null}
      {success !== null ? <Alert tone="success">{success}</Alert> : null}

      <TextField
        name="fromUnitCode"
        label="From unit code"
        required
        value={fromUnitCode}
        {...(fromError === null ? {} : { error: fromError })}
        onChange={(event) => setFromUnitCode(event.target.value)}
        placeholder={example}
        help="The code of an existing unit, e.g. kg."
        autoCapitalize="none"
      />
      <TextField
        name="toUnitCode"
        label="To unit code"
        required
        value={toUnitCode}
        {...(toError === null ? {} : { error: toError })}
        onChange={(event) => setToUnitCode(event.target.value)}
        placeholder="e.g. g"
        help="The code of an existing unit; must differ from the from unit."
        autoCapitalize="none"
      />
      <NumberField
        name="factor"
        label="Factor"
        unit={`${toUnitCode.trim() || "to"} per ${fromUnitCode.trim() || "from"}`}
        required
        value={factor}
        {...(factorError === null ? {} : { error: factorError })}
        onChange={(event) => setFactor(event.target.value)}
        placeholder="e.g. 1000"
        inputMode="decimal"
        help={`1 ${fromUnitCode.trim() || "from unit"} = this many ${toUnitCode.trim() || "to units"}.`}
      />
      <div>
        <Button type="submit" loading={busy} disabled={busy}>
          Register conversion
        </Button>
      </div>
    </form>
  );
}
