/**
 * Application-shell primitives for the Aquarela Business Controller.
 *
 * Visual direction: `designer-agent-modern-saas-ui-brief.md` (modern editorial
 * SaaS), recorded as DEC-120 — supersedes 08_UI_UX.md §8.7 for visuals only.
 * Accessibility, business logic and the component APIs are unchanged
 * (08_UI_UX.md §8.3–§8.9, 07_SECURITY_AND_NFR.md §7.8 still govern behaviour).
 *
 * Server-component compatible: no hooks, no effects, no client state.
 * All styling is token-driven inline styles; the few rules inline styles
 * cannot express (hover) live in `uiGlobalCss` (components.tsx).
 */
import type { ReactNode } from "react";

import { MIN_TOUCH_TARGET_PX } from "./components";
import { color, elevation, motion, radius, spacing, typography } from "./tokens";

const fontSans = { fontFamily: typography.fontFamily.sans } as const;
const fontDisplay = { fontFamily: typography.fontFamily.display } as const;

/* ------------------------------- Navigation -------------------------------- */

export interface NavItemProps {
  /** Visible row label. */
  label: string;
  /** Optional leading glyph; callers pass inline SVG. Decorative (`aria-hidden`). */
  icon?: ReactNode;
  /** Marks the current area; sets `aria-current="page"` and the quiet cues (§6). */
  active?: boolean;
  /** Destination. Rendered as a plain `<a>`; the app router owns real hrefs. */
  href?: string;
}

/**
 * One slim, quiet navigation row (brief §6): ≥44px tall, muted text, and for
 * the current area a tinted background, a thin 2px accent indicator and
 * slightly stronger text — never a large filled primary block.
 *
 * Hover cannot be expressed inline (server component), so the row carries the
 * `aquarela-nav-item` class backed by a rule in `uiGlobalCss`.
 */
export function NavItem({ label, icon, active = false, href }: NavItemProps) {
  return (
    <a
      href={href}
      aria-current={active ? "page" : undefined}
      className="aquarela-nav-item"
      style={{
        ...fontSans,
        display: "flex",
        alignItems: "center",
        gap: spacing[3],
        minHeight: MIN_TOUCH_TARGET_PX,
        padding: `${spacing[2]}px ${spacing[4]}px`,
        color: active ? color.navigation.active : color.navigation.textMuted,
        backgroundColor: active ? color.navigation.backgroundHover : "transparent",
        borderLeft: `2px solid ${active ? color.navigation.active : "transparent"}`,
        textDecoration: "none",
        fontSize: typography.fontSize.md,
        fontWeight: active ? typography.fontWeight.medium : typography.fontWeight.regular,
        transition: `color ${motion.duration.fast}ms ${motion.easing}, background-color ${motion.duration.fast}ms ${motion.easing}`,
      }}
    >
      {icon ? (
        <span aria-hidden="true" style={{ display: "inline-flex", flexShrink: 0 }}>
          {icon}
        </span>
      ) : null}
      <span>{label}</span>
    </a>
  );
}

export interface NavListProps {
  children: ReactNode;
}

/** Vertical stack of `NavItem`s on the dark-neutral navigation surface (§6). */
export function NavList({ children }: NavListProps) {
  return (
    <nav
      aria-label="Primary"
      style={{
        ...fontSans,
        display: "flex",
        flexDirection: "column",
        backgroundColor: color.navigation.background,
        padding: `${spacing[2]}px 0`,
      }}
    >
      {children}
    </nav>
  );
}

/* --------------------------------- ScopeBar -------------------------------- */

export interface ScopeBarProps {
  /** Company/legal entity in scope. */
  company: string;
  /** Location in scope. */
  location: string;
  /** Rendered date context, e.g. "1–20 Sep 2026". */
  dateLabel: string;
  /** How scope can be changed; replaces the default placeholder hint. */
  onChangeHint?: string;
}

/**
 * The persistent scope context from §8.1, rendered as quiet metadata (brief
 * §6/§21): no box, no shouting "placeholder" chip — the values themselves say
 * what they are. Display-only until the shell wires real controls (§8.4:
 * every figure shows its period and scope).
 */
export function ScopeBar({ company, location, dateLabel, onChangeHint }: ScopeBarProps) {
  return (
    <div
      style={{
        ...fontSans,
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: spacing[3],
        padding: `${spacing[1]}px 0`,
        fontSize: typography.fontSize.sm,
        color: color.text.secondary,
      }}
    >
      <span style={{ color: color.text.primary, fontWeight: typography.fontWeight.medium }}>
        {company}
      </span>
      <span aria-hidden="true" style={{ color: color.border.strong }}>
        ·
      </span>
      <span>{location}</span>
      <span aria-hidden="true" style={{ color: color.border.strong }}>
        ·
      </span>
      <span>{dateLabel}</span>
      <span style={{ color: color.text.muted, fontSize: typography.fontSize.xs }}>
        {onChangeHint ?? "Scope controls are not wired yet."}
      </span>
    </div>
  );
}

/* --------------------------------- KpiCard --------------------------------- */

export interface KpiCardProps {
  /** Small muted caption naming the measure. */
  label: string;
  /** The headline figure; preformatted by the caller (unit/currency pairing). */
  value: ReactNode;
  /** Movement text. Tone follows the leading sign: "+" green, "-" danger, else gold. */
  delta?: string;
  /** §8.4 line: period · scope · comparison · freshness. */
  meta: ReactNode;
  /** Optional tiny trend direction; renders a small arrow beside the delta. */
  trend?: "up" | "down" | "flat";
  /** Optional subtle comparison line under the value (e.g. "vs previous month"). */
  comparison?: ReactNode;
  /** Optional micro-chart, visually secondary to the number (brief §9). */
  sparkline?: {
    points: readonly number[];
    tone?: SparklineTone | undefined;
    comparisonPoints?: readonly number[] | undefined;
    ariaLabel: string;
  };
}

/** Sign → tone mapping for the delta chip (§8.7: green healthy, gold review). */
function deltaTone(delta: string) {
  if (delta.startsWith("+")) return color.status.success;
  if (delta.startsWith("-")) return color.status.danger;
  return color.status.warning;
}

const trendGlyphs = { up: "↗", down: "↘", flat: "→" } as const;

/**
 * The elegant metric module (brief §9): metadata-scale label, large light
 * tabular value, optional compact delta chip with trend arrow, optional
 * sparkline and comparison line, quiet meta. A calm module, not a heavy card.
 */
export function KpiCard({ label, value, delta, meta, trend, comparison, sparkline }: KpiCardProps) {
  const tone = delta ? deltaTone(delta) : null;
  return (
    <section
      style={{
        ...fontSans,
        display: "flex",
        flexDirection: "column",
        gap: spacing[2],
        backgroundColor: color.background.surface,
        border: `1px solid ${color.border.subtle}`,
        borderRadius: radius.xl,
        boxShadow: elevation.none,
        padding: spacing[5],
      }}
    >
      <span
        style={{
          fontSize: typography.fontSize.sm,
          fontWeight: typography.fontWeight.medium,
          color: color.text.muted,
        }}
      >
        {label}
      </span>
      <div style={{ display: "flex", alignItems: "baseline", gap: spacing[2], flexWrap: "wrap" }}>
        <span
          style={{
            ...fontDisplay,
            fontSize: typography.fontSize["4xl"],
            fontWeight: typography.fontWeight.regular,
            lineHeight: typography.lineHeight.display,
            letterSpacing: "-0.01em",
            fontVariantNumeric: typography.fontVariantNumeric.tabular,
            color: color.text.primary,
          }}
        >
          {value}
        </span>
        {delta && tone ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: spacing[1],
              fontSize: typography.fontSize.xs,
              fontWeight: typography.fontWeight.medium,
              color: tone.fg,
              backgroundColor: tone.bg,
              border: `1px solid ${color.border.subtle}`,
              borderRadius: radius.pill,
              padding: `0 ${spacing[2]}px`,
            }}
          >
            {trend ? <span aria-hidden="true">{trendGlyphs[trend]}</span> : null}
            {delta}
          </span>
        ) : null}
      </div>
      {comparison ? (
        <span
          style={{
            fontSize: typography.fontSize.xs,
            color: color.text.muted,
          }}
        >
          {comparison}
        </span>
      ) : null}
      {sparkline ? (
        <div style={{ marginTop: spacing[1], maxWidth: 220 }}>
          <Sparkline
            points={sparkline.points}
            tone={sparkline.tone}
            comparisonPoints={sparkline.comparisonPoints}
            ariaLabel={sparkline.ariaLabel}
            width={200}
            height={40}
          />
        </div>
      ) : null}
      <span
        style={{
          fontSize: typography.fontSize.xs,
          lineHeight: typography.lineHeight.normal,
          color: color.text.muted,
        }}
      >
        {meta}
      </span>
    </section>
  );
}

/* ------------------------------- SectionCard ------------------------------- */

export interface SectionCardProps {
  title: string;
  /** Optional meta line beside the title (e.g. period · scope). */
  meta?: ReactNode;
  /** Optional controls aligned right (buttons, filters). */
  actions?: ReactNode;
  children: ReactNode;
  /** Heading element for the title; default 2. Lower it for nested sections. */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
}

/**
 * A data panel (brief §7/§8): 20px radius, 1px subtle border, no shadow, a
 * surface one step above the canvas, module-title-scale heading and quiet
 * meta, with an `actions` slot.
 */
export function SectionCard({
  title,
  meta,
  actions,
  children,
  headingLevel = 2,
}: SectionCardProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <section
      style={{
        backgroundColor: color.background.surface,
        border: `1px solid ${color.border.subtle}`,
        borderRadius: radius["2xl"],
        boxShadow: elevation.none,
        padding: spacing[5],
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          flexWrap: "wrap",
          gap: spacing[3],
          marginBottom: spacing[4],
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: spacing[3],
            minWidth: 0,
          }}
        >
          <Heading
            style={{
              ...fontSans,
              margin: 0,
              fontSize: typography.fontSize.lg,
              fontWeight: typography.fontWeight.medium,
              color: color.text.primary,
            }}
          >
            {title}
          </Heading>
          {meta ? (
            <span
              style={{
                ...fontSans,
                fontSize: typography.fontSize.xs,
                color: color.text.muted,
              }}
            >
              {meta}
            </span>
          ) : null}
        </div>
        {actions ? (
          <div style={{ display: "flex", gap: spacing[2], flexShrink: 0 }}>{actions}</div>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/* -------------------------------- EmptyState ------------------------------- */

export interface EmptyStateProps {
  title: string;
  /** What source data or setup is missing, and what to do about it (§8.4). */
  children: ReactNode;
  /** Optional call to action (e.g. a `Button`). */
  action?: ReactNode;
}

/**
 * Centred, calm block that explains a missing source or setup step (§8.4,
 * brief §16/§21): a quiet solid border and tonal surface instead of a heavy
 * dashed frame, with a small neutral mark above the title.
 */
export function EmptyState({ title, children, action }: EmptyStateProps) {
  return (
    <div
      style={{
        ...fontSans,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        gap: spacing[2],
        padding: `${spacing[12]}px ${spacing[6]}px`,
        backgroundColor: color.background.surface,
        border: `1px solid ${color.border.subtle}`,
        borderRadius: radius["2xl"],
        color: color.text.muted,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 28,
          height: 2,
          borderRadius: radius.pill,
          backgroundColor: color.border.strong,
          marginBottom: spacing[2],
        }}
      />
      <span
        style={{
          ...fontSans,
          fontSize: typography.fontSize.lg,
          fontWeight: typography.fontWeight.medium,
          color: color.text.secondary,
        }}
      >
        {title}
      </span>
      <p
        style={{
          margin: 0,
          maxWidth: "48ch",
          fontSize: typography.fontSize.md,
          lineHeight: typography.lineHeight.normal,
        }}
      >
        {children}
      </p>
      {action ? <div style={{ marginTop: spacing[2] }}>{action}</div> : null}
    </div>
  );
}

/* -------------------------------- Sparkline -------------------------------- */

const sparkTones = {
  navy: color.dataViz.categorical[0],
  berry: color.dataViz.categorical[3],
  green: color.dataViz.categorical[2],
  gold: color.dataViz.categorical[7],
  teal: color.dataViz.categorical[1],
  plum: color.dataViz.categorical[5],
  slate: color.dataViz.categorical[6],
  orange: color.dataViz.categorical[4],
} as const;

export type SparklineTone = keyof typeof sparkTones;

/** Comparison series (brief §10): ≥3:1 on the surfaces (WCAG 1.4.11)
 * because it carries real information; clearly secondary to the accent. */
const comparisonStroke = color.dataViz.comparison;

export interface SparklineProps {
  /** Series values in render order; fewer than two renders a flat line. */
  points: readonly number[];
  width?: number;
  height?: number;
  /** Categorical chart colour (§8.7 data-viz tokens); default navy. */
  tone?: SparklineTone | undefined;
  /** Required accessible name, rendered as `role="img"` + `aria-label` (§7.8). */
  ariaLabel: string;
  /** Optional pale neutral comparison series drawn behind the accent series. */
  comparisonPoints?: readonly number[] | undefined;
  /** Optional visually-hidden longer description for screen readers. */
  summary?: string | undefined;
}

/**
 * Dependency-free inline SVG sparkline (brief §9/§10): a thin accent stroke
 * with rounded ends, a very subtle baseline, an optional pale comparison
 * series and a small highlight on the last value. Charts answer a named
 * management question (§8.4) — put that question in `ariaLabel`.
 */
export function Sparkline({
  points,
  width = 160,
  height = 40,
  tone = "navy",
  ariaLabel,
  comparisonPoints,
  summary,
}: SparklineProps) {
  const pad = 3;
  const source = points.length >= 2 ? points : [points[0] ?? 0, points[0] ?? 0];
  const comparison =
    comparisonPoints && comparisonPoints.length >= 2 ? comparisonPoints : undefined;
  const all = comparison ? [...source, ...comparison] : source;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const range = max - min;
  const stepX = (width - pad * 2) / (source.length - 1);
  const xy = source.map((point, index) => {
    const x = pad + stepX * index;
    const ratio = range === 0 ? 0.5 : (point - min) / range;
    const y = pad + (height - pad * 2) * (1 - ratio);
    return { x, y };
  });
  const last = xy[xy.length - 1] ?? { x: width - pad, y: height / 2 };
  const line = xy.map((c) => `${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(" ");
  const stroke = sparkTones[tone];

  const comparisonLine = comparison
    ? comparison
        .map((point, index) => {
          const x = pad + ((width - pad * 2) / (comparison.length - 1)) * index;
          const ratio = range === 0 ? 0.5 : (point - min) / range;
          const y = pad + (height - pad * 2) * (1 - ratio);
          return `${x.toFixed(2)},${y.toFixed(2)}`;
        })
        .join(" ")
    : null;

  const svg = (
    <svg
      role="img"
      aria-label={ariaLabel}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: "block" }}
    >
      {/* Very subtle baseline (brief §10). */}
      <line
        x1={pad}
        x2={width - pad}
        y1={height - pad}
        y2={height - pad}
        stroke={color.border.subtle}
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
      <polyline
        points={line}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Small highlight for the last/active value. */}
      <circle cx={last.x} cy={last.y} r={2.5} fill={stroke} />
    </svg>
  );

  return summary ? (
    <span style={{ display: "inline-block" }}>
      {svg}
      <span
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          margin: -1,
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
          whiteSpace: "nowrap",
        }}
      >
        {summary}
      </span>
    </span>
  ) : (
    svg
  );
}

/* ---------------------------- WatercolorBackdrop --------------------------- */

/**
 * Very restrained CSS-only watercolor washes (brief §23: avoid gradients
 * everywhere; §8.7 allows watercolor on sign-in/empty states only) — two
 * low-opacity tonal zones over the canvas. `aria-hidden` decoration;
 * position a `relative` ancestor.
 */
export function WatercolorBackdrop() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
        backgroundColor: color.background.page,
        backgroundImage: [
          `radial-gradient(circle at 12% 18%, ${color.accent.soft}59, transparent 55%)`,
          `radial-gradient(circle at 88% 82%, ${color.accent.secondary}2e, transparent 50%)`,
        ].join(", "),
      }}
    />
  );
}
