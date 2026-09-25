"use client";

import {
  Alert,
  Button,
  CheckboxField,
  DateField,
  SelectField,
  TextField,
  spacing,
} from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not save the tax rule. Please try again.";
/** A fraction at up to 6 dp: 0.15 is 15 %. Percent-shaped values are refused server-side too. */
const FRACTION = /^\d(\.\d{1,6})?$/;

const TAX_BASIS_OPTIONS = [
  { value: "inclusive", label: "Inclusive" },
  { value: "exclusive", label: "Exclusive" },
];

const TAX_TREATMENT_OPTIONS = [
  { value: "channel_overridable", label: "Channel overridable" },
  { value: "fixed", label: "Fixed (item rate)" },
];

const APPLIES_TO_OPTIONS = [
  { value: "product", label: "Product" },
  { value: "service", label: "Service" },
  { value: "fee", label: "Fee" },
  { value: "cost", label: "Cost" },
];

const SCOPE_TYPE_OPTIONS = [
  { value: "company_wide", label: "Company wide" },
  { value: "organization", label: "Organization" },
  { value: "channel", label: "Channel" },
  { value: "location", label: "Location" },
];

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

export interface TaxRuleFormProps {
  /** The organization's channels, for a channel-scoped rate. */
  readonly channels: readonly {
    readonly id: string;
    readonly code: string;
    readonly name: string;
  }[];
  /** The organization's locations, for a location-scoped rate. */
  readonly locations: readonly {
    readonly id: string;
    readonly code: string;
    readonly name: string;
  }[];
}

/**
 * Authors one effective-dated tax rule (`PRICE-005`, `DEC-003`/`DEC-022`).
 *
 * The form is **append-only by construction**: it creates a new rule, and there
 * is deliberately no edit path. A rate change is a new rule effective from a
 * date, so the copy states that rather than leaving the operator to guess. The
 * rate is entered as a **fraction** (0.15 = 15 %) because that is what the table
 * and the resolver store; the field says so and the server refuses a
 * percent-shaped value.
 */
export function TaxRuleForm({ channels, locations }: TaxRuleFormProps) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [ratePct, setRatePct] = useState("");
  const [taxBasis, setTaxBasis] = useState("inclusive");
  const [taxTreatment, setTaxTreatment] = useState("channel_overridable");
  const [appliesTo, setAppliesTo] = useState("product");
  const [scopeType, setScopeType] = useState("company_wide");
  const [channelId, setChannelId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [recoverable, setRecoverable] = useState(false);
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveTo, setEffectiveTo] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [rateError, setRateError] = useState<string | null>(null);
  const [fromError, setFromError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const channelOptions = channels.map((channel) => ({
    value: channel.id,
    label: `${channel.code} · ${channel.name}`,
  }));
  const locationOptions = locations.map((location) => ({
    value: location.id,
    label: `${location.code} · ${location.name}`,
  }));

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setCodeError(null);
    setNameError(null);
    setRateError(null);
    setFromError(null);

    const trimmedCode = code.trim();
    const trimmedName = name.trim();
    const trimmedRate = ratePct.trim();
    if (trimmedCode.length === 0) {
      setCodeError("Enter a code.");
      document.getElementById("field-code")?.focus();
      return;
    }
    if (trimmedName.length === 0) {
      setNameError("Enter a name.");
      document.getElementById("field-name")?.focus();
      return;
    }
    if (!FRACTION.test(trimmedRate)) {
      setRateError("Enter a fraction between 0 and 1 with up to 6 decimals (0.15 = 15 %).");
      document.getElementById("field-ratePct")?.focus();
      return;
    }
    if (effectiveFrom.length === 0) {
      setFromError("Choose the date the rule takes effect.");
      document.getElementById("field-effectiveFrom")?.focus();
      return;
    }
    if (scopeType === "channel" && channelId.length === 0) {
      setError("Choose the channel this rule is scoped to.");
      return;
    }
    if (scopeType === "location" && locationId.length === 0) {
      setError("Choose the location this rule is scoped to.");
      return;
    }
    if (effectiveTo.length > 0 && effectiveTo <= effectiveFrom) {
      setError("The end date must be after the start date.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/v1/costing/tax-rules", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: trimmedCode,
          name: trimmedName,
          ratePct: trimmedRate,
          taxBasis,
          taxTreatment,
          appliesTo,
          scopeType,
          recoverable,
          effectiveFrom: `${effectiveFrom}T00:00:00.000Z`,
          ...(channelId.length > 0 ? { channelId } : {}),
          ...(locationId.length > 0 ? { locationId } : {}),
          ...(effectiveTo.length > 0 ? { effectiveTo: `${effectiveTo}T00:00:00.000Z` } : {}),
        }),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      setSuccess(`Created tax rule ${trimmedCode} at ${trimmedRate} (a fraction: 0.15 = 15 %).`);
      setCode("");
      setName("");
      setRatePct("");
      setEffectiveFrom("");
      setEffectiveTo("");
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
      style={{ display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 720 }}
    >
      {error !== null ? <Alert tone="danger">{error}</Alert> : null}
      {success !== null ? <Alert tone="success">{success}</Alert> : null}

      <TextField
        name="code"
        label="Code"
        required
        value={code}
        {...(codeError === null ? {} : { error: codeError })}
        onChange={(event) => setCode(event.target.value)}
        placeholder="e.g. NO_VAT_FOOD"
        help="Organization-unique. A code cannot be reused, so a rate change uses a new code."
        autoCapitalize="none"
      />
      <TextField
        name="name"
        label="Name"
        required
        value={name}
        {...(nameError === null ? {} : { error: nameError })}
        onChange={(event) => setName(event.target.value)}
        placeholder="e.g. Food 15%"
      />
      <TextField
        name="ratePct"
        label="Rate (fraction)"
        required
        value={ratePct}
        {...(rateError === null ? {} : { error: rateError })}
        onChange={(event) => setRatePct(event.target.value)}
        placeholder="0.150000"
        inputMode="decimal"
        help="Stored as a 6 dp fraction: 0.150000 is 15 %, 0.250000 is 25 %. Not a percentage."
      />
      <SelectField
        name="taxBasis"
        label="Tax basis"
        options={TAX_BASIS_OPTIONS}
        value={taxBasis}
        onChange={(event) => setTaxBasis(event.target.value)}
        help="Whether the highlighted amount includes this tax."
      />
      <SelectField
        name="taxTreatment"
        label="Treatment"
        options={TAX_TREATMENT_OPTIONS}
        value={taxTreatment}
        onChange={(event) => setTaxTreatment(event.target.value)}
        help="Fixed wins over the item default; channel overridable allows a channel-scoped rate (DEC-045)."
      />
      <SelectField
        name="appliesTo"
        label="Applies to"
        options={APPLIES_TO_OPTIONS}
        value={appliesTo}
        onChange={(event) => setAppliesTo(event.target.value)}
      />
      <SelectField
        name="scopeType"
        label="Scope"
        options={SCOPE_TYPE_OPTIONS}
        value={scopeType}
        onChange={(event) => setScopeType(event.target.value)}
      />
      {scopeType === "channel" ? (
        <SelectField
          name="channelId"
          label="Channel"
          required
          options={channelOptions}
          value={channelId}
          placeholder="Select a channel"
          onChange={(event) => setChannelId(event.target.value)}
        />
      ) : null}
      {scopeType === "location" ? (
        <SelectField
          name="locationId"
          label="Location"
          required
          options={locationOptions}
          value={locationId}
          placeholder="Select a location"
          onChange={(event) => setLocationId(event.target.value)}
        />
      ) : null}
      <CheckboxField
        name="recoverable"
        label="Recoverable (input VAT)"
        defaultChecked={recoverable}
        onChange={(event) => setRecoverable(event.target.checked)}
        help="Input VAT is recoverable where the purchase carries VAT (DEC-003)."
      />
      <DateField
        name="effectiveFrom"
        label="Effective from"
        required
        value={effectiveFrom}
        {...(fromError === null ? {} : { error: fromError })}
        onChange={(event) => setEffectiveFrom(event.target.value)}
        help="The rule is effective from this day (inclusive)."
      />
      <DateField
        name="effectiveTo"
        label="Effective to"
        value={effectiveTo}
        onChange={(event) => setEffectiveTo(event.target.value)}
        help="Optional; leave blank for open-ended. Exclusive, and must be after the start date."
      />
      <div>
        <Button type="submit" loading={busy} disabled={busy}>
          Create tax rule
        </Button>
      </div>
    </form>
  );
}
