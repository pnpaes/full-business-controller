"use client";

import {
  Alert,
  Button,
  DateField,
  NumberField,
  SelectField,
  SectionCard,
  TextField,
  TextareaField,
  spacing,
} from "@aquarela/ui";
import { parseDecimal } from "@aquarela/domain/decimal";
import { QUANTITY_SCALE } from "@aquarela/domain/quantity";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const FALLBACK_ERROR = "Could not register the version. Check the values and try again.";

export interface VersionItemOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly baseUnitId: string;
  readonly baseUnitCode: string;
}

export interface VersionSubRecipeOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly baseUnitId: string;
  readonly baseUnitCode: string;
}

export interface VersionAllergenOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface VersionTestOption {
  readonly id: string;
  readonly label: string;
}

export interface VersionUserOption {
  readonly id: string;
  readonly displayName: string;
}

export interface RegisterVersionFormProps {
  readonly recipeId: string;
  readonly nextVersionNo: number;
  readonly items: readonly VersionItemOption[];
  readonly subRecipes: readonly VersionSubRecipeOption[];
  readonly allergens: readonly VersionAllergenOption[];
  readonly unlinkedTests: readonly VersionTestOption[];
  readonly users: readonly VersionUserOption[];
  readonly roleCodes: readonly string[];
}

interface ErrorBody {
  readonly error?: string;
}

interface DraftLine {
  readonly key: number;
  readonly componentKind: "ingredient" | "packaging" | "sub_recipe";
  readonly targetId: string;
  readonly quantity: string;
  readonly lossFactor: string;
}

interface DraftAllergen {
  readonly key: number;
  readonly allergenId: string;
  readonly source: "derived" | "verified";
  readonly verifiedBy: string;
}

const STATES = ["draft", "submitted", "approved"] as const;

/** Parses a user quantity at quantity scale; `null` when it is not a valid positive decimal. */
function parsePositiveQuantity(value: string): bigint | null {
  try {
    const parsed = parseDecimal(value.trim(), QUANTITY_SCALE);
    return parsed <= 0n ? null : parsed;
  } catch {
    return null;
  }
}

/**
 * Registers a new recipe version through `POST /api/v1/recipes/[id]/versions`
 * (`registerRecipeVersion`). The command owns every domain rule — derived yield,
 * unit compatibility, sub-recipe cycles, COST-002 — so this only collects
 * values. Each line's unit is the component's base unit, resolved server-side:
 * no unit-catalogue read service exists yet, so other units are not offered here
 * (they remain available through the API).
 */
export function RegisterVersionForm({
  recipeId,
  nextVersionNo,
  items,
  subRecipes,
  allergens,
  unlinkedTests,
  users,
  roleCodes,
}: RegisterVersionFormProps) {
  const router = useRouter();
  const [versionNo, setVersionNo] = useState(String(nextVersionNo));
  const [state, setState] = useState<(typeof STATES)[number]>("draft");
  const [plannedInputQty, setPlannedInputQty] = useState("");
  const [plannedOutputQty, setPlannedOutputQty] = useState("");
  const [approvedUsableOutput, setApprovedUsableOutput] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [effectiveTo, setEffectiveTo] = useState("");
  const [preparationMinutes, setPreparationMinutes] = useState("");
  const [method, setMethod] = useState("");
  const [notes, setNotes] = useState("");
  const [approvedBy, setApprovedBy] = useState("");
  const [laborRoleCode, setLaborRoleCode] = useState("");
  const [laborCostCenterId, setLaborCostCenterId] = useState("");
  const [sourceRecipeTestId, setSourceRecipeTestId] = useState("");
  const [lines, setLines] = useState<readonly DraftLine[]>([]);
  const [allergenRows, setAllergenRows] = useState<readonly DraftAllergen[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lineKey, setLineKey] = useState(0);
  const [allergenKey, setAllergenKey] = useState(0);

  if (items.length === 0 && subRecipes.length === 0) {
    return (
      <SectionCard title="Register a version" meta="lines, yield and allergens">
        <Alert tone="info">
          A version needs at least one line, and every line points at an item or a sub-recipe.
          Register an item (Products) or another recipe first, then register the version here.
        </Alert>
      </SectionCard>
    );
  }

  function addTargetLine(componentKind: DraftLine["componentKind"]): void {
    const firstTarget = componentKind === "sub_recipe" ? subRecipes[0]?.id : (items[0]?.id ?? "");
    setLines((current) => [
      ...current,
      {
        key: lineKey,
        componentKind,
        targetId: firstTarget ?? "",
        quantity: "",
        lossFactor: "",
      },
    ]);
    setLineKey((key) => key + 1);
  }

  function updateLine(key: number, patch: Partial<DraftLine>): void {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function addAllergenRow(): void {
    setAllergenRows((current) => [
      ...current,
      { key: allergenKey, allergenId: allergens[0]?.id ?? "", source: "derived", verifiedBy: "" },
    ]);
    setAllergenKey((key) => key + 1);
  }

  function updateAllergenRow(key: number, patch: Partial<DraftAllergen>): void {
    setAllergenRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const versionNoValue = Number(versionNo);
    if (!Number.isInteger(versionNoValue) || versionNoValue < 1) {
      setError("Enter a positive whole version number.");
      return;
    }
    const plannedInput = parsePositiveQuantity(plannedInputQty);
    const plannedOutput = parsePositiveQuantity(plannedOutputQty);
    const approvedUsable = parsePositiveQuantity(approvedUsableOutput);
    if (plannedInput === null || plannedOutput === null || approvedUsable === null) {
      setError(
        "Enter positive planned input, planned output and approved usable output quantities.",
      );
      return;
    }
    if (approvedUsable > plannedInput) {
      setError(
        "Approved usable output cannot exceed the planned input — the yield rate must stay within (0, 1].",
      );
      return;
    }
    if (effectiveFrom.trim().length === 0) {
      setError("Choose the effective-from date.");
      return;
    }

    const payloadLines: Array<{
      componentKind: string;
      quantity: string;
      unitId: string;
      itemId?: string;
      subRecipeId?: string;
      lossFactor?: string;
    }> = [];
    for (const line of lines) {
      const quantity = line.quantity.trim();
      if (parsePositiveQuantity(quantity) === null) {
        setError("Enter a positive quantity for every line.");
        return;
      }
      if (line.componentKind === "sub_recipe") {
        const sub = subRecipes.find((option) => option.id === line.targetId);
        if (sub === undefined) {
          setError("Choose a sub-recipe for every sub-recipe line.");
          return;
        }
        payloadLines.push({
          componentKind: "sub_recipe",
          subRecipeId: sub.id,
          unitId: sub.baseUnitId,
          quantity,
          ...(line.lossFactor.trim().length === 0 ? {} : { lossFactor: line.lossFactor.trim() }),
        });
      } else {
        const item = items.find((option) => option.id === line.targetId);
        if (item === undefined) {
          setError(`Choose an item for every ${line.componentKind} line.`);
          return;
        }
        payloadLines.push({
          componentKind: line.componentKind,
          itemId: item.id,
          unitId: item.baseUnitId,
          quantity,
          ...(line.lossFactor.trim().length === 0 ? {} : { lossFactor: line.lossFactor.trim() }),
        });
      }
    }
    if (payloadLines.length === 0) {
      setError("A version requires at least one line. Add a line below the header fields.");
      return;
    }

    const payloadAllergens: Array<{
      allergenId: string;
      source: string;
      verifiedBy?: string;
    }> = [];
    for (const row of allergenRows) {
      if (row.allergenId.length === 0) {
        setError("Choose an allergen for every declared allergen row.");
        return;
      }
      if (row.source === "verified" && row.verifiedBy.trim().length === 0) {
        setError("A verified allergen declaration needs the person who verified it.");
        return;
      }
      payloadAllergens.push({
        allergenId: row.allergenId,
        source: row.source,
        ...(row.source === "verified" ? { verifiedBy: row.verifiedBy.trim() } : {}),
      });
    }

    if (state === "approved" && approvedBy.trim().length === 0) {
      setError("An approved version needs an approver.");
      return;
    }
    const laborRole = laborRoleCode.trim();
    const laborCenter = laborCostCenterId.trim();
    if ((laborRole.length === 0) !== (laborCenter.length === 0)) {
      setError(
        "The labour mapping is all-or-nothing (DEC-112): give both the role and the cost centre, or neither.",
      );
      return;
    }

    const minutes = preparationMinutes.trim();
    if (minutes.length > 0 && (!/^\d+$/.test(minutes) || Number(minutes) < 0)) {
      setError("Preparation minutes must be a whole non-negative number.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`/api/v1/recipes/${recipeId}/versions`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          versionNo: versionNoValue,
          state,
          plannedInputQty: plannedInputQty.trim(),
          plannedOutputQty: plannedOutputQty.trim(),
          approvedUsableOutput: approvedUsableOutput.trim(),
          effectiveFrom: effectiveFrom.trim(),
          ...(effectiveTo.trim().length === 0 ? {} : { effectiveTo: effectiveTo.trim() }),
          ...(state === "approved" ? { approvedBy: approvedBy.trim() } : {}),
          ...(minutes.length === 0 ? {} : { preparationMinutes: Number(minutes) }),
          ...(method.trim().length === 0 ? {} : { method: method.trim() }),
          ...(notes.trim().length === 0 ? {} : { notes: notes.trim() }),
          ...(laborRole.length === 0
            ? {}
            : { laborRoleCode: laborRole, laborCostCenterId: laborCenter }),
          ...(sourceRecipeTestId.length === 0 ? {} : { sourceRecipeTestId }),
          lines: payloadLines,
          ...(payloadAllergens.length === 0 ? {} : { allergens: payloadAllergens }),
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ErrorBody | null;
        setError(
          typeof body?.error === "string" && body.error.length > 0 ? body.error : FALLBACK_ERROR,
        );
        return;
      }
      setSuccess(`Version v${versionNoValue} registered. It appears in the version list above.`);
      setLines([]);
      setAllergenRows([]);
      setMethod("");
      setNotes("");
      setPlannedInputQty("");
      setPlannedOutputQty("");
      setApprovedUsableOutput("");
      setSourceRecipeTestId("");
      setState("draft");
      setApprovedBy("");
      setLaborRoleCode("");
      setLaborCostCenterId("");
      setVersionNo(String(versionNoValue + 1));
      router.refresh();
    } catch {
      setError(FALLBACK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Register a version" meta="lines, yield and allergens">
      <form
        onSubmit={submit}
        style={{ display: "flex", flexDirection: "column", gap: spacing[4], maxWidth: 720 }}
      >
        {error !== null ? <Alert tone="danger">{error}</Alert> : null}
        {success !== null ? <Alert tone="success">{success}</Alert> : null}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: spacing[3],
          }}
        >
          <NumberField
            name="versionNo"
            label="Version number"
            required
            min={1}
            step={1}
            value={versionNo}
            onChange={(event) => setVersionNo(event.target.value)}
            help="Whole number, unique for this recipe."
          />
          <SelectField
            name="state"
            label="State"
            required
            value={state}
            onChange={(event) => setState(event.target.value as (typeof STATES)[number])}
            options={STATES.map((value) => ({ value, label: value }))}
            help="Approved requires an approver and enables the cost preview."
          />
          <DateField
            name="effectiveFrom"
            label="Effective from"
            required
            value={effectiveFrom}
            onChange={(event) => setEffectiveFrom(event.target.value)}
          />
          <DateField
            name="effectiveTo"
            label="Effective to"
            value={effectiveTo}
            onChange={(event) => setEffectiveTo(event.target.value)}
            help="Optional; must be after effective from."
          />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: spacing[3],
          }}
        >
          <NumberField
            name="plannedInputQty"
            label="Planned input"
            required
            min={0}
            step="0.000001"
            value={plannedInputQty}
            onChange={(event) => setPlannedInputQty(event.target.value)}
            help="Positive. The batch input quantity the lines sum against."
          />
          <NumberField
            name="plannedOutputQty"
            label="Planned output"
            required
            min={0}
            step="0.000001"
            value={plannedOutputQty}
            onChange={(event) => setPlannedOutputQty(event.target.value)}
            help="Positive. The output one batch is planned to produce."
          />
          <NumberField
            name="approvedUsableOutput"
            label="Approved usable output"
            required
            min={0}
            step="0.000001"
            value={approvedUsableOutput}
            onChange={(event) => setApprovedUsableOutput(event.target.value)}
            help="Positive, at most the planned input. The yield rate is derived from it, never typed."
          />
          <NumberField
            name="preparationMinutes"
            label="Preparation minutes"
            min={0}
            step={1}
            value={preparationMinutes}
            onChange={(event) => setPreparationMinutes(event.target.value)}
            help="Optional, whole minutes per batch."
          />
        </div>

        <TextareaField
          name="method"
          label="Method"
          rows={4}
          value={method}
          onChange={(event) => setMethod(event.target.value)}
          help="Optional free-text steps for this version."
        />
        <TextareaField
          name="notes"
          label="Notes"
          rows={2}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          help="Optional."
        />

        {state === "approved" ? (
          <SelectField
            name="approvedBy"
            label="Approved by"
            required
            value={approvedBy}
            onChange={(event) => setApprovedBy(event.target.value)}
            placeholder="Select the approver"
            options={users.map((user) => ({ value: user.id, label: user.displayName }))}
            {...(users.length === 0 ? { help: "No active users found in this organization." } : {})}
          />
        ) : null}

        {unlinkedTests.length > 0 ? (
          <SelectField
            name="sourceRecipeTestId"
            label="Answers trial"
            value={sourceRecipeTestId}
            onChange={(event) => setSourceRecipeTestId(event.target.value)}
            placeholder="None — not from a trial"
            options={unlinkedTests.map((test) => ({ value: test.id, label: test.label }))}
            help="Optional (DEC-123). Link the trial this version answers; the link is written once and the trial keeps its measured values."
          />
        ) : null}

        <div style={{ display: "flex", flexDirection: "column", gap: spacing[3] }}>
          <strong style={{ margin: 0 }}>Lines</strong>
          {lines.map((line) => (
            <div
              key={line.key}
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: spacing[3],
                alignItems: "end",
              }}
            >
              <SelectField
                name={`line-kind-${line.key}`}
                label="Component kind"
                style={{ flex: "1 1 140px", minWidth: 0 }}
                value={line.componentKind}
                onChange={(event) =>
                  updateLine(line.key, {
                    componentKind: event.target.value as DraftLine["componentKind"],
                    targetId:
                      event.target.value === "sub_recipe"
                        ? (subRecipes[0]?.id ?? "")
                        : (items[0]?.id ?? ""),
                  })
                }
                options={[
                  { value: "ingredient", label: "Ingredient" },
                  { value: "packaging", label: "Packaging" },
                  { value: "sub_recipe", label: "Sub-recipe" },
                ]}
              />
              <SelectField
                name={`line-target-${line.key}`}
                label={line.componentKind === "sub_recipe" ? "Sub-recipe" : "Item"}
                style={{ flex: "2 1 200px", minWidth: 0 }}
                value={line.targetId}
                onChange={(event) => updateLine(line.key, { targetId: event.target.value })}
                options={
                  line.componentKind === "sub_recipe"
                    ? subRecipes.map((option) => ({
                        value: option.id,
                        label: `${option.code} · ${option.name}`,
                      }))
                    : items.map((option) => ({
                        value: option.id,
                        label: `${option.code} · ${option.name}`,
                      }))
                }
                {...(() => {
                  const unitCode =
                    line.componentKind === "sub_recipe"
                      ? subRecipes.find((option) => option.id === line.targetId)?.baseUnitCode
                      : items.find((option) => option.id === line.targetId)?.baseUnitCode;
                  return unitCode === undefined ? {} : { help: unitCode };
                })()}
              />
              <NumberField
                name={`line-qty-${line.key}`}
                label="Quantity"
                required
                min={0}
                step="0.000001"
                style={{ flex: "1 1 120px", minWidth: 0 }}
                value={line.quantity}
                onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
              />
              <NumberField
                name={`line-loss-${line.key}`}
                label="Loss factor"
                min={0}
                max={1}
                step="0.000001"
                style={{ flex: "1 1 100px", minWidth: 0 }}
                value={line.lossFactor}
                onChange={(event) => updateLine(line.key, { lossFactor: event.target.value })}
                help="Optional, in (0, 1]; defaults to 1."
              />
              <Button
                type="button"
                variant="secondary"
                style={{ flexShrink: 0 }}
                onClick={() =>
                  setLines((current) => current.filter((candidate) => candidate.key !== line.key))
                }
              >
                Remove
              </Button>
            </div>
          ))}
          <div style={{ display: "flex", gap: spacing[2] }}>
            <Button type="button" variant="secondary" onClick={() => addTargetLine("ingredient")}>
              Add ingredient
            </Button>
            <Button type="button" variant="secondary" onClick={() => addTargetLine("packaging")}>
              Add packaging
            </Button>
            {subRecipes.length > 0 ? (
              <Button type="button" variant="secondary" onClick={() => addTargetLine("sub_recipe")}>
                Add sub-recipe
              </Button>
            ) : null}
          </div>
          <Alert tone="info">
            Each line's unit is the component's base unit (shown under the picker). There is no
            unit-catalogue read service yet, so other units cannot be chosen here; register such
            versions through the API until a unit picker read exists.
          </Alert>
        </div>

        {allergens.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: spacing[3] }}>
            <strong style={{ margin: 0 }}>Allergen declarations</strong>
            {allergenRows.map((row) => (
              <div
                key={row.key}
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: spacing[3],
                  alignItems: "end",
                }}
              >
                <SelectField
                  name={`allergen-${row.key}`}
                  label="Allergen"
                  style={{ flex: "2 1 180px", minWidth: 0 }}
                  value={row.allergenId}
                  onChange={(event) =>
                    updateAllergenRow(row.key, { allergenId: event.target.value })
                  }
                  options={allergens.map((allergen) => ({
                    value: allergen.id,
                    label: `${allergen.code} · ${allergen.name}`,
                  }))}
                />
                <SelectField
                  name={`allergen-source-${row.key}`}
                  label="Source"
                  style={{ flex: "1 1 130px", minWidth: 0 }}
                  value={row.source}
                  onChange={(event) =>
                    updateAllergenRow(row.key, {
                      source: event.target.value as DraftAllergen["source"],
                    })
                  }
                  options={[
                    { value: "derived", label: "Derived" },
                    { value: "verified", label: "Verified" },
                  ]}
                />
                {row.source === "verified" ? (
                  <SelectField
                    name={`allergen-verified-by-${row.key}`}
                    label="Verified by"
                    style={{ flex: "2 1 180px", minWidth: 0 }}
                    value={row.verifiedBy}
                    onChange={(event) =>
                      updateAllergenRow(row.key, { verifiedBy: event.target.value })
                    }
                    placeholder="Select the verifier"
                    options={users.map((user) => ({ value: user.id, label: user.displayName }))}
                  />
                ) : (
                  <span />
                )}
                <Button
                  type="button"
                  variant="secondary"
                  style={{ flexShrink: 0 }}
                  onClick={() =>
                    setAllergenRows((current) =>
                      current.filter((candidate) => candidate.key !== row.key),
                    )
                  }
                >
                  Remove
                </Button>
              </div>
            ))}
            <div>
              <Button type="button" variant="secondary" onClick={addAllergenRow}>
                Add allergen declaration
              </Button>
            </div>
          </div>
        ) : (
          <Alert tone="info">
            No allergens are registered in this organization yet, so this version cannot declare
            any. Allergen declarations can be added once allergens exist.
          </Alert>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: spacing[3] }}>
          <strong style={{ margin: 0 }}>Direct labour mapping (DEC-112, optional)</strong>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: spacing[3],
              alignItems: "end",
            }}
          >
            <SelectField
              name="laborRoleCode"
              label="Labour role"
              style={{ flex: "1 1 180px", minWidth: 0 }}
              value={laborRoleCode}
              onChange={(event) => setLaborRoleCode(event.target.value)}
              placeholder="None — no labour mapping"
              options={roleCodes.map((code) => ({ value: code, label: code }))}
            />
            <TextField
              name="laborCostCenterId"
              label="Cost centre id"
              style={{ flex: "2 1 220px", minWidth: 0 }}
              value={laborCostCenterId}
              onChange={(event) => setLaborCostCenterId(event.target.value)}
              help="Optional. No cost-centre list read exists yet, so the id must be pasted; the role and cost centre are all-or-nothing."
              autoCapitalize="none"
            />
          </div>
        </div>

        <div>
          <Button type="submit" loading={busy} disabled={busy}>
            Register version
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
