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
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

import { formatPercent } from "../format";

const FALLBACK_ERROR = "Could not register the channel fee rule. Please try again.";

const PERCENTAGE_KINDS: readonly string[] = ["commission_pct", "processing_pct"];

export interface FeeChannelOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface FeeTaxRuleOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly ratePct: string;
  readonly appliesTo: string;
}

export interface RegisterChannelFeeRuleFormProps {
  readonly channels: readonly FeeChannelOption[];
  readonly taxRules: readonly FeeTaxRuleOption[];
  readonly feeKinds: readonly string[];
  readonly feeBases: readonly string[];
}

interface ErrorBody {
  readonly error?: string;
}

function humanize(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** A `yyyy-mm-dd` control value as a UTC-midnight instant (`timestamptz` column). */
function toInstant(date: string): string {
  return new Date(`${date}T00:00:00.000Z`).toISOString();
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : fallback;
}

/**
 * Registers one channel fee rule (`DEC-112`) through
 * `POST /api/v1/costing/channel-fee-rules`. The tax rule is an **optional**
 * reference (the column is nullable): the empty option honestly means "no tax
 * rule linked", not "unknown", and the rule's `code · name`, rate and
 * applicability are shown so the choice is not a raw UUID. The server command
 * remains the validator of the fee-kind/basis shape and the effective window.
 */
export function RegisterChannelFeeRuleForm({
  channels,
  taxRules,
  feeKinds,
  feeBases,
}: RegisterChannelFeeRuleFormProps) {
  const router = useRouter();
  const [channelId, setChannelId] = useState(channels[0]?.id ?? "");
  const [feeKind, setFeeKind] = useState(feeKinds[0] ?? "commission_pct");
  const [feeBasis, setFeeBasis] = useState(feeBases[0] ?? "net_price");
  const [percentageRate, setPercentageRate] = useState("");
  const [fixedAmount, setFixedAmount] = useState("");
  const [taxRuleId, setTaxRuleId] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(today());
  const [effectiveTo, setEffectiveTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isPercentage = PERCENTAGE_KINDS.includes(feeKind);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const response = await fetch("/api/v1/costing/channel-fee-rules", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId,
          feeKind,
          feeBasis,
          effectiveFrom: toInstant(effectiveFrom),
          ...(effectiveTo === "" ? {} : { effectiveTo: toInstant(effectiveTo) }),
          ...(taxRuleId === "" ? {} : { taxRuleId }),
          ...(isPercentage
            ? { percentageRate: percentageRate.trim() }
            : { fixedAmount: fixedAmount.trim() }),
        }),
      });
      if (!response.ok) {
        setError(await errorMessage(response, FALLBACK_ERROR));
        return;
      }
      setSuccess(
        `Registered the ${humanize(feeKind)} fee for the channel, effective from ${effectiveFrom}.`,
      );
      setPercentageRate("");
      setFixedAmount("");
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Register a channel fee rule" meta="DEC-112">
      <form
        onSubmit={submit}
        style={{ display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 720 }}
      >
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        {success !== null ? <Alert tone="success">{success}</Alert> : null}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: spacing[4],
          }}
        >
          <SelectField
            name="channelId"
            label="Channel"
            required
            value={channelId}
            onChange={(event) => setChannelId(event.target.value)}
            options={channels.map((channel) => ({
              value: channel.id,
              label: `${channel.code} · ${channel.name}`,
            }))}
            {...(channels.length === 0 ? { placeholder: "No channels registered" } : {})}
          />
          <SelectField
            name="feeKind"
            label="Fee kind"
            required
            value={feeKind}
            onChange={(event) => setFeeKind(event.target.value)}
            options={feeKinds.map((value) => ({ value, label: humanize(value) }))}
          />
          <SelectField
            name="feeBasis"
            label="Fee basis"
            required
            value={feeBasis}
            onChange={(event) => setFeeBasis(event.target.value)}
            options={feeBases.map((value) => ({ value, label: humanize(value) }))}
          />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: spacing[4],
          }}
        >
          {isPercentage ? (
            <NumberField
              name="percentageRate"
              label="Percentage rate"
              required
              min="0"
              step="0.000001"
              value={percentageRate}
              onChange={(event) => setPercentageRate(event.target.value)}
              placeholder="0.150000"
              help="Fraction, e.g. 0.150000 for 15%."
            />
          ) : (
            <NumberField
              name="fixedAmount"
              label="Fixed amount"
              required
              min="0"
              step="0.0001"
              value={fixedAmount}
              onChange={(event) => setFixedAmount(event.target.value)}
              placeholder="0.0000"
              help="Amount per order (money, 4 dp)."
            />
          )}
          <SelectField
            name="taxRuleId"
            label="Tax rule"
            value={taxRuleId}
            onChange={(event) => setTaxRuleId(event.target.value)}
            options={taxRules.map((rule) => ({
              value: rule.id,
              label: `${rule.code} · ${rule.name} (${formatPercent(rule.ratePct)}, ${humanize(rule.appliesTo)})`,
            }))}
            placeholder="No tax rule linked"
            help="Optional. The effective-dated rule this fee is taxed under (PRICE-005); leave unlinked when none applies."
          />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: spacing[4],
          }}
        >
          <TextField
            name="effectiveFrom"
            type="date"
            label="Effective from"
            required
            value={effectiveFrom}
            onChange={(event) => setEffectiveFrom(event.target.value)}
          />
          <TextField
            name="effectiveTo"
            type="date"
            label="Effective to"
            value={effectiveTo}
            onChange={(event) => setEffectiveTo(event.target.value)}
            help="Optional. Must be after the effective-from instant."
          />
        </div>

        <div>
          <Button type="submit" loading={busy} disabled={busy || channels.length === 0}>
            Register channel fee rule
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
