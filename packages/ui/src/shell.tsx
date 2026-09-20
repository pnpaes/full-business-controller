/**
 * Application-shell primitives for the Aquarela Business Controller
 * (08_UI_UX.md §8.1 navigation and scope, §8.4 dashboard rules, §8.7 visual
 * direction).
 *
 * Server-component compatible: no hooks, no effects, no client state.
 * All styling is token-driven inline styles; the few rules inline styles
 * cannot express (hover, focus) are noted on the component that needs them.
 */
import type { ReactNode } from "react";

import { MIN_TOUCH_TARGET_PX } from "./components";
import { color, elevation, radius, spacing, typography } from "./tokens";

const fontSans = { fontFamily: typography.fontFamily.sans } as const;
const fontDisplay = { fontFamily: typography.fontFamily.display } as const;

/* ------------------------------- Navigation -------------------------------- */

export interface NavItemProps {
  /** Visible row label. */
  label: string;
  /** Optional leading glyph; callers pass inline SVG. Decorative (`aria-hidden`). */
  icon?: ReactNode;
  /** Marks the current area; sets `aria-current="page"` and the gold cue (§8.7). */
  active?: boolean;
  /** Destination. Rendered as a plain `<a>`; the app router owns real hrefs. */
  href?: string;
}

/**
 * One navigation row for the dark-navy sidebar (§8.1, §8.7): ≥44px tall for
 * kitchen/phone use, cream text, gold marker and label when active.
 *
 * `color.navigation.backgroundHover` cannot be expressed inline (server
 * component, no handlers), so a neutral darker navy backs the active row; the
 * hover wash is left to the shell stylesheet.
 */
export function NavItem({ label, icon, active = false, href }: NavItemProps) {
  return (
    <a
      href={href}
      aria-current={active ? "page" : undefined}
      style={{
        ...fontSans,
        display: "flex",
        alignItems: "center",
        gap: spacing[3],
        minHeight: MIN_TOUCH_TARGET_PX,
        padding: `${spacing[2]}px ${spacing[4]}px`,
        color: active ? color.navigation.active : color.navigation.text,
        backgroundColor: active ? color.navigation.backgroundHover : "transparent",
        borderLeft: `3px solid ${active ? color.navigation.active : "transparent"}`,
        textDecoration: "none",
        fontSize: typography.fontSize.md,
        fontWeight: active ? typography.fontWeight.semibold : typography.fontWeight.regular,
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

/** Vertical stack of `NavItem`s on the dark-navy navigation surface (§8.1). */
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
 * The persistent scope control from §8.1: company/location and date context on
 * the cream canvas. Display-only until the shell wires real controls, so the
 * values are explicitly marked as placeholders (§8.4: every figure shows its
 * period and scope).
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
        padding: `${spacing[2]}px ${spacing[4]}px`,
        backgroundColor: color.background.surfaceAlt,
        border: `1px solid ${color.border.subtle}`,
        borderRadius: radius.md,
        fontSize: typography.fontSize.sm,
        color: color.text.secondary,
      }}
    >
      <span>
        <strong style={{ color: color.text.primary, fontWeight: typography.fontWeight.semibold }}>
          {company}
        </strong>
        {` · ${location}`}
      </span>
      <span aria-hidden="true" style={{ color: color.border.strong }}>
        |
      </span>
      <span>{dateLabel}</span>
      <span
        style={{
          ...fontSans,
          fontSize: typography.fontSize.xs,
          color: color.text.muted,
          backgroundColor: color.background.inset,
          border: `1px solid ${color.border.subtle}`,
          borderRadius: radius.pill,
          padding: `0 ${spacing[2]}px`,
        }}
      >
        placeholder
      </span>
      <span style={{ color: color.text.muted, fontStyle: "italic" }}>
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
}

/** Sign → tone mapping for the delta chip (§8.7: green healthy, gold review). */
function deltaTone(delta: string) {
  if (delta.startsWith("+")) return color.status.success;
  if (delta.startsWith("-")) return color.status.danger;
  return color.status.warning;
}

/** A dashboard KPI tile: muted label, serif display value, delta chip, meta line (§8.3, §8.4). */
export function KpiCard({ label, value, delta, meta }: KpiCardProps) {
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
        borderRadius: radius.lg,
        boxShadow: elevation.sm,
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
            fontSize: typography.fontSize["3xl"],
            fontWeight: typography.fontWeight.semibold,
            lineHeight: typography.lineHeight.tight,
            color: color.text.primary,
          }}
        >
          {value}
        </span>
        {delta && tone ? (
          <span
            style={{
              fontSize: typography.fontSize.sm,
              fontWeight: typography.fontWeight.semibold,
              color: tone.fg,
              backgroundColor: tone.bg,
              border: `1px solid ${tone.border}`,
              borderRadius: radius.pill,
              padding: `0 ${spacing[2]}px`,
            }}
          >
            {delta}
          </span>
        ) : null}
      </div>
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
 * Titled panel using the same surface/border/radius tokens as `Card`/`Panel`
 * (§8.7): white surface, subtle border, large radius, serif title. Adds an
 * `actions` slot that `Panel` does not have.
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
        borderRadius: radius.lg,
        boxShadow: elevation.sm,
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
              ...fontDisplay,
              margin: 0,
              fontSize: typography.fontSize.xl,
              fontWeight: typography.fontWeight.semibold,
              color: color.text.primary,
            }}
          >
            {title}
          </Heading>
          {meta ? (
            <span
              style={{ ...fontSans, fontSize: typography.fontSize.sm, color: color.text.muted }}
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

/** Centred muted block that explains a missing source or setup step (§8.4, §8.7). */
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
        padding: `${spacing[8]}px ${spacing[5]}px`,
        backgroundColor: color.background.surfaceAlt,
        border: `1px dashed ${color.border.default}`,
        borderRadius: radius.lg,
        color: color.text.muted,
      }}
    >
      <span
        style={{
          ...fontDisplay,
          fontSize: typography.fontSize.lg,
          fontWeight: typography.fontWeight.semibold,
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
  berry: color.dataViz.categorical[1],
  green: color.dataViz.categorical[2],
  gold: color.dataViz.categorical[3],
  teal: color.dataViz.categorical[4],
  plum: color.dataViz.categorical[5],
  slate: color.dataViz.categorical[6],
  orange: color.dataViz.categorical[7],
} as const;

export type SparklineTone = keyof typeof sparkTones;

export interface SparklineProps {
  /** Series values in render order; fewer than two renders a flat line. */
  points: readonly number[];
  width?: number;
  height?: number;
  /** Categorical chart colour (§8.7 data-viz tokens); default navy. */
  tone?: SparklineTone;
  /** Required accessible name, rendered as `role="img"` + `aria-label` (§7.8). */
  ariaLabel: string;
}

/**
 * Dependency-free inline SVG sparkline: a polyline plus a soft area fill, drawn
 * from the `dataViz.categorical` tokens. Charts answer a named management
 * question (§8.4) — put that question in `ariaLabel`.
 */
export function Sparkline({
  points,
  width = 160,
  height = 40,
  tone = "navy",
  ariaLabel,
}: SparklineProps) {
  const pad = 2;
  const source = points.length >= 2 ? points : [points[0] ?? 0, points[0] ?? 0];
  const min = Math.min(...source);
  const max = Math.max(...source);
  const range = max - min;
  const stepX = (width - pad * 2) / (source.length - 1);
  const xy = source.map((point, index) => {
    const x = pad + stepX * index;
    const ratio = range === 0 ? 0.5 : (point - min) / range;
    const y = pad + (height - pad * 2) * (1 - ratio);
    return { x, y };
  });
  const first = xy[0] ?? { x: pad, y: height / 2 };
  const last = xy[xy.length - 1] ?? { x: width - pad, y: height / 2 };
  const line = xy.map((c) => `${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(" ");
  const baseline = height - pad;
  const areaPath = `M ${line} L ${last.x.toFixed(2)},${baseline} L ${first.x.toFixed(2)},${baseline} Z`;
  const stroke = sparkTones[tone];

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ display: "block" }}
    >
      <path d={areaPath} fill={stroke} opacity={0.12} stroke="none" />
      <polyline
        points={line}
        fill="none"
        stroke={stroke}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ---------------------------- WatercolorBackdrop --------------------------- */

/**
 * CSS-only watercolor blobs in berry/green/gold at low opacity over cream
 * (§8.7: watercolor accents limited to sign-in, empty states and occasional
 * section cues). `aria-hidden` decoration; position a `relative` ancestor.
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
          `radial-gradient(circle at 15% 20%, ${color.brand.berry}1f, transparent 60%)`,
          `radial-gradient(circle at 85% 15%, ${color.brand.green}1a, transparent 55%)`,
          `radial-gradient(circle at 70% 85%, ${color.brand.gold}24, transparent 60%)`,
        ].join(", "),
      }}
    />
  );
}
