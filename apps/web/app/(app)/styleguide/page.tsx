/**
 * Living design-system styleguide (DEC-120: the modern editorial SaaS direction
 * in `designer-agent-modern-saas-ui-brief.md`, superseding 08_UI_UX.md §8.7's
 * palette/typography/watercolor; §8.5 forms/tables and §8.4 status/warning
 * rules still govern. The palette and typography were re-based onto the
 * Aquarela backoffice design system by DEC-129 — cool canvas #F1F3F8, white
 * panels, ink #151A2D, the iris #5742BA with lavender #EEECFF — while the
 * legacy token names remain as re-tuned aliases).
 *
 * A single review surface: every token scale and every presentation primitive
 * rendered in its variants/states on one screen. Server component, no client
 * state; everything is driven by the token objects and `@aquarela/ui`.
 */
import type { CSSProperties, ReactNode } from "react";

import {
  Alert,
  Badge,
  Button,
  Card,
  Collapsible,
  EmptyState,
  FileField,
  InfoTip,
  KpiCard,
  MetricBand,
  MetricHero,
  MetricSecondary,
  NavItem,
  NavList,
  PageHeader,
  Panel,
  ScopeBar,
  SectionCard,
  Sparkline,
  StatusPill,
  Table,
  Td,
  TextField,
  Th,
  WatercolorBackdrop,
  accentPolicy,
  axisLabel,
  color,
  elevation,
  elevationRole,
  formatAxisValue,
  formatMoney,
  formatNumber,
  groupDecimal,
  radius,
  radiusRole,
  space,
  spacing,
  typeScale,
  typography,
} from "@aquarela/ui";

import { FormModalDemo, SuccessToastDemo } from "./wave0-demos";

export const metadata = { title: "Design system — Aquarela Business Control" };

const fontDisplay = { fontFamily: typography.fontFamily.display } as const;
const fontSans = { fontFamily: typography.fontFamily.sans } as const;
const fontMono = { fontFamily: typography.fontFamily.mono } as const;

const monoLabel: CSSProperties = {
  ...fontMono,
  fontSize: typography.fontSize.xs,
  color: color.text.secondary,
};

const hexValue: CSSProperties = {
  ...fontMono,
  fontSize: typography.fontSize.xs,
  color: color.text.muted,
};

/** Sequential ramps read straight from the token object, labelled for the page. */
const dataVizRamps: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["navy", color.dataViz.sequential.navy],
  ["berry", color.dataViz.sequential.berry],
];

/* ------------------------------- Local helpers ------------------------------ */

function SubHeading({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div
      style={{ display: "flex", alignItems: "baseline", gap: spacing[3], marginBottom: spacing[3] }}
    >
      <h3
        style={{
          ...fontDisplay,
          margin: 0,
          fontSize: typography.fontSize.lg,
          fontWeight: typography.fontWeight.semibold,
          color: color.text.primary,
        }}
      >
        {children}
      </h3>
      {hint ? (
        <span style={{ ...fontSans, fontSize: typography.fontSize.sm, color: color.text.muted }}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

/** One colour token: a filled chip plus its dotted name and hex literal. */
function Swatch({ name, value }: { name: string; value: string }) {
  return (
    <div
      style={{
        ...fontSans,
        display: "flex",
        flexDirection: "column",
        gap: spacing[1],
        minWidth: 0,
      }}
    >
      <div
        style={{
          height: 44,
          borderRadius: radius.sm,
          backgroundColor: value,
          border: `1px solid ${color.border.default}`,
        }}
      />
      <code style={{ ...monoLabel, wordBreak: "break-all" }}>{name}</code>
      <code style={hexValue}>{value}</code>
    </div>
  );
}

function SwatchGrid({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
        gap: spacing[4],
      }}
    >
      {children}
    </div>
  );
}

function Stack({ children, gap = spacing[4] }: { children: ReactNode; gap?: number }) {
  return <div style={{ display: "flex", flexDirection: "column", gap }}>{children}</div>;
}

function Row({ children, gap = spacing[3] }: { children: ReactNode; gap?: number }) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap,
      }}
    >
      {children}
    </div>
  );
}

/* ---------------------------------- Page ------------------------------------ */

export default function StyleguidePage() {
  return (
    <div style={{ ...fontSans, padding: spacing[6], maxWidth: 1120, margin: "0 auto" }}>
      <PageHeader
        title="Design system"
        scope="Aquarela Business Control"
        description="The living visual language: colour, typography, spacing, radius, elevation and every presentation primitive in its variants and states. Wave 0 (2026-09-28, docs/ux/README.md) adds the semantic type scale, the 4/8pt rhythm, InfoTip, Collapsible, the plain EmptyState, MetricHero, the money/number formatters, FormModal, SuccessToast and FileField (DEC-120, re-based onto the Aquarela design system by DEC-129)."
      />

      <Stack gap={spacing[6]}>
        {/* ------------------------------- Colour ------------------------------ */}
        <SectionCard title="Colour" meta="color.* tokens" headingLevel={2}>
          <Stack gap={spacing[6]}>
            <div>
              <SubHeading hint="legacy keys, values re-tuned by DEC-129 — cream aliases the canvas, navy is the ink">
                Brand
              </SubHeading>
              <SwatchGrid>
                {Object.entries(color.brand).map(([name, value]) => (
                  <Swatch key={name} name={`color.brand.${name}`} value={value} />
                ))}
              </SwatchGrid>
            </div>

            <div>
              <SubHeading>Background</SubHeading>
              <SwatchGrid>
                {Object.entries(color.background).map(([name, value]) => (
                  <Swatch key={name} name={`color.background.${name}`} value={value} />
                ))}
              </SwatchGrid>
            </div>

            <div>
              <SubHeading>Navigation</SubHeading>
              <SwatchGrid>
                {Object.entries(color.navigation).map(([name, value]) => (
                  <Swatch key={name} name={`color.navigation.${name}`} value={value} />
                ))}
              </SwatchGrid>
            </div>

            <div>
              <SubHeading>Text</SubHeading>
              <SwatchGrid>
                {Object.entries(color.text).map(([name, value]) => (
                  <Swatch key={name} name={`color.text.${name}`} value={value} />
                ))}
              </SwatchGrid>
            </div>

            <div>
              <SubHeading>Border</SubHeading>
              <SwatchGrid>
                {Object.entries(color.border).map(([name, value]) => (
                  <Swatch key={name} name={`color.border.${name}`} value={value} />
                ))}
              </SwatchGrid>
            </div>

            <div>
              <SubHeading hint="fg on bg · AA text, tinted wash backgrounds">Status</SubHeading>
              <Stack gap={spacing[5]}>
                {Object.entries(color.status).map(([tone, set]) => (
                  <div key={tone}>
                    <code style={{ ...monoLabel, display: "block", marginBottom: spacing[2] }}>
                      color.status.{tone}
                    </code>
                    <SwatchGrid>
                      <Swatch name={`color.status.${tone}.bg`} value={set.bg} />
                      <Swatch name={`color.status.${tone}.fg`} value={set.fg} />
                      <Swatch name={`color.status.${tone}.border`} value={set.border} />
                    </SwatchGrid>
                  </div>
                ))}
              </Stack>
            </div>

            <div>
              <SubHeading hint="categorical · ≥3:1 on the surface tiers">
                Data visualization
              </SubHeading>
              <SwatchGrid>
                {color.dataViz.categorical.map((value, index) => (
                  <Swatch
                    key={`${index}-${value}`}
                    name={`color.dataViz.categorical[${index}]`}
                    value={value}
                  />
                ))}
              </SwatchGrid>
            </div>

            <div>
              <SubHeading hint="sequential ramps · monotonic luminance">
                Data visualization ramps
              </SubHeading>
              <Stack gap={spacing[4]}>
                {dataVizRamps.map(([name, ramp]) => (
                  <div key={name}>
                    <code style={{ ...monoLabel, display: "block", marginBottom: spacing[2] }}>
                      color.dataViz.sequential.{name}
                    </code>
                    <SwatchGrid>
                      {ramp.map((value, index) => (
                        <Swatch key={`${index}-${value}`} name={`[${index}]`} value={value} />
                      ))}
                    </SwatchGrid>
                  </div>
                ))}
              </Stack>
            </div>
          </Stack>
        </SectionCard>

        {/* ----------------------------- Typography ---------------------------- */}
        <SectionCard title="Typography" meta="typography.* tokens" headingLevel={2}>
          <Stack gap={spacing[6]}>
            <div>
              <SubHeading hint="display stack — Manrope via --font-sans">Display</SubHeading>
              <code
                style={{
                  ...monoLabel,
                  display: "block",
                  marginBottom: spacing[3],
                  wordBreak: "break-all",
                }}
              >
                {typography.fontFamily.display}
              </code>
              <Stack gap={spacing[3]}>
                {Object.entries(typography.fontSize).map(([step, size]) => (
                  <div
                    key={step}
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: spacing[4],
                      flexWrap: "wrap",
                    }}
                  >
                    <code style={{ ...monoLabel, minWidth: 120 }}>
                      fontSize.{step} · {size}px
                    </code>
                    <span
                      style={{
                        ...fontDisplay,
                        fontSize: size,
                        color: color.text.primary,
                        lineHeight: typography.lineHeight.tight,
                      }}
                    >
                      Aquarela Business Control
                    </span>
                  </div>
                ))}
              </Stack>
            </div>

            <div>
              <SubHeading hint="sans stack — Manrope via --font-sans">Sans</SubHeading>
              <code
                style={{
                  ...monoLabel,
                  display: "block",
                  marginBottom: spacing[3],
                  wordBreak: "break-all",
                }}
              >
                {typography.fontFamily.sans}
              </code>
              <Stack gap={spacing[3]}>
                {Object.entries(typography.fontSize).map(([step, size]) => (
                  <div
                    key={step}
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: spacing[4],
                      flexWrap: "wrap",
                    }}
                  >
                    <code style={{ ...monoLabel, minWidth: 120 }}>
                      fontSize.{step} · {size}px
                    </code>
                    <span style={{ ...fontSans, fontSize: size, color: color.text.primary }}>
                      Reconcile 1,204.50 kg against the posted settlement.
                    </span>
                  </div>
                ))}
              </Stack>
            </div>

            <div>
              <SubHeading hint="weights 400 / 500 / 600 / 700">Weights</SubHeading>
              <Row gap={spacing[5]}>
                {Object.entries(typography.fontWeight).map(([name, weight]) => (
                  <span
                    key={name}
                    style={{
                      ...fontSans,
                      fontSize: typography.fontSize.lg,
                      fontWeight: weight,
                      color: color.text.primary,
                    }}
                  >
                    {name} {weight}
                  </span>
                ))}
              </Row>
              <Row gap={spacing[5]}>
                {Object.entries(typography.lineHeight).map(([name, value]) => (
                  <code key={name} style={monoLabel}>
                    lineHeight.{name} = {value}
                  </code>
                ))}
              </Row>
            </div>
          </Stack>
        </SectionCard>

        {/* ------------------------ Wave 0 semantic layer ---------------------- */}
        <SectionCard
          title="Wave 0 — type scale and spacing rhythm"
          meta="typeScale · space · radiusRole · elevationRole · accentPolicy"
          headingLevel={2}
        >
          <Stack gap={spacing[6]}>
            <div>
              <SubHeading hint="roles → an existing fontSize step, so the scale can never drift">
                Type scale
              </SubHeading>
              <Stack gap={spacing[3]}>
                {Object.entries(typeScale).map(([role, step]) => (
                  <div
                    key={role}
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: spacing[4],
                      flexWrap: "wrap",
                    }}
                  >
                    <code style={{ ...monoLabel, minWidth: 260 }}>
                      typeScale.{role} · {step.fontSize}px / {step.lineHeight} / w{step.fontWeight}
                    </code>
                    <span
                      style={{
                        ...fontDisplay,
                        ...step,
                        color: color.text.primary,
                      }}
                    >
                      Aquarela Business Control
                    </span>
                  </div>
                ))}
              </Stack>
            </div>

            <div>
              <SubHeading hint="4/8pt rhythm — every role aliases a spacing step">
                Spacing rhythm
              </SubHeading>
              <Stack gap={spacing[2]}>
                {Object.entries(space).map(([role, value]) => (
                  <div
                    key={role}
                    style={{ display: "flex", alignItems: "center", gap: spacing[3] }}
                  >
                    <code style={{ ...monoLabel, minWidth: 220 }}>
                      space.{role} · {value}px
                    </code>
                    <div
                      style={{
                        width: value,
                        height: 16,
                        backgroundColor: color.accent.accent,
                        borderRadius: radius.sm,
                        flexShrink: 0,
                      }}
                    />
                  </div>
                ))}
              </Stack>
            </div>

            <div>
              <SubHeading hint="control / surface / floating / dialog / pill">
                Radius roles
              </SubHeading>
              <SwatchGrid>
                {Object.entries(radiusRole).map(([role, value]) => (
                  <div
                    key={role}
                    style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}
                  >
                    <div
                      style={{
                        height: 56,
                        backgroundColor: color.background.surfaceAlt,
                        border: `1px solid ${color.border.strong}`,
                        borderRadius: value,
                      }}
                    />
                    <code style={monoLabel}>
                      radiusRole.{role} · {value}px
                    </code>
                  </div>
                ))}
              </SwatchGrid>
            </div>

            <div>
              <SubHeading hint="resting panels are flat; only floating layers shadow">
                Elevation roles
              </SubHeading>
              <SwatchGrid>
                {Object.entries(elevationRole).map(([role, value]) => (
                  <div
                    key={role}
                    style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}
                  >
                    <div
                      style={{
                        height: 56,
                        backgroundColor: color.background.surface,
                        borderRadius: radius.md,
                        border: `1px solid ${color.border.subtle}`,
                        boxShadow: value,
                      }}
                    />
                    <code style={monoLabel}>elevationRole.{role}</code>
                    <code style={{ ...hexValue, wordBreak: "break-all" }}>{value}</code>
                  </div>
                ))}
              </SwatchGrid>
            </div>

            <div>
              <SubHeading hint="one accent per screen — iris for focus/selection/active">
                Single-accent policy
              </SubHeading>
              <SwatchGrid>
                <Swatch name="accentPolicy.accent" value={accentPolicy.accent} />
                <Swatch name="accentPolicy.soft" value={accentPolicy.soft} />
                <Swatch name="accentPolicy.ink" value={accentPolicy.ink} />
                <Swatch name="accentPolicy.deep" value={accentPolicy.deep} />
                <Swatch name="accentPolicy.secondary" value={accentPolicy.secondary} />
              </SwatchGrid>
              <p
                style={{
                  ...fontSans,
                  margin: `${spacing[3]}px 0 0`,
                  fontSize: typography.fontSize.sm,
                  color: color.text.secondary,
                }}
              >
                {accentPolicy.rule}
              </p>
            </div>
          </Stack>
        </SectionCard>

        {/* ------------------------- Wave 0 formatters ------------------------- */}
        <SectionCard
          title="Wave 0 — number and money formatting"
          meta="format.ts · decimal strings only, never floats"
          headingLevel={2}
        >
          <Stack gap={spacing[5]}>
            <div>
              <SubHeading hint="grouping only, no rounding, no parsing">groupDecimal</SubHeading>
              <Row>
                <code style={monoLabel}>groupDecimal(&quot;1234567.8900&quot;)</code>
                <code style={{ ...monoLabel, color: color.text.primary }}>
                  {groupDecimal("1234567.8900")}
                </code>
              </Row>
            </div>

            <div>
              <SubHeading hint="grouped, fixed-decimal, HALF_UP on the string">
                formatNumber
              </SubHeading>
              <Stack gap={spacing[2]}>
                <Row>
                  <code style={monoLabel}>formatNumber(&quot;118.205&quot;)</code>
                  <code style={{ ...monoLabel, color: color.text.primary }}>
                    {formatNumber("118.205")}
                  </code>
                </Row>
                <Row>
                  <code style={monoLabel}>
                    formatNumber(&quot;118.204&quot;, {"{ decimals: 2 }"})
                  </code>
                  <code style={{ ...monoLabel, color: color.text.primary }}>
                    {formatNumber("118.204", { decimals: 2 })}
                  </code>
                </Row>
                <Row>
                  <code style={monoLabel}>
                    formatNumber(&quot;1234.5&quot;, {"{ decimals: 0 }"})
                  </code>
                  <code style={{ ...monoLabel, color: color.text.primary }}>
                    {formatNumber("1234.5", { decimals: 0 })}
                  </code>
                </Row>
              </Stack>
            </div>

            <div>
              <SubHeading hint="the currency is appended after the grouped value">
                formatMoney
              </SubHeading>
              <Row>
                <code style={monoLabel}>
                  formatMoney(&quot;12345.6&quot;, {'{ currency: "NOK" }'})
                </code>
                <code style={{ ...monoLabel, color: color.text.primary }}>
                  {formatMoney("12345.6", { currency: "NOK" })}
                </code>
              </Row>
            </div>

            <div>
              <SubHeading hint="every tick names its unit; every axis names subject and unit">
                formatAxisValue / axisLabel
              </SubHeading>
              <Stack gap={spacing[2]}>
                <Row>
                  <code style={monoLabel}>formatAxisValue(&quot;1234.5&quot;, &quot;kg&quot;)</code>
                  <code style={{ ...monoLabel, color: color.text.primary }}>
                    {formatAxisValue("1234.5", "kg")}
                  </code>
                </Row>
                <Row>
                  <code style={monoLabel}>
                    axisLabel(&quot;Amount&quot;, &quot;NOK&quot;) → &quot;Quantity&quot;,
                    &quot;kg&quot;
                  </code>
                  <code style={{ ...monoLabel, color: color.text.primary }}>
                    {axisLabel("Amount", "NOK")} · {axisLabel("Quantity", "kg")}
                  </code>
                </Row>
              </Stack>
            </div>
          </Stack>
        </SectionCard>

        {/* --------------------- Wave 0 explainability / disclosure -------------- */}
        <SectionCard
          title="Wave 0 — explainability and disclosure"
          meta="InfoTip · Collapsible · FileField"
          headingLevel={2}
        >
          <Stack gap={spacing[6]}>
            <div>
              <SubHeading hint="hover/focus only — never for required instructions">
                InfoTip
              </SubHeading>
              <p
                style={{
                  ...fontSans,
                  margin: 0,
                  fontSize: typography.fontSize.md,
                  color: color.text.secondary,
                }}
              >
                Food cost % is the cost of goods sold as a share of net sales for the scope.
                <InfoTip
                  content="(COGS ÷ net sales) × 100, HALF_UP, period 1–20 Sep 2026."
                  label="How food cost % is calculated"
                />{" "}
                Focus the (i) or hover it with the pointer to reveal the definition.
              </p>
            </div>

            <div>
              <SubHeading hint="native details/summary — keyboard operable, no client state, no layout jump">
                Collapsible
              </SubHeading>
              <div
                style={{
                  border: `1px solid ${color.border.subtle}`,
                  borderRadius: radius.md,
                  padding: `0 ${spacing[4]}px`,
                  backgroundColor: color.background.surface,
                }}
              >
                <Collapsible summary="Provenance and history" badge={<Badge>3 events</Badge>}>
                  <Stack gap={spacing[2]}>
                    <span
                      style={{
                        ...fontSans,
                        fontSize: typography.fontSize.sm,
                        color: color.text.secondary,
                      }}
                    >
                      Imported from the Wolt settlement export on 20 Sep 2026 08:12.
                    </span>
                    <span
                      style={{
                        ...fontSans,
                        fontSize: typography.fontSize.sm,
                        color: color.text.secondary,
                      }}
                    >
                      Reconciled against the bank statement on 20 Sep 2026 09:40.
                    </span>
                  </Stack>
                </Collapsible>
                <Collapsible summary="Open by default" defaultOpen badge={<Badge>config</Badge>}>
                  <span
                    style={{
                      ...fontSans,
                      fontSize: typography.fontSize.sm,
                      color: color.text.secondary,
                    }}
                  >
                    Secondary sections start collapsed; pass `defaultOpen` (or native `open`) for
                    the ones that must be visible.
                  </span>
                </Collapsible>
              </div>
            </div>

            <div>
              <SubHeading hint="the native file input dressed to match the field family">
                FileField
              </SubHeading>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                  gap: spacing[5],
                }}
              >
                <FileField
                  name="demo-attachment"
                  label="Attachment"
                  accept="image/*,.pdf"
                  help="Upload the supplier invoice (PDF or image)."
                />
                <FileField
                  name="demo-attachment-error"
                  label="Import file"
                  accept=".csv"
                  error="The file must be a comma-separated values export."
                />
              </div>
            </div>
          </Stack>
        </SectionCard>

        {/* ------------------------ Wave 0 metric band ------------------------- */}
        <SectionCard
          title="Wave 0 — metric band and plain empty state"
          meta="MetricHero · MetricSecondary · MetricBand · EmptyState variant=plain"
          headingLevel={2}
        >
          <Stack gap={spacing[6]}>
            <div>
              <SubHeading hint="one ranked hero, then a quiet secondary row on a hairline band">
                MetricBand
              </SubHeading>
              <MetricBand
                hero={
                  <MetricHero
                    label="Food cost %"
                    value={formatNumber("28.4", { decimals: 1 })}
                    unit="%"
                    delta="+0.6pp"
                    trend="up"
                    comparison="vs same period last month"
                    meta="1–20 Sep 2026 · Lisbon · updated 08:12"
                    info={
                      <InfoTip
                        content="(COGS ÷ net sales) × 100, HALF_UP, period 1–20 Sep 2026."
                        label="How food cost % is calculated"
                      />
                    }
                  />
                }
                metrics={[
                  <MetricSecondary
                    key="margin"
                    label="Gross margin"
                    value={formatMoney("18420", { currency: "€" })}
                    meta="1–20 Sep 2026 · all locations"
                  />,
                  <MetricSecondary
                    key="waste"
                    label="Waste value"
                    value={formatMoney("412", { currency: "€" })}
                    meta="1–20 Sep 2026 · Cascais"
                  />,
                ]}
              />
            </div>

            <div>
              <SubHeading hint="plain drops the surface and border for use inside an existing panel">
                EmptyState variant=&quot;plain&quot;
              </SubHeading>
              <Panel title="Recent variances" meta="scope: Aquarela Cascais" headingLevel={3}>
                <EmptyState
                  variant="plain"
                  title="No variances recorded"
                  action={
                    <Button variant="secondary" size="sm">
                      Start a count
                    </Button>
                  }
                >
                  No count has been submitted for this scope, so nothing is waiting for review.
                </EmptyState>
              </Panel>
            </div>
          </Stack>
        </SectionCard>

        {/* ------------------------ Wave 0 modal and toast --------------------- */}
        <SectionCard
          title="Wave 0 — creation modal and success toast"
          meta="FormModal · SuccessToast"
          headingLevel={2}
        >
          <Stack gap={spacing[5]}>
            <div>
              <SubHeading hint="the one create/edit shape: register header carries one primary button, never an inline form">
                FormModal
              </SubHeading>
              <FormModalDemo />
            </div>
            <div>
              <SubHeading hint="transient post-mutation confirmation; use Alert for persistent status">
                SuccessToast
              </SubHeading>
              <SuccessToastDemo />
            </div>
          </Stack>
        </SectionCard>

        {/* ---------------------------- Spacing / radius ----------------------- */}
        <SectionCard title="Spacing, radius and elevation" meta="scale tokens" headingLevel={2}>
          <Stack gap={spacing[6]}>
            <div>
              <SubHeading hint="4px base unit">Spacing</SubHeading>
              <Stack gap={spacing[2]}>
                {Object.entries(spacing).map(([step, value]) => (
                  <div
                    key={step}
                    style={{ display: "flex", alignItems: "center", gap: spacing[3] }}
                  >
                    <code style={{ ...monoLabel, minWidth: 150 }}>
                      spacing.{step} · {value}px
                    </code>
                    <div
                      style={{
                        width: value === 0 ? 2 : value,
                        height: 20,
                        backgroundColor: color.brand.navy,
                        borderRadius: radius.sm,
                        flexShrink: 0,
                      }}
                    />
                  </div>
                ))}
              </Stack>
            </div>

            <div>
              <SubHeading>Radius</SubHeading>
              <SwatchGrid>
                {Object.entries(radius).map(([name, value]) => (
                  <div
                    key={name}
                    style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}
                  >
                    <div
                      style={{
                        height: 56,
                        backgroundColor: color.background.surfaceAlt,
                        border: `1px solid ${color.border.strong}`,
                        borderRadius: value,
                      }}
                    />
                    <code style={monoLabel}>
                      radius.{name} · {value}px
                    </code>
                  </div>
                ))}
              </SwatchGrid>
            </div>

            <div>
              <SubHeading hint="tuned for the cool neutral canvas #F1F3F8">Elevation</SubHeading>
              <SwatchGrid>
                {Object.entries(elevation).map(([name, value]) => (
                  <div
                    key={name}
                    style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}
                  >
                    <div
                      style={{
                        height: 56,
                        backgroundColor: color.background.surface,
                        borderRadius: radius.md,
                        boxShadow: value,
                        border: `1px solid ${color.border.subtle}`,
                      }}
                    />
                    <code style={monoLabel}>elevation.{name}</code>
                    <code style={{ ...hexValue, wordBreak: "break-all" }}>{value}</code>
                  </div>
                ))}
              </SwatchGrid>
            </div>
          </Stack>
        </SectionCard>

        {/* ------------------------------ Buttons ------------------------------ */}
        <SectionCard title="Buttons" meta="variants × sizes · loading · disabled" headingLevel={2}>
          <Stack gap={spacing[5]}>
            {(["primary", "secondary", "danger", "ghost"] as const).map((variant) => (
              <div key={variant}>
                <code style={{ ...monoLabel, display: "block", marginBottom: spacing[2] }}>
                  variant=&quot;{variant}&quot;
                </code>
                <Row>
                  <Button variant={variant} size="sm">
                    Small
                  </Button>
                  <Button variant={variant} size="md">
                    Medium
                  </Button>
                  <Button variant={variant} size="lg">
                    Large
                  </Button>
                  <Button variant={variant} size="md" loading>
                    Posting
                  </Button>
                  <Button variant={variant} size="md" disabled>
                    Disabled
                  </Button>
                </Row>
              </div>
            ))}
          </Stack>
        </SectionCard>

        {/* ----------------------------- Text fields --------------------------- */}
        <SectionCard
          title="Text fields"
          meta="help · error · suffix · required · disabled"
          headingLevel={2}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: spacing[5],
            }}
          >
            <TextField
              name="unit-cost"
              label="Unit cost"
              help="Pair every numeric quantity with a unit (08_UI_UX.md §8.5)."
              suffix="€/kg"
              inputMode="decimal"
              defaultValue="12.40"
            />
            <TextField
              name="quantity"
              label="Counted quantity"
              error="Variance exceeds the ±2% tolerance for this item."
              suffix="kg"
              inputMode="decimal"
              defaultValue="118.20"
            />
            <TextField name="supplier" label="Supplier" required placeholder="Search suppliers…" />
            <TextField
              name="lot"
              label="Lot code"
              disabled
              defaultValue="LOT-2026-0918"
              help="Disabled while the receipt is locked."
            />
          </div>
        </SectionCard>

        {/* -------------------------- Alerts / status -------------------------- */}
        <SectionCard
          title="Alerts, badges and status pills"
          meta="status tone rules (§8.4)"
          headingLevel={2}
        >
          <Stack gap={spacing[5]}>
            <Stack gap={spacing[3]}>
              <Alert tone="info" title="Information">
                Sales import finished; 1,204 rows are ready to review before posting.
              </Alert>
              <Alert tone="success" title="Healthy">
                Stock cover for all locations is above the 7-day threshold.
              </Alert>
              <Alert tone="warning" title="Variance warning">
                Threshold 2% · evidence: count vs system differ by 4.1% · owner: FOH lead · next
                action: recount before approval.
              </Alert>
              <Alert tone="danger" title="Posting blocked">
                The period is locked, so this receipt cannot be posted. Reopen the period or move
                the date.
              </Alert>
            </Stack>

            <div>
              <code style={{ ...monoLabel, display: "block", marginBottom: spacing[2] }}>
                Badge
              </code>
              <Row>
                <Badge>Draft</Badge>
                <Badge>v3</Badge>
                <Badge>Lot-tracked</Badge>
                <Badge>Autosaved 12:04</Badge>
              </Row>
            </div>

            <div>
              <code style={{ ...monoLabel, display: "block", marginBottom: spacing[2] }}>
                StatusPill · filled dot for warning/danger, hollow otherwise
              </code>
              <Row>
                <StatusPill tone="info">Imported</StatusPill>
                <StatusPill tone="success">Posted</StatusPill>
                <StatusPill tone="warning">Needs review</StatusPill>
                <StatusPill tone="danger">Blocked</StatusPill>
              </Row>
            </div>
          </Stack>
        </SectionCard>

        {/* ------------------------------- Tables ------------------------------ */}
        <SectionCard title="Tables" meta="caption · populated · empty" headingLevel={2}>
          <Stack gap={spacing[6]}>
            <Table
              caption="Stock by location — period 1–20 Sep 2026 · scope: Aquarela Lisbon"
              columnCount={4}
            >
              <thead>
                <tr>
                  <Th>Item</Th>
                  <Th>Location</Th>
                  <Th>Balance</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <Td>Olive oil 5L</Td>
                  <Td>Lisbon</Td>
                  <Td>42 L</Td>
                  <Td>
                    <StatusPill tone="success">OK</StatusPill>
                  </Td>
                </tr>
                <tr>
                  <Td>San Marzano tomatoes</Td>
                  <Td>Lisbon</Td>
                  <Td>6 kg</Td>
                  <Td>
                    <StatusPill tone="warning">Low</StatusPill>
                  </Td>
                </tr>
                <tr>
                  <Td>Fresh basil</Td>
                  <Td>Cascais</Td>
                  <Td>0.4 kg</Td>
                  <Td>
                    <StatusPill tone="danger">Expiring</StatusPill>
                  </Td>
                </tr>
              </tbody>
            </Table>

            <Table
              caption="Count variances — scope: Aquarela Cascais"
              columnCount={3}
              emptyMessage="No variances recorded for this count. Nothing needs review."
            />
          </Stack>
        </SectionCard>

        {/* -------------------------- KPI / sparkline -------------------------- */}
        <SectionCard
          title="Dashboard signals"
          meta="KPI cards · sparkline · empty state"
          headingLevel={2}
        >
          <Stack gap={spacing[6]}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                gap: spacing[4],
              }}
            >
              <KpiCard
                label="Food cost %"
                value="28.4%"
                delta="+0.6pp"
                meta="1–20 Sep 2026 · Lisbon · vs same period last month · updated 08:12"
              />
              <KpiCard
                label="Gross margin"
                value="€18,420"
                delta="-2.1%"
                meta="1–20 Sep 2026 · all locations · vs forecast · updated 08:12"
              />
              <KpiCard
                label="Waste value"
                value="€412"
                meta="1–20 Sep 2026 · Cascais · vs prior period · updated 08:12"
              />
            </div>

            <div>
              <SubHeading hint="charts answer a named management question (§8.4)">
                Sparkline
              </SubHeading>
              <div
                style={{
                  display: "inline-flex",
                  flexDirection: "column",
                  gap: spacing[2],
                  backgroundColor: color.background.surface,
                  border: `1px solid ${color.border.subtle}`,
                  borderRadius: radius.md,
                  padding: spacing[4],
                }}
              >
                <Sparkline
                  points={[28.1, 28.4, 27.9, 28.6, 28.2, 28.9, 28.4]}
                  tone="berry"
                  width={220}
                  height={48}
                  ariaLabel="Is food cost percentage trending above the 28% target?"
                />
                <span
                  style={{ ...fontSans, fontSize: typography.fontSize.sm, color: color.text.muted }}
                >
                  Is food cost percentage trending above the 28% target?
                </span>
              </div>
              <Row gap={spacing[4]}>
                {(["navy", "berry", "green", "gold"] as const).map((tone) => (
                  <Sparkline
                    key={tone}
                    points={[3, 5, 4, 6, 5, 7]}
                    tone={tone}
                    ariaLabel={`Sparkline tone ${tone}`}
                  />
                ))}
              </Row>
            </div>

            <EmptyState
              title="No sales data for this period"
              action={
                <Button variant="secondary" size="sm">
                  Import sales
                </Button>
              }
            >
              No sales source has been imported for 1–20 Sep 2026 at Aquarela Cascais. Import a
              sales file or adjust the scope to see figures.
            </EmptyState>
          </Stack>
        </SectionCard>

        {/* --------------------------- Shell primitives ------------------------ */}
        <SectionCard
          title="Shell primitives"
          meta="nav list · scope bar · watercolor backdrop"
          headingLevel={2}
        >
          <Stack gap={spacing[6]}>
            <div>
              <SubHeading hint="transparent rows on the light canvas, lavender tint with the iris cue when active">
                NavList / NavItem
              </SubHeading>
              <div style={{ maxWidth: 280, borderRadius: radius.md, overflow: "hidden" }}>
                <NavList>
                  <NavItem label="Home" href="#" active />
                  <NavItem label="Sales" href="#" />
                  <NavItem label="Inventory" href="#" />
                  <NavItem label="Production" href="#" />
                  <NavItem label="Administration" href="#" />
                </NavList>
              </div>
            </div>

            <div>
              <SubHeading hint="company · location · date context (§8.1)">ScopeBar</SubHeading>
              <ScopeBar
                company="Aquarela Lisbon"
                location="Lisbon · Main kitchen"
                dateLabel="1–20 Sep 2026"
              />
            </div>

            <div>
              <SubHeading hint="legacy §8.7 backdrop, superseded by DEC-120 — kept for sign-in and empty states only">
                WatercolorBackdrop
              </SubHeading>
              <div
                style={{
                  position: "relative",
                  height: 160,
                  borderRadius: radius.lg,
                  overflow: "hidden",
                  border: `1px solid ${color.border.subtle}`,
                }}
              >
                <WatercolorBackdrop />
                <div style={{ position: "relative", padding: spacing[5] }}>
                  <span
                    style={{
                      ...fontSans,
                      fontSize: typography.fontSize.sm,
                      color: color.text.secondary,
                    }}
                  >
                    Two low-opacity washes in the lavender and info tints over the cool canvas — the
                    legacy §8.7 backdrop, superseded by DEC-120 and re-tinted by DEC-129.
                  </span>
                </div>
              </div>
            </div>
          </Stack>
        </SectionCard>

        {/* ---------------------------- Card / Panel --------------------------- */}
        <SectionCard title="Surfaces" meta="Card elevations · Panel" headingLevel={2}>
          <Stack gap={spacing[5]}>
            <Row gap={spacing[5]}>
              {(["flat", "raised", "floating"] as const).map((level) => (
                <Card key={level} elevation={level}>
                  <code style={monoLabel}>Card elevation=&quot;{level}&quot;</code>
                  <p
                    style={{
                      ...fontSans,
                      margin: `${spacing[2]}px 0 0`,
                      fontSize: typography.fontSize.sm,
                      color: color.text.secondary,
                    }}
                  >
                    A surface on the cool neutral page.
                  </p>
                </Card>
              ))}
            </Row>
            <Panel title="Panel" meta="titled card section" headingLevel={3}>
              <p
                style={{
                  ...fontSans,
                  margin: 0,
                  fontSize: typography.fontSize.md,
                  color: color.text.secondary,
                }}
              >
                Panel pairs a display title with an optional meta line and arbitrary content.
              </p>
            </Panel>
          </Stack>
        </SectionCard>
      </Stack>
    </div>
  );
}
