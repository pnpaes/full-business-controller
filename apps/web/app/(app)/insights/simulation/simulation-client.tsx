"use client";

import {
  Alert,
  BarChart,
  Button,
  DataTable,
  KpiCard,
  NumberField,
  SectionCard,
  SelectField,
  TextField,
  color,
  spacing,
  typography,
} from "@aquarela/ui";
import type { DataTableRow } from "@aquarela/ui";
import type { SimulationResult } from "@aquarela/application";
import { useState } from "react";
import type { FormEvent } from "react";

import {
  buildSimulationBody,
  formatHours,
  formatMoney,
  formatPct,
  previousMonthPeriod,
} from "./simulation-labels";

const FALLBACK_ERROR = "Could not run the simulation. Please try again.";

export interface SimulationLocationOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface SimulationRecipeOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface SimulationClientProps {
  readonly locations: readonly SimulationLocationOption[];
  readonly recipes: readonly SimulationRecipeOption[];
  readonly defaultLocationId: string;
}

interface ErrorBody {
  readonly error?: string;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody | null;
  return typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR;
}

interface AddRow {
  readonly recipeId: string;
  readonly units: string;
}

interface HeadcountRow {
  readonly roleCode: string;
  readonly countDelta: string;
  readonly hoursPerPeriod: string;
  readonly costCenterId: string;
}

const helpText = {
  margin: 0,
  maxWidth: "75ch",
  fontSize: typography.fontSize.sm,
  lineHeight: typography.lineHeight.normal,
  color: color.ink.secondary,
} as const;

function bulletList(items: readonly string[]) {
  return (
    <ul
      style={{
        margin: 0,
        paddingLeft: spacing[5],
        display: "flex",
        flexDirection: "column",
        gap: spacing[2],
        fontSize: typography.fontSize.sm,
        lineHeight: typography.lineHeight.normal,
        color: color.ink.secondary,
      }}
    >
      {items.map((item, index) => (
        <li key={`${index}-${item.slice(0, 24)}`}>{item}</li>
      ))}
    </ul>
  );
}

function comparisonRows(result: SimulationResult): DataTableRow[] {
  const row = (label: string, baseline: string, scenario: string, delta: string): DataTableRow => ({
    measure: label,
    baseline: `${formatMoney(baseline)} ${result.currency}`,
    scenario: `${formatMoney(scenario)} ${result.currency}`,
    delta: `${formatMoney(delta)} ${result.currency}`,
  });
  return [
    row("Revenue", result.baselineRevenue, result.scenarioRevenue, result.deltas.revenue.absolute),
    row("Cost", result.baselineCost, result.scenarioCost, result.deltas.cost.absolute),
    row(
      "Contribution",
      result.baselineContribution,
      result.scenarioContribution,
      result.deltas.contribution.absolute,
    ),
  ];
}

function ResultView({ result }: { readonly result: SimulationResult }) {
  const period = `${result.period.from.slice(0, 10)} → ${result.period.to.slice(0, 10)}`;
  const chartValues = [
    Number(result.scenarioRevenue),
    Number(result.scenarioCost),
    Number(result.scenarioContribution),
  ];
  const chartBaseline = [
    Number(result.baselineRevenue),
    Number(result.baselineCost),
    Number(result.baselineContribution),
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[6] }}>
      <Alert tone="info" title="This is a model, not a fact">
        The figures below are a linear what-if over the baseline period {period}. They are not a
        forecast and they change no posted fact. Read the assumptions, provenance and unmodelled
        list before acting on anything here.
      </Alert>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: spacing[4],
        }}
      >
        <KpiCard
          label="Contribution — modelled"
          value={`${formatMoney(result.scenarioContribution)} ${result.currency}`}
          delta={`${result.deltas.contribution.absolute.startsWith("-") ? "" : "+"}${formatMoney(result.deltas.contribution.absolute)}`}
          meta={`baseline ${formatMoney(result.baselineContribution)} ${result.currency}`}
          comparison={`${formatPct(result.deltas.contribution.relativePct)} vs baseline`}
        />
        <KpiCard
          label="Revenue — modelled"
          value={`${formatMoney(result.scenarioRevenue)} ${result.currency}`}
          delta={`${result.deltas.revenue.absolute.startsWith("-") ? "" : "+"}${formatMoney(result.deltas.revenue.absolute)}`}
          meta={`baseline ${formatMoney(result.baselineRevenue)} ${result.currency}`}
          comparison={`${formatPct(result.deltas.revenue.relativePct)} vs baseline`}
        />
        <KpiCard
          label="Cost — modelled"
          value={`${formatMoney(result.scenarioCost)} ${result.currency}`}
          delta={`${result.deltas.cost.absolute.startsWith("-") ? "" : "+"}${formatMoney(result.deltas.cost.absolute)}`}
          meta={`baseline ${formatMoney(result.baselineCost)} ${result.currency}`}
          comparison={`${formatPct(result.deltas.cost.relativePct)} vs baseline`}
        />
      </div>

      <SectionCard
        title="Baseline vs scenario"
        meta={`${period} · location ${result.locationId} · ${result.currency}`}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: spacing[5] }}>
          <BarChart
            values={chartValues}
            comparisonValues={chartBaseline}
            labels={["Revenue", "Cost", "Contribution"]}
            width={640}
            height={220}
            ariaLabel="Modelled revenue, cost and contribution, scenario against baseline"
            summary="Pale bars are the baseline; accent bars are the scenario. Values are modelled, not posted facts."
          />
          <DataTable
            caption="Baseline against scenario, with the absolute delta"
            columns={[
              { key: "measure", header: "Measure" },
              { key: "baseline", header: "Baseline", align: "right" },
              { key: "scenario", header: "Scenario", align: "right" },
              { key: "delta", header: "Delta", align: "right" },
            ]}
            rows={comparisonRows(result)}
          />
          <p style={helpText}>
            Baseline posted net sales were {formatMoney(result.baselinePostedNetSales)}{" "}
            {result.currency}; the modelled baseline revenue uses the effective approved net price ×
            actual units, so the two can differ.
          </p>
        </div>
      </SectionCard>

      <SectionCard title="Modelled capacity" meta="direct-labour hours only">
        <DataTable
          caption="Modelled direct-labour hours: required against supplied"
          columns={[
            { key: "measure", header: "Measure" },
            { key: "hours", header: "Hours", align: "right" },
          ]}
          rows={[
            {
              measure: "Baseline requirement",
              hours: formatHours(result.capacity.baselineRequiredHours),
            },
            {
              measure: "Scenario requirement",
              hours: formatHours(result.capacity.scenarioRequiredHours),
            },
            {
              measure: "Added by headcount",
              hours: formatHours(result.capacity.addedSuppliedHours),
            },
            {
              measure: "Scenario supply",
              hours: formatHours(result.capacity.scenarioSuppliedHours),
            },
            { measure: "Gap (positive = shortfall)", hours: formatHours(result.capacity.gapHours) },
          ]}
        />
        <p style={{ ...helpText, marginTop: spacing[3] }}>{result.capacity.note}</p>
      </SectionCard>

      <SectionCard title="Assumptions" meta="every input and held-constant">
        {bulletList(result.assumptions)}
      </SectionCard>

      <SectionCard title="Provenance" meta="which figure came from which read">
        {bulletList(result.provenance)}
      </SectionCard>

      <SectionCard title="Unmodelled" meta="what the model cannot say, and why">
        <Alert tone="warning" title="Terms this model does not include">
          {bulletList(result.unmodelled)}
        </Alert>
      </SectionCard>
    </div>
  );
}

/**
 * The scenario builder and result view (`W6`, `DEC-125`). Client component: it
 * holds the form state, posts the scenario to `/api/v1/simulation` and renders
 * the modelled result with its assumptions, provenance and unmodelled list
 * prominent. It never presents a modelled figure as a fact.
 */
export function SimulationClient({ locations, recipes, defaultLocationId }: SimulationClientProps) {
  const month = previousMonthPeriod(new Date());
  const [locationId, setLocationId] = useState(defaultLocationId);
  const [periodFrom, setPeriodFrom] = useState(month.from);
  const [periodTo, setPeriodTo] = useState(month.to);
  const [volumeChangePct, setVolumeChangePct] = useState("");
  const [priceChangePct, setPriceChangePct] = useState("");
  const [wageChangePct, setWageChangePct] = useState("");
  const [removals, setRemovals] = useState<readonly string[]>([]);
  const [adds, setAdds] = useState<readonly AddRow[]>([]);
  const [headcount, setHeadcount] = useState<readonly HeadcountRow[]>([]);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggleRemoval(recipeId: string): void {
    setRemovals((current) =>
      current.includes(recipeId) ? current.filter((id) => id !== recipeId) : [...current, recipeId],
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (locationId.length === 0) {
      setError("Choose a location.");
      return;
    }
    if (periodFrom.length === 0 || periodTo.length === 0) {
      setError("Choose the baseline period.");
      return;
    }

    setBusy(true);
    try {
      const body = buildSimulationBody(
        {
          locationId,
          periodFrom,
          periodTo,
          volumeChangePct,
          priceChangePct,
          wageChangePct,
          menuRemovals: removals,
          menuAdds: adds.map((row) => ({
            recipeId: row.recipeId,
            expectedUnitsPerPeriod: row.units,
          })),
          headcountChange: headcount.map((row) => ({
            roleCode: row.roleCode,
            countDelta: row.countDelta,
            hoursPerPeriod: row.hoursPerPeriod,
            costCenterId: row.costCenterId,
          })),
        },
        new Date().toISOString(),
      );
      const response = await fetch("/api/v1/simulation", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      const payload = (await response.json()) as { ok: true } & SimulationResult;
      setResult(payload);
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  if (locations.length === 0) {
    return (
      <SectionCard title="What-if simulation" meta="needs a location in your scope">
        <Alert tone="info">
          Running a simulation needs a location in your scope. Ask an owner or administrator for a
          location-scoped role, or register a location first.
        </Alert>
      </SectionCard>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[6] }}>
      <SectionCard title="Build a scenario" meta="applies deltas to the baseline period">
        <form
          onSubmit={submit}
          style={{ display: "flex", flexDirection: "column", gap: spacing[5], maxWidth: 760 }}
        >
          {error !== null ? <Alert tone="danger">{error}</Alert> : null}

          <SelectField
            name="locationId"
            label="Location"
            required
            value={locationId}
            onChange={(event) => setLocationId(event.target.value)}
            options={locations.map((location) => ({
              value: location.id,
              label: `${location.code} · ${location.name}`,
            }))}
            help="Recipes, prices and overhead are resolved per location."
          />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: spacing[4] }}>
            <TextField
              name="periodFrom"
              type="date"
              label="Baseline from"
              required
              value={periodFrom}
              onChange={(event) => setPeriodFrom(event.target.value)}
            />
            <TextField
              name="periodTo"
              type="date"
              label="Baseline to"
              required
              value={periodTo}
              onChange={(event) => setPeriodTo(event.target.value)}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: spacing[4] }}>
            <NumberField
              name="volumeChangePct"
              label="Volume change"
              unit="%"
              step="0.1"
              value={volumeChangePct}
              onChange={(event) => setVolumeChangePct(event.target.value)}
              help="Scales every baseline volume."
            />
            <NumberField
              name="priceChangePct"
              label="Price change"
              unit="%"
              step="0.1"
              value={priceChangePct}
              onChange={(event) => setPriceChangePct(event.target.value)}
              help="Scales every net price."
            />
            <NumberField
              name="wageChangePct"
              label="Wage change"
              unit="%"
              step="0.1"
              value={wageChangePct}
              onChange={(event) => setWageChangePct(event.target.value)}
              help="Scales the direct-labour part of every unit cost."
            />
          </div>

          <fieldset style={{ border: `1px solid ${color.border.subtle}`, padding: spacing[4] }}>
            <legend
              style={{ padding: `0 ${spacing[2]}px`, fontWeight: typography.fontWeight.semibold }}
            >
              Remove menu options
            </legend>
            <p style={helpText}>Removing an item sets its scenario volume to zero.</p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: spacing[2],
                marginTop: spacing[3],
              }}
            >
              {recipes.map((recipe) => (
                <label
                  key={recipe.id}
                  style={{ display: "flex", gap: spacing[2], alignItems: "center" }}
                >
                  <input
                    type="checkbox"
                    checked={removals.includes(recipe.id)}
                    onChange={() => toggleRemoval(recipe.id)}
                  />
                  <span>
                    {recipe.code} · {recipe.name}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset style={{ border: `1px solid ${color.border.subtle}`, padding: spacing[4] }}>
            <legend
              style={{ padding: `0 ${spacing[2]}px`, fontWeight: typography.fontWeight.semibold }}
            >
              Add menu options
            </legend>
            <p style={helpText}>
              The added item's unit cost and net price are resolved from its effective recipe
              version and price version at the scenario date.
            </p>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: spacing[3],
                marginTop: spacing[3],
              }}
            >
              {adds.map((row, index) => (
                <div
                  key={`add-${index}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "2fr 1fr auto",
                    gap: spacing[3],
                    alignItems: "end",
                  }}
                >
                  <SelectField
                    name={`addRecipe-${index}`}
                    label="Recipe"
                    value={row.recipeId}
                    onChange={(event) =>
                      setAdds((current) =>
                        current.map((entry, i) =>
                          i === index ? { ...entry, recipeId: event.target.value } : entry,
                        ),
                      )
                    }
                    options={recipes.map((recipe) => ({
                      value: recipe.id,
                      label: `${recipe.code} · ${recipe.name}`,
                    }))}
                  />
                  <NumberField
                    name={`addUnits-${index}`}
                    label="Units per period"
                    unit="units"
                    step="1"
                    value={row.units}
                    onChange={(event) =>
                      setAdds((current) =>
                        current.map((entry, i) =>
                          i === index ? { ...entry, units: event.target.value } : entry,
                        ),
                      )
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setAdds((current) => current.filter((_, i) => i !== index))}
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    setAdds((current) => [
                      ...current,
                      { recipeId: recipes[0]?.id ?? "", units: "" },
                    ])
                  }
                >
                  Add option
                </Button>
              </div>
            </div>
          </fieldset>

          <fieldset style={{ border: `1px solid ${color.border.subtle}`, padding: spacing[4] }}>
            <legend
              style={{ padding: `0 ${spacing[2]}px`, fontWeight: typography.fontWeight.semibold }}
            >
              Headcount change
            </legend>
            <p style={helpText}>
              Added cost is count × hours × the effective loaded rate for the role. Without a cost
              centre id the cost is reported as unmodelled rather than guessed.
            </p>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: spacing[3],
                marginTop: spacing[3],
              }}
            >
              {headcount.map((row, index) => (
                <div
                  key={`head-${index}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.4fr 1fr 1fr 1.6fr auto",
                    gap: spacing[3],
                    alignItems: "end",
                  }}
                >
                  <TextField
                    name={`role-${index}`}
                    label="Role"
                    value={row.roleCode}
                    onChange={(event) =>
                      setHeadcount((current) =>
                        current.map((entry, i) =>
                          i === index ? { ...entry, roleCode: event.target.value } : entry,
                        ),
                      )
                    }
                  />
                  <NumberField
                    name={`count-${index}`}
                    label="Count Δ"
                    step="1"
                    value={row.countDelta}
                    onChange={(event) =>
                      setHeadcount((current) =>
                        current.map((entry, i) =>
                          i === index ? { ...entry, countDelta: event.target.value } : entry,
                        ),
                      )
                    }
                  />
                  <NumberField
                    name={`hours-${index}`}
                    label="Hours / period"
                    unit="h"
                    step="1"
                    value={row.hoursPerPeriod}
                    onChange={(event) =>
                      setHeadcount((current) =>
                        current.map((entry, i) =>
                          i === index ? { ...entry, hoursPerPeriod: event.target.value } : entry,
                        ),
                      )
                    }
                  />
                  <TextField
                    name={`costCenter-${index}`}
                    label="Cost centre id (optional)"
                    value={row.costCenterId}
                    onChange={(event) =>
                      setHeadcount((current) =>
                        current.map((entry, i) =>
                          i === index ? { ...entry, costCenterId: event.target.value } : entry,
                        ),
                      )
                    }
                    help="Without it, no rate can be read."
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setHeadcount((current) => current.filter((_, i) => i !== index))}
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    setHeadcount((current) => [
                      ...current,
                      { roleCode: "", countDelta: "", hoursPerPeriod: "", costCenterId: "" },
                    ])
                  }
                >
                  Add headcount row
                </Button>
              </div>
            </div>
          </fieldset>

          <div>
            <Button type="submit" loading={busy} disabled={busy}>
              Run simulation
            </Button>
          </div>
        </form>
      </SectionCard>

      {result !== null ? <ResultView result={result} /> : null}
    </div>
  );
}
