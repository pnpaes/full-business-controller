/**
 * Dependency-free chart primitives for the Aquarela Business Controller
 * (`designer-agent-modern-saas-ui-brief.md` §10; DEC-120).
 *
 * Hand-rolled inline SVG, token-driven: thin strokes, generous whitespace,
 * subtle grid lines, sparse axis labels, one strong accent series plus an
 * optional pale neutral comparison series. No rainbow palettes, no 3D, no
 * heavy legends.
 *
 * Server-component compatible: no hooks, no effects. Charts are static
 * (no animation), so reduced motion is respected by construction.
 *
 * Accessibility: every chart is `role="img"` with a required `ariaLabel`
 * (§7.8: charts answer a named management question) and accepts an optional
 * `summary` rendered as visually-hidden text.
 */
import type { CSSProperties, ReactNode } from "react";

import { color, typography } from "./tokens";

/** Strong accent series colour (text-safe accent, brief §3/§10). */
const accentStroke = color.accent.deep;
/** Comparison series: carries real information, so ≥3:1 on the surfaces
 * (WCAG 1.4.11) while staying clearly secondary to the accent series. */
const comparisonStroke = color.dataViz.comparison;
/* Grid lines are decorative (WCAG 1.4.11 exempt): the data is carried by the
 * series strokes, the axis labels and the accessible summary, so they stay
 * quiet (brief §10: "subtle grid lines, sparse axis labeling") at
 * border.default — raised from border.subtle but never prominent. */
const gridStroke = color.border.default;
const axisLabelColor = color.ink.tertiary;

const AXIS_LABEL_FONT_SIZE = typography.fontSize["2xs"];

const visuallyHidden: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
};

/** Wraps an SVG plus an optional visually-hidden summary text. */
function ChartFrame({ svg, summary }: { svg: ReactNode; summary?: string | undefined }) {
  if (!summary) return <>{svg}</>;
  return (
    <span style={{ display: "inline-block" }}>
      {svg}
      <span style={visuallyHidden}>{summary}</span>
    </span>
  );
}

/** Map values to SVG coordinates with even x spacing and a shared y range. */
function scaleSeries(
  values: readonly number[],
  width: number,
  height: number,
  pad: number,
  min: number,
  max: number,
): Array<{ x: number; y: number }> {
  const range = max - min;
  const stepX = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  return values.map((point, index) => {
    const x = pad + stepX * index;
    const ratio = range === 0 ? 0.5 : (point - min) / range;
    const y = pad + (height - pad * 2) * (1 - ratio);
    return { x, y };
  });
}

/** Bar-specific y mapping: a zero-value bar draws at zero height, while a
 * flat non-zero series keeps a sane mid-plot rendering. */
function barYFor(value: number, min: number, max: number, padTop: number, plotH: number): number {
  const range = max - min;
  const ratio = range === 0 ? (value === 0 ? 0 : 0.5) : (value - min) / range;
  return padTop + plotH * (1 - ratio);
}

/** Shared min/max across the accent and comparison series. */
function combinedRange(a: readonly number[], b?: readonly number[]) {
  const all = b ? [...a, ...b] : [...a];
  return { min: Math.min(...all), max: Math.max(...all) };
}

/** Sparse x-axis labels: first, middle and last only (brief §10). */
function sparseIndices(count: number): number[] {
  if (count <= 4) return Array.from({ length: count }, (_, i) => i);
  return [0, Math.floor((count - 1) / 2), count - 1];
}

/* --------------------------------- LineChart -------------------------------- */

export interface LineChartProps {
  /** Accent series values in render order. */
  points: readonly number[];
  /** Optional pale neutral comparison series (same x count ideally). */
  comparisonPoints?: readonly number[];
  width?: number;
  height?: number;
  /** X-axis labels; rendered sparsely (first/middle/last). */
  xLabels?: readonly string[];
  /** Index of an anomaly/active point to highlight. */
  highlightIndex?: number;
  /** Optional direct label drawn at the end of the accent line. */
  directLabel?: string;
  /** Required accessible name (§7.8). */
  ariaLabel: string;
  /** Optional visually-hidden longer description. */
  summary?: string | undefined;
}

/**
 * Thin-stroke line chart: one strong accent series, optional pale comparison,
 * subtle horizontal grid lines only, sparse labels, optional direct labeling
 * and a highlighted anomaly/active point (brief §10).
 */
export function LineChart({
  points,
  comparisonPoints,
  width = 480,
  height = 200,
  xLabels,
  highlightIndex,
  directLabel,
  ariaLabel,
  summary,
}: LineChartProps) {
  const pad = { top: 12, right: directLabel ? 72 : 12, bottom: xLabels ? 20 : 8, left: 12 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  // Empty series: no geometry — render the quiet frame (grid + baseline)
  // rather than letting Infinity/NaN reach the polyline points.
  const empty = points.length === 0;
  const { min, max } = empty ? { min: 0, max: 1 } : combinedRange(points, comparisonPoints);
  const xy = empty
    ? []
    : scaleSeries(points, plotW, plotH, 0, min, max).map((c) => ({
        x: c.x + pad.left,
        y: c.y + pad.top,
      }));
  const line = xy.map((c) => `${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(" ");
  const last = xy[xy.length - 1];

  const comparisonLine =
    !empty && comparisonPoints && comparisonPoints.length > 0
      ? scaleSeries(comparisonPoints, plotW, plotH, 0, min, max)
          .map((c) => `${(c.x + pad.left).toFixed(2)},${(c.y + pad.top).toFixed(2)}`)
          .join(" ")
      : null;

  // Subtle horizontal grid lines only (brief §10): three quiet rules.
  const gridYs = [0.25, 0.5, 0.75].map((t) => pad.top + plotH * t);

  const labelIndices = xLabels ? sparseIndices(points.length) : [];
  const highlight = highlightIndex !== undefined && xy[highlightIndex] ? xy[highlightIndex] : null;

  const svg = (
    <svg
      role="img"
      aria-label={ariaLabel}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: "block" }}
    >
      {gridYs.map((y) => (
        <line
          key={y}
          x1={pad.left}
          x2={pad.left + plotW}
          y1={y}
          y2={y}
          stroke={gridStroke}
          strokeWidth={1}
        />
      ))}
      {/* Subtle baseline. */}
      <line
        x1={pad.left}
        x2={pad.left + plotW}
        y1={pad.top + plotH}
        y2={pad.top + plotH}
        stroke={gridStroke}
        strokeWidth={1}
      />
      {comparisonLine ? (
        <polyline
          points={comparisonLine}
          fill="none"
          stroke={comparisonStroke}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {!empty ? (
        <polyline
          points={line}
          fill="none"
          stroke={accentStroke}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {highlight ? (
        <g>
          <circle cx={highlight.x} cy={highlight.y} r={6} fill={accentStroke} opacity={0.18} />
          <circle cx={highlight.x} cy={highlight.y} r={3} fill={accentStroke} />
        </g>
      ) : null}
      {directLabel && last ? (
        <text
          x={last.x + 8}
          y={last.y + 4}
          fill={color.ink.primary}
          fontSize={AXIS_LABEL_FONT_SIZE}
          fontWeight={typography.fontWeight.medium}
        >
          {directLabel}
        </text>
      ) : null}
      {xLabels
        ? labelIndices.map((i) =>
            xy[i] ? (
              <text
                key={i}
                x={xy[i].x}
                y={height - 4}
                textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
                fill={axisLabelColor}
                fontSize={AXIS_LABEL_FONT_SIZE}
              >
                {xLabels[i]}
              </text>
            ) : null,
          )
        : null}
    </svg>
  );

  return <ChartFrame svg={svg} summary={summary} />;
}

/* --------------------------------- BarChart --------------------------------- */

export interface BarChartProps {
  /** Accent series values, one bar each. */
  values: readonly number[];
  /** Optional pale neutral comparison values (one per bar). */
  comparisonValues?: readonly number[];
  width?: number;
  height?: number;
  /** Category labels; rendered sparsely (first/middle/last). */
  labels?: readonly string[];
  /** Index of a bar to highlight (e.g. the current period). */
  highlightIndex?: number;
  /** Required accessible name (§7.8). */
  ariaLabel: string;
  /** Optional visually-hidden longer description. */
  summary?: string | undefined;
}

/**
 * Thin bars with rounded ends, one accent series plus an optional pale
 * comparison series, sparse labels and a subtle baseline (brief §10).
 */
export function BarChart({
  values,
  comparisonValues,
  width = 480,
  height = 200,
  labels,
  highlightIndex,
  ariaLabel,
  summary,
}: BarChartProps) {
  const pad = { top: 12, right: 12, bottom: labels ? 20 : 8, left: 12 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const { min, max } = combinedRange(values, comparisonValues);
  const slot = plotW / values.length;
  const barW = Math.min(14, slot * 0.5);
  const baselineY = pad.top + plotH;

  const yFor = (v: number) => barYFor(v, min, max, pad.top, plotH);

  const labelIndices = labels ? sparseIndices(values.length) : [];

  const svg = (
    <svg
      role="img"
      aria-label={ariaLabel}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: "block" }}
    >
      {/* Subtle baseline only — no vertical grid (brief §10). */}
      <line
        x1={pad.left}
        x2={pad.left + plotW}
        y1={baselineY}
        y2={baselineY}
        stroke={gridStroke}
        strokeWidth={1}
      />
      {comparisonValues
        ? comparisonValues.map((v, i) => {
            const x = pad.left + slot * i + (slot - barW) / 2;
            const y = yFor(v);
            return (
              <rect
                key={`c${i}`}
                x={x}
                y={y}
                width={barW}
                height={Math.max(baselineY - y, 0)}
                rx={Math.min(barW / 2, 4)}
                fill={comparisonStroke}
              />
            );
          })
        : null}
      {values.map((v, i) => {
        const x = pad.left + slot * i + (slot - barW) / 2;
        const y = yFor(v);
        const isHighlight = highlightIndex === i;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barW}
            height={Math.max(baselineY - y, 0)}
            rx={Math.min(barW / 2, 6)}
            fill={isHighlight ? color.ink.primary : accentStroke}
            opacity={isHighlight ? 1 : 0.9}
          />
        );
      })}
      {labels
        ? labelIndices.map((i) => (
            <text
              key={i}
              x={pad.left + slot * i + slot / 2}
              y={height - 4}
              textAnchor="middle"
              fill={axisLabelColor}
              fontSize={AXIS_LABEL_FONT_SIZE}
            >
              {labels[i]}
            </text>
          ))
        : null}
    </svg>
  );

  return <ChartFrame svg={svg} summary={summary} />;
}

/* -------------------------------- DonutChart -------------------------------- */

export interface DonutChartProps {
  /** The primary share (same unit as `total`). */
  value: number;
  /** The whole the share is taken from. */
  total: number;
  /** Prominent metric rendered in the centre (e.g. "62%"). */
  centerLabel: ReactNode;
  /** Optional small caption under the centre metric. */
  centerCaption?: string;
  size?: number;
  /** Required accessible name (§7.8). */
  ariaLabel: string;
  /** Optional visually-hidden longer description. */
  summary?: string | undefined;
}

/**
 * A thin ring for one meaningful proportion (brief §10): the accent marks the
 * primary share, a pale neutral the remainder, and a prominent metric sits in
 * the centre. Not a categorical rainbow — exactly two colours.
 */
export function DonutChart({
  value,
  total,
  centerLabel,
  centerCaption,
  size = 160,
  ariaLabel,
  summary,
}: DonutChartProps) {
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const ratio = total === 0 ? 0 : Math.max(0, Math.min(1, value / total));
  const dash = `${(c * ratio).toFixed(2)} ${(c * (1 - ratio)).toFixed(2)}`;

  const svg = (
    <svg
      role="img"
      aria-label={ariaLabel}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ display: "block" }}
    >
      {/* Pale neutral remainder. */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={comparisonStroke}
        strokeWidth={stroke}
      />
      {/* Accent primary share, starting at 12 o'clock. */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={accentStroke}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={dash}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%"
        y={centerCaption ? "47%" : "52%"}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={color.ink.primary}
        fontSize={typography.fontSize["2xl"]}
        fontWeight={typography.fontWeight.regular}
        style={{ fontVariantNumeric: typography.fontVariantNumeric.tabular }}
      >
        {centerLabel}
      </text>
      {centerCaption ? (
        <text
          x="50%"
          y="63%"
          textAnchor="middle"
          dominantBaseline="middle"
          fill={axisLabelColor}
          fontSize={AXIS_LABEL_FONT_SIZE}
        >
          {centerCaption}
        </text>
      ) : null}
    </svg>
  );

  return <ChartFrame svg={svg} summary={summary} />;
}

/* ------------------------------- RadialMetric ------------------------------- */

export interface RadialMetricProps {
  /** Gauge fill 0–100. */
  percent: number;
  /** Prominent metric rendered in the centre (e.g. "128,430"). */
  value: ReactNode;
  /** Optional small caption under the value (e.g. the measure name). */
  caption?: string;
  size?: number;
  /** Required accessible name (§7.8). */
  ariaLabel: string;
  /** Optional visually-hidden longer description. */
  summary?: string | undefined;
}

/**
 * A single-value radial gauge paired with a large metric (brief §10: "large
 * circular diagrams paired with a prominent metric"): a thin pale track, an
 * accent arc for the value and a large light tabular number in the centre.
 */
export function RadialMetric({
  percent,
  value,
  caption,
  size = 200,
  ariaLabel,
  summary,
}: RadialMetricProps) {
  const stroke = 8;
  const r = (size - stroke * 2) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, percent));
  const dash = `${((c * clamped) / 100).toFixed(2)} ${(c * (1 - clamped / 100)).toFixed(2)}`;

  const svg = (
    <svg
      role="img"
      aria-label={ariaLabel}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ display: "block" }}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={comparisonStroke}
        strokeWidth={stroke}
        opacity={0.5}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={accentStroke}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={dash}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%"
        y={caption ? "47%" : "52%"}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={color.ink.primary}
        fontSize={typography.fontSize["4xl"]}
        fontWeight={typography.fontWeight.regular}
        style={{ fontVariantNumeric: typography.fontVariantNumeric.tabular }}
      >
        {value}
      </text>
      {caption ? (
        <text
          x="50%"
          y="64%"
          textAnchor="middle"
          dominantBaseline="middle"
          fill={axisLabelColor}
          fontSize={AXIS_LABEL_FONT_SIZE}
        >
          {caption}
        </text>
      ) : null}
    </svg>
  );

  return <ChartFrame svg={svg} summary={summary} />;
}
