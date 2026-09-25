"use client";

import {
  Alert,
  Button,
  NumberField,
  SectionCard,
  SelectField,
  color,
  geometry,
  spacing,
  typography,
} from "@aquarela/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not calculate the scenario. Please try again.";

export interface ScenarioVariantOption {
  readonly id: string;
  readonly label: string;
}

export interface ScenarioLocationOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface ScenarioChannelOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface RegisterScenarioFormProps {
  readonly variants: readonly ScenarioVariantOption[];
  readonly locations: readonly ScenarioLocationOption[];
  readonly channels: readonly ScenarioChannelOption[];
  readonly currency: string | null;
  readonly taxBases: readonly string[];
}

interface ErrorBody {
  readonly error?: string;
}

/**
 * The stored outcome the command returns, displayed verbatim. No money is
 * rounded or formatted in the browser: `presentedNetPrice`/`presentedGrossPrice`
 * are already the server's two-decimal presentation, and the other values are
 * the canonical decimals (the scenario detail presents them server-side).
 */
interface OutcomeView {
  readonly grossPrice?: string | null;
  readonly netPrice?: string | null;
  readonly presentedGrossPrice?: string | null;
  readonly presentedNetPrice?: string | null;
  readonly unitContribution?: string | null;
  readonly contributionMarginPct?: string | null;
  readonly requiredGrossPrice?: string | null;
  readonly breakEvenUnits?: string | null;
}

interface CalculateBody {
  readonly priceScenarioId?: string;
  readonly outcome?: OutcomeView;
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : fallback;
}

/** `inclusive` → `Inclusive`, for a readable vocabulary option. */
function humanize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Calculates (proposes) a price scenario through
 * `POST /api/v1/costing/price-scenarios` (PRICE-001/004). The product-variant,
 * location and channel options are the organization's real rows (not pasted
 * ids); an empty channel leaves the scenario for all channels, which is how the
 * command reads an absent `channelId`. Every value is a decimal string sent as
 * typed — the calculation runs server-side and this form only displays the
 * stored outcome the command returns. Approving the scenario is a separate
 * action that creates the effective price version (PRICE-002/003).
 */
export function RegisterScenarioForm({
  variants,
  locations,
  channels,
  currency,
  taxBases,
}: RegisterScenarioFormProps) {
  const router = useRouter();
  const [productVariantId, setProductVariantId] = useState(variants[0]?.id ?? "");
  const [locationId, setLocationId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [grossPrice, setGrossPrice] = useState("");
  const [targetContributionRate, setTargetContributionRate] = useState("");
  const [unitVariableCost, setUnitVariableCost] = useState("");
  const [taxBasis, setTaxBasis] = useState(taxBases[0] ?? "exclusive");
  const [taxRate, setTaxRate] = useState("0");
  const [discount, setDiscount] = useState("");
  const [refund, setRefund] = useState("");
  const [fixedCost, setFixedCost] = useState("");
  const [volumeAssumption, setVolumeAssumption] = useState("");
  const [percentageFeeRate, setPercentageFeeRate] = useState("");
  const [feeBasisAmount, setFeeBasisAmount] = useState("");
  const [fixedOrderFeePerUnit, setFixedOrderFeePerUnit] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [result, setResult] = useState<CalculateBody | null>(null);
  const [busy, setBusy] = useState(false);

  if (variants.length === 0) {
    return (
      <SectionCard title="Calculate a price scenario">
        <Alert tone="info">
          A scenario needs a product variant, and this organization has none yet. Create a product
          with a variant first.
        </Alert>
      </SectionCard>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setResult(null);

    if (productVariantId === "") {
      setError("Choose a product variant.");
      return;
    }
    if (unitVariableCost.trim() === "" || taxRate.trim() === "") {
      setError("Unit variable cost and tax rate are required.");
      return;
    }

    const feePct = percentageFeeRate.trim();
    const feeBasis = feeBasisAmount.trim();
    const feeFixed = fixedOrderFeePerUnit.trim();
    let channelFee: Record<string, string> | undefined;
    if (feePct !== "" || feeBasis !== "" || feeFixed !== "") {
      if (feePct === "" || feeBasis === "") {
        setError("A channel fee needs both a percentage rate and a fee basis amount.");
        return;
      }
      channelFee = {
        percentageFeeRate: feePct,
        feeBasisAmount: feeBasis,
        ...(feeFixed === "" ? {} : { fixedOrderFeePerUnit: feeFixed }),
      };
    }

    setBusy(true);
    try {
      const response = await fetch("/api/v1/costing/price-scenarios", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productVariantId,
          unitVariableCost: unitVariableCost.trim(),
          taxBasis,
          taxRate: taxRate.trim(),
          ...(locationId === "" ? {} : { locationId }),
          ...(channelId === "" ? {} : { channelId }),
          ...(grossPrice.trim() === "" ? {} : { grossPrice: grossPrice.trim() }),
          ...(targetContributionRate.trim() === ""
            ? {}
            : { targetContributionRate: targetContributionRate.trim() }),
          ...(discount.trim() === "" ? {} : { discount: discount.trim() }),
          ...(refund.trim() === "" ? {} : { refund: refund.trim() }),
          ...(fixedCost.trim() === "" ? {} : { fixedCost: fixedCost.trim() }),
          ...(volumeAssumption.trim() === "" ? {} : { volumeAssumption: volumeAssumption.trim() }),
          ...(channelFee === undefined ? {} : { channelFee }),
        }),
      });
      if (!response.ok) {
        setError(await errorMessage(response, FALLBACK_ERROR));
        return;
      }
      const body = (await response.json().catch(() => null)) as CalculateBody | null;
      setSuccess(
        body?.priceScenarioId === undefined
          ? "Scenario calculated and saved as a draft. Approving it is what creates the effective price version."
          : `Scenario ${body.priceScenarioId} calculated and saved as a draft. Approving it is what creates the effective price version.`,
      );
      setResult(body);
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  const outcome = result?.outcome;
  const raw = (value: string | null | undefined): string =>
    typeof value === "string" && value.length > 0 ? value : "—";

  return (
    <SectionCard title="Calculate a price scenario" meta="draft, then approve">
      <form
        onSubmit={submit}
        style={{ display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 720 }}
      >
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        {success !== null ? <Alert tone="success">{success}</Alert> : null}
        {outcome !== undefined && typeof result?.priceScenarioId === "string" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: spacing[3],
              }}
            >
              <div>
                <div>Net price (presented)</div>
                <div>{raw(outcome.presentedNetPrice ?? outcome.netPrice)}</div>
              </div>
              <div>
                <div>Gross price (presented)</div>
                <div>{raw(outcome.presentedGrossPrice ?? outcome.grossPrice)}</div>
              </div>
              <div>
                <div>Unit contribution</div>
                <div>{raw(outcome.unitContribution)}</div>
              </div>
              <div>
                <div>Contribution margin (fraction)</div>
                <div>{raw(outcome.contributionMarginPct)}</div>
              </div>
              <div>
                <div>Required gross price</div>
                <div>{raw(outcome.requiredGrossPrice)}</div>
              </div>
              <div>
                <div>Break-even units</div>
                <div>{raw(outcome.breakEvenUnits)}</div>
              </div>
            </div>
            <a
              href={`/costs/price-scenarios/${result.priceScenarioId}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                minHeight: geometry.touchTarget,
              }}
            >
              Open the scenario
            </a>
          </div>
        ) : null}

        <SelectField
          name="productVariantId"
          label="Product variant"
          required
          value={productVariantId}
          onChange={(event) => setProductVariantId(event.target.value)}
          options={variants.map((variant) => ({ value: variant.id, label: variant.label }))}
        />

        <SelectField
          name="locationId"
          label="Location"
          placeholder="All locations (company-wide)"
          value={locationId}
          onChange={(event) => setLocationId(event.target.value)}
          options={locations.map((location) => ({
            value: location.id,
            label: `${location.code} · ${location.name}`,
          }))}
          help="Leave empty for a company-wide scenario."
        />

        <SelectField
          name="channelId"
          label="Channel"
          placeholder="All channels (company-wide)"
          value={channelId}
          onChange={(event) => setChannelId(event.target.value)}
          options={channels.map((channel) => ({
            value: channel.id,
            label: `${channel.code} · ${channel.name}`,
          }))}
          help="Leave empty to calculate for all channels."
        />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: spacing[4],
          }}
        >
          <NumberField
            name="grossPrice"
            label="Gross price"
            min="0"
            step="0.0001"
            value={grossPrice}
            onChange={(event) => setGrossPrice(event.target.value)}
            placeholder="0.0000"
            {...(currency === null ? {} : { unit: currency })}
            help="Optional. Drives the net price and contribution."
          />
          <NumberField
            name="targetContributionRate"
            label="Target contribution rate"
            min="0"
            step="0.000001"
            value={targetContributionRate}
            onChange={(event) => setTargetContributionRate(event.target.value)}
            placeholder="0.300000"
            help="Optional fraction, e.g. 0.300000 for 30%. Yields the required gross price."
          />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: spacing[4],
          }}
        >
          <NumberField
            name="unitVariableCost"
            label="Unit variable cost"
            required
            min="0"
            step="0.0001"
            value={unitVariableCost}
            onChange={(event) => setUnitVariableCost(event.target.value)}
            placeholder="0.0000"
            {...(currency === null ? {} : { unit: currency })}
          />
          <SelectField
            name="taxBasis"
            label="Tax basis"
            required
            value={taxBasis}
            onChange={(event) => setTaxBasis(event.target.value)}
            options={taxBases.map((value) => ({ value, label: humanize(value) }))}
          />
          <NumberField
            name="taxRate"
            label="Tax rate"
            required
            min="0"
            step="0.000001"
            value={taxRate}
            onChange={(event) => setTaxRate(event.target.value)}
            placeholder="0.250000"
            help="Fraction, e.g. 0.250000 for 25%. Use 0 when no tax applies."
          />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: spacing[4],
          }}
        >
          <NumberField
            name="discount"
            label="Discount"
            min="0"
            step="0.0001"
            value={discount}
            onChange={(event) => setDiscount(event.target.value)}
            placeholder="0.0000"
            {...(currency === null ? {} : { unit: currency })}
            help="Optional."
          />
          <NumberField
            name="refund"
            label="Refund"
            min="0"
            step="0.0001"
            value={refund}
            onChange={(event) => setRefund(event.target.value)}
            placeholder="0.0000"
            {...(currency === null ? {} : { unit: currency })}
            help="Optional."
          />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: spacing[4],
          }}
        >
          <NumberField
            name="fixedCost"
            label="Fixed cost"
            min="0"
            step="0.0001"
            value={fixedCost}
            onChange={(event) => setFixedCost(event.target.value)}
            placeholder="0.0000"
            {...(currency === null ? {} : { unit: currency })}
            help="Optional. Used for break-even units."
          />
          <NumberField
            name="volumeAssumption"
            label="Volume assumption"
            min="0"
            step="0.000001"
            value={volumeAssumption}
            onChange={(event) => setVolumeAssumption(event.target.value)}
            placeholder="0"
            help="Optional unit volume."
          />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: spacing[4],
          }}
        >
          <NumberField
            name="percentageFeeRate"
            label="Channel percentage fee"
            min="0"
            step="0.000001"
            value={percentageFeeRate}
            onChange={(event) => setPercentageFeeRate(event.target.value)}
            placeholder="0.025000"
            help="Optional channel fee. Fill all three fee fields together."
          />
          <NumberField
            name="feeBasisAmount"
            label="Channel fee basis amount"
            min="0"
            step="0.0001"
            value={feeBasisAmount}
            onChange={(event) => setFeeBasisAmount(event.target.value)}
            placeholder="0.0000"
            {...(currency === null ? {} : { unit: currency })}
          />
          <NumberField
            name="fixedOrderFeePerUnit"
            label="Fixed order fee per unit"
            min="0"
            step="0.0001"
            value={fixedOrderFeePerUnit}
            onChange={(event) => setFixedOrderFeePerUnit(event.target.value)}
            placeholder="0.0000"
            {...(currency === null ? {} : { unit: currency })}
            help="Optional extra fixed component."
          />
        </div>

        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Calculate scenario
          </Button>
        </div>

        <p
          style={{
            margin: 0,
            fontSize: typography.fontSize.sm,
            color: color.text.muted,
          }}
        >
          The result is a draft scenario; approving it creates the effective price version for its
          scope. Money is calculated server-side at four decimal places and presented at two.
        </p>
      </form>
    </SectionCard>
  );
}
