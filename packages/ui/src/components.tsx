/**
 * Presentation primitives for the Aquarela Business Controller screens.
 *
 * Visual direction: `designer-agent-modern-saas-ui-brief.md` (modern editorial
 * SaaS), recorded as DEC-120 — supersedes 08_UI_UX.md §8.7 for visuals only.
 * Accessibility, business logic and the component APIs are unchanged
 * (08_UI_UX.md §8.3–§8.9, 07_SECURITY_AND_NFR.md §7.8 still govern behaviour).
 *
 * Server-component compatible: no hooks, no effects, no client state.
 * All styling is token-driven inline styles; see `uiGlobalCss` for the rules
 * inline styles cannot express (focus ring, hover, transitions, sticky
 * headers, skeleton shimmer, tooltip reveal).
 */
import type {
  ButtonHTMLAttributes,
  CSSProperties,
  InputHTMLAttributes,
  ReactNode,
  TableHTMLAttributes,
  ThHTMLAttributes,
  TdHTMLAttributes,
} from "react";

import {
  color,
  elevation,
  focus,
  geometry,
  iconSize,
  motion,
  radius,
  spacing,
  typography,
} from "./tokens";

/** Join class names, skipping falsy values. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

type Tone = "info" | "success" | "warning" | "danger";

const fontSans = { fontFamily: typography.fontFamily.sans } as const;
const fontDisplay = { fontFamily: typography.fontFamily.display } as const;

const focusableReset: CSSProperties = {
  font: "inherit",
  ...fontSans,
};

/**
 * Global CSS the components rely on for what inline styles cannot express:
 * the visible focus ring (§7.8), hover/active states, transitions, sticky
 * table headers, the skeleton shimmer and the CSS-only tooltip reveal.
 * Drop into the app shell once: `<style>{uiGlobalCss}</style>`.
 */
export const uiGlobalCss = `
:where(a, button, input, select, textarea, [tabindex]):focus-visible {
  outline: ${focus.ringWidth}px solid ${focus.ringColor};
  outline-offset: ${focus.ringOffset}px;
}
.aquarela-field:focus-within {
  outline: ${focus.ringWidth}px solid ${focus.ringColor};
  outline-offset: ${focus.ringOffset}px;
}
/* Buttons: subtle press feedback and quiet hover (brief §12, §19). */
.aquarela-btn {
  transition: background-color ${motion.duration.fast}ms ${motion.easing},
    border-color ${motion.duration.fast}ms ${motion.easing},
    color ${motion.duration.fast}ms ${motion.easing},
    transform ${motion.duration.fast}ms ${motion.easing};
}
.aquarela-btn:active:not(:disabled) {
  transform: translateY(1px);
}
/* Button hover states must beat the inline backgroundColor/border set by
 * Button — a stylesheet rule loses to inline styles without !important. */
.aquarela-btn-primary:hover:not(:disabled) {
  background-color: ${color.brand.navyDeep} !important; /* inline styles win otherwise */
  border-color: ${color.brand.navyDeep} !important; /* inline styles win otherwise */
}
.aquarela-btn-secondary:hover:not(:disabled) {
  background-color: ${color.surface.muted} !important; /* inline styles win otherwise */
}
.aquarela-btn-danger:hover:not(:disabled) {
  background-color: ${color.status.danger.border} !important; /* inline styles win otherwise */
}
.aquarela-btn-ghost:hover:not(:disabled) {
  background-color: ${color.surface.muted} !important; /* inline styles win otherwise */
}
.aquarela-btn-brand-soft:hover:not(:disabled) {
  /* brand/15 over the lavender soft surface (recipe hover:bg-brand/15). */
  background-color: #d7d2f3 !important; /* inline styles win otherwise */
}
/* Coarse pointers keep the 44px touch target on controls whose resting
 * height is the 40px control height (DEC-129 keeps both). */
@media (pointer: coarse) {
  .aquarela-btn {
    min-height: ${geometry.touchTarget}px !important; /* inline styles win otherwise */
  }
  .aquarela-field {
    min-height: ${geometry.touchTarget}px !important; /* inline styles win otherwise */
  }
}
/* Table: tonal row hover and sticky-header hook (brief §11). */
.aquarela-table tbody tr:hover td {
  background-color: ${color.surface.muted};
}
.aquarela-table-sticky thead th {
  position: sticky;
  top: 0;
  z-index: 1;
}
/* Skeleton shimmer (brief §19); disabled by the global reduced-motion rule. */
@keyframes aquarela-shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.aquarela-skeleton {
  background: linear-gradient(
    90deg,
    ${color.surface.muted} 25%,
    ${color.surface.well} 50%,
    ${color.surface.muted} 75%
  );
  background-size: 200% 100%;
  animation: aquarela-shimmer 1.6s ${motion.easing} infinite;
}
/* Segmented control: selected segment driven by the real radio input. */
.aquarela-seg label {
  cursor: pointer;
  transition: background-color ${motion.duration.fast}ms ${motion.easing},
    color ${motion.duration.fast}ms ${motion.easing};
}
.aquarela-seg input {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
  padding: 0;
}
.aquarela-seg input:checked + span {
  background-color: ${color.accent.soft};
  color: ${color.ink.primary};
  /* 2px inset ring: the tint alone is quiet by design, so the active state
   * also carries a perceivable non-colour affordance. */
  box-shadow: inset 0 0 0 2px ${color.accent.deep};
}
.aquarela-seg input:focus-visible + span {
  outline: ${focus.ringWidth}px solid ${focus.ringColor};
  outline-offset: ${focus.ringOffset}px;
}
/* Filter chip active state (brief §12: active filters use the accent). */
.aquarela-chip {
  transition: background-color ${motion.duration.fast}ms ${motion.easing},
    border-color ${motion.duration.fast}ms ${motion.easing},
    color ${motion.duration.fast}ms ${motion.easing};
}
/* Active/hover chip states fight the inline backgroundColor/border/color of
 * FilterChip, so they need !important (inline styles win otherwise). */
.aquarela-chip[aria-pressed="true"] {
  background-color: ${color.accent.soft} !important; /* inline styles win otherwise */
  border-color: ${color.accent.deep} !important; /* inline styles win otherwise */
  color: ${color.ink.primary} !important; /* inline styles win otherwise */
  box-shadow: inset 0 0 0 1px ${color.accent.deep};
}
.aquarela-chip:hover {
  border-color: ${color.border.strong} !important; /* inline styles win otherwise */
}
/* CSS-only tooltip: revealed on hover or keyboard focus of the trigger. */
.aquarela-tooltip {
  position: relative;
  display: inline-flex;
}
.aquarela-tooltip-bubble {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%) translateY(2px);
  z-index: 20;
  display: none;
  max-width: 240px;
  width: max-content;
  padding: ${spacing[1]}px ${spacing[2]}px;
  background-color: ${color.ink.primary};
  color: ${color.surface.canvas};
  border-radius: ${radius.sm}px;
  font-size: ${typography.fontSize.xs}px;
  line-height: ${typography.lineHeight.normal};
  text-align: center;
  pointer-events: none;
}
.aquarela-tooltip:hover .aquarela-tooltip-bubble,
.aquarela-tooltip:focus-within .aquarela-tooltip-bubble {
  display: block;
}
/* Navigation rows (brief §6; DEC-129 light sidebar): the row is transparent
 * with ink.tertiary text at rest, so hover is a quiet muted wash under
 * primary ink — the design system's sidebar hover, matching the shell. */
.aquarela-nav-item {
  transition: color ${motion.duration.fast}ms ${motion.easing},
    background-color ${motion.duration.fast}ms ${motion.easing};
}
/* NavItem sets its resting color/background-color inline, and inline styles
 * win over a normal stylesheet rule, so !important is still load-bearing here
 * (same reason as the shell's contextual nav hover). */
.aquarela-nav-item:hover:not([aria-current="page"]) {
  color: ${color.ink.primary} !important; /* inline styles win otherwise */
  background-color: ${color.surface.muted} !important; /* inline styles win otherwise */
}
/* Tabs (patterns.tsx): quiet hover wash on inactive tabs (brief §12). */
.aquarela-tabs a {
  transition: background-color ${motion.duration.fast}ms ${motion.easing},
    color ${motion.duration.fast}ms ${motion.easing},
    box-shadow ${motion.duration.fast}ms ${motion.easing};
}
/* Tab hover fights the inline backgroundColor/color of the tab anchors, so
 * !important is required (inline styles win otherwise). */
.aquarela-tabs a:hover:not([aria-current="page"]) {
  background-color: ${color.surface.muted} !important; /* inline styles win otherwise */
  color: ${color.ink.primary} !important; /* inline styles win otherwise */
}
/* Breadcrumb links (patterns.tsx): quiet hover darken. */
.aquarela-crumb a {
  transition: color ${motion.duration.fast}ms ${motion.easing};
}
/* Crumb hover fights the anchor's inline color, so !important is required
 * (inline styles win otherwise). */
.aquarela-crumb a:hover {
  color: ${color.ink.primary} !important; /* inline styles win otherwise */
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
`;

/** Minimum interactive size for kitchen/phone use (§8.6, §7.8). */
export const MIN_TOUCH_TARGET_PX = 44;
/** StatusPill indicator dot geometry (§7.8 non-color status cue). */
export const STATUS_DOT_SIZE_PX = 8;
export const STATUS_DOT_BORDER_PX = 1.5;

/* ---------------------------------- Button --------------------------------- */

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "brandSoft";
type ButtonSize = "sm" | "md" | "lg";

/**
 * Brief §12: primary = solid dark neutral; secondary = quiet tonal surface;
 * danger = muted tint; ghost = text only; brand-soft = lavender surface with
 * the text-safe iris (DEC-129 recipe `brand-soft`).
 */
const buttonVariants: Record<ButtonVariant, CSSProperties> = {
  primary: {
    backgroundColor: color.brand.navy,
    color: color.text.onNavy,
    border: `1px solid ${color.brand.navy}`,
  },
  secondary: {
    backgroundColor: color.surface.base,
    color: color.text.primary,
    border: `1px solid ${color.border.default}`,
  },
  danger: {
    backgroundColor: color.status.danger.bg,
    color: color.status.danger.fg,
    border: `1px solid ${color.status.danger.border}`,
  },
  ghost: {
    backgroundColor: "transparent",
    color: color.text.secondary,
    border: "1px solid transparent",
  },
  brandSoft: {
    backgroundColor: color.accent.soft,
    color: color.accent.deep,
    border: `1px solid ${color.accent.soft}`,
  },
};

const buttonVariantClasses: Record<ButtonVariant, string> = {
  primary: "aquarela-btn-primary",
  secondary: "aquarela-btn-secondary",
  danger: "aquarela-btn-danger",
  ghost: "aquarela-btn-ghost",
  brandSoft: "aquarela-btn-brand-soft",
};

/** Control heights from the design system recipes: 32 / 40 / 48 (DEC-129). */
const buttonSizes: Record<ButtonSize, CSSProperties> = {
  sm: {
    minHeight: geometry.controlHeight.sm,
    padding: `${spacing[1]}px ${spacing[3]}px`,
    fontSize: typography.fontSize.sm,
  },
  md: {
    minHeight: geometry.controlHeight.md,
    padding: `${spacing[2]}px ${spacing[4]}px`,
    fontSize: typography.fontSize.md,
  },
  lg: {
    minHeight: geometry.controlHeight.lg,
    padding: `${spacing[3]}px ${spacing[5]}px`,
    fontSize: typography.fontSize.lg,
  },
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  type = "button",
  disabled = false,
  loading = false,
  className,
  children,
  style,
  ...rest
}: ButtonProps) {
  const inactive = disabled || loading;
  return (
    <button
      {...rest}
      type={type}
      disabled={inactive}
      aria-busy={loading || undefined}
      className={cx("aquarela-btn", buttonVariantClasses[variant], className)}
      style={{
        ...focusableReset,
        ...buttonVariants[variant],
        ...buttonSizes[size],
        display: "inline-flex",
        alignItems: "center",
        gap: spacing[2],
        borderRadius: radius.md,
        fontWeight: typography.fontWeight.medium,
        cursor: inactive ? "not-allowed" : "pointer",
        opacity: inactive ? 0.45 : 1,
        ...style,
      }}
    >
      {loading ? (
        <span aria-hidden="true" style={{ fontWeight: typography.fontWeight.bold }}>
          …
        </span>
      ) : null}
      {children}
    </button>
  );
}

/* -------------------------------- TextField -------------------------------- */

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "size"> {
  name: string;
  label: string;
  id?: string;
  type?: string;
  value?: string | number;
  defaultValue?: string | number;
  required?: boolean;
  disabled?: boolean;
  /** Help text shown under the label. */
  help?: string;
  /** Validation error; sets aria-invalid and links the message via aria-describedby. */
  error?: string;
  /** Unit or currency adornment paired with the value (§8.5: no unit ambiguity). */
  suffix?: string;
  inputMode?: "numeric" | "decimal" | "text";
  placeholder?: string;
}

export function TextField({
  name,
  label,
  id,
  type = "text",
  value,
  defaultValue,
  required = false,
  disabled = false,
  help,
  error,
  suffix,
  inputMode,
  placeholder,
  className,
  style,
  ...rest
}: TextFieldProps) {
  const inputId = id ?? `field-${name}`;
  const helpId = help ? `${inputId}-help` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  // Only reference ids actually rendered: when an error is shown the help
  // paragraph is not, so its id must not appear in aria-describedby.
  const describedBy = error ? errorId : helpId;
  return (
    <div
      className={cx("aquarela-field", className)}
      style={{ display: "flex", flexDirection: "column", gap: spacing[1], ...fontSans, ...style }}
    >
      <label
        htmlFor={inputId}
        style={{
          fontSize: typography.fontSize.sm,
          fontWeight: typography.fontWeight.medium,
          color: color.text.secondary,
        }}
      >
        {label}
        {required ? (
          <span aria-hidden="true" style={{ color: color.status.danger.fg }}>
            {" "}
            *
          </span>
        ) : null}
      </label>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          backgroundColor: color.surface.base,
          border: `1px solid ${error ? color.status.danger.border : color.border.default}`,
          borderRadius: radius.md,
          minHeight: geometry.controlHeight.md,
          transition: `border-color ${motion.duration.fast}ms ${motion.easing}`,
        }}
      >
        <input
          {...rest}
          id={inputId}
          name={name}
          type={type}
          value={value}
          defaultValue={defaultValue}
          required={required}
          disabled={disabled}
          inputMode={inputMode}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          style={{
            flex: 1,
            minWidth: 0,
            border: "none",
            background: "transparent",
            padding: `${spacing[2]}px ${spacing[3]}px`,
            font: "inherit",
            fontSize: typography.fontSize.md,
            color: color.text.primary,
            outline: "none",
          }}
        />
        {suffix ? (
          <span
            aria-hidden="true"
            style={{
              padding: `0 ${spacing[3]}px`,
              fontSize: typography.fontSize.sm,
              color: color.text.muted,
              borderLeft: `1px solid ${color.border.subtle}`,
              alignSelf: "stretch",
              display: "flex",
              alignItems: "center",
            }}
          >
            {suffix}
          </span>
        ) : null}
      </div>
      {error ? (
        <p
          id={errorId}
          style={{ margin: 0, fontSize: typography.fontSize.sm, color: color.status.danger.fg }}
        >
          {error}
        </p>
      ) : help ? (
        <p
          id={helpId}
          style={{ margin: 0, fontSize: typography.fontSize.sm, color: color.text.muted }}
        >
          {help}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------- Card / Panel ------------------------------ */

export interface CardProps {
  /** Elevation level; `raised` cards float above the page canvas. */
  elevation?: "flat" | "raised" | "floating";
  children: ReactNode;
}

/** Brief §7: subtle neutral border, no heavy shadows, tonal surface. */
const cardElevations = {
  flat: { backgroundColor: color.surface.base, boxShadow: elevation.none },
  raised: { backgroundColor: color.surface.base, boxShadow: elevation.panel },
  floating: { backgroundColor: color.surface.strong, boxShadow: elevation.panel },
} as const;

export function Card({ elevation: level = "raised", children }: CardProps) {
  return (
    <section
      style={{
        ...cardElevations[level],
        borderRadius: radius.lg,
        border: `1px solid ${color.border.subtle}`,
        padding: spacing[5],
      }}
    >
      {children}
    </section>
  );
}

/** A titled card section: heading plus optional meta line and content. */
export interface PanelProps {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
  /** Heading element for the title; default 2. Lower it for nested panels so
   * the page does not accumulate duplicate h2s. */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
}

export function Panel({ title, meta, children, headingLevel = 2 }: PanelProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <Card>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: spacing[3],
          marginBottom: spacing[4],
        }}
      >
        <Heading
          style={{
            ...fontDisplay,
            margin: 0,
            fontSize: typography.fontSize.lg,
            fontWeight: typography.fontWeight.medium,
            color: color.ink.primary,
          }}
        >
          {title}
        </Heading>
        {meta ? (
          <span style={{ fontSize: typography.fontSize.sm, color: color.ink.secondary }}>
            {meta}
          </span>
        ) : null}
      </div>
      {children}
    </Card>
  );
}

/* ---------------------------------- Alert ---------------------------------- */

export interface AlertProps {
  tone: Tone;
  children: ReactNode;
  /** Optional bold lead-in, e.g. "Variance warning". */
  title?: string;
}

/** info/success are passive announcements (status); warning/danger interrupt (alert). */
const alertRoles: Record<Tone, "status" | "alert"> = {
  info: "status",
  success: "status",
  warning: "alert",
  danger: "alert",
};

/** Brief §13: muted tint, small indicator, 2–3px accent-tinted left edge. */
export function Alert({ tone, title, children }: AlertProps) {
  const tone_ = color.status[tone];
  return (
    <div
      role={alertRoles[tone]}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: spacing[2],
        padding: `${spacing[3]}px ${spacing[4]}px`,
        backgroundColor: tone_.bg,
        color: tone_.fg,
        border: `1px solid ${color.border.subtle}`,
        borderLeft: `3px solid ${tone_.border}`,
        borderRadius: radius.md,
        fontSize: typography.fontSize.md,
        lineHeight: typography.lineHeight.normal,
        ...fontSans,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          flexShrink: 0,
          width: STATUS_DOT_SIZE_PX,
          height: STATUS_DOT_SIZE_PX,
          marginTop:
            (typography.fontSize.md * typography.lineHeight.normal - STATUS_DOT_SIZE_PX) / 2,
          borderRadius: radius.pill,
          backgroundColor: tone === "warning" || tone === "danger" ? tone_.fg : "transparent",
          border: `${STATUS_DOT_BORDER_PX}px solid ${tone_.fg}`,
        }}
      />
      <div>
        {title ? (
          <strong style={{ fontWeight: typography.fontWeight.medium, display: "block" }}>
            {title}
          </strong>
        ) : null}
        {children}
      </div>
    </div>
  );
}

/* ----------------------------- Badge / StatusPill --------------------------- */

/** Semantic badge/pill tones (DEC-129 recipe): the four statuses plus
 * neutral and the lavender brand-soft surface. */
type BadgeTone = Tone | "neutral" | "brand";

const badgeTones: Record<BadgeTone, { bg: string; fg: string }> = {
  info: { bg: color.status.info.bg, fg: color.status.info.fg },
  success: { bg: color.status.success.bg, fg: color.status.success.fg },
  warning: { bg: color.status.warning.bg, fg: color.status.warning.fg },
  danger: { bg: color.status.danger.bg, fg: color.status.danger.fg },
  neutral: { bg: color.surface.muted, fg: color.ink.secondary },
  brand: { bg: color.accent.soft, fg: color.accent.deep },
};

export interface BadgeProps {
  children: ReactNode;
  /** Semantic tone; defaults to the quiet neutral pill. */
  tone?: BadgeTone;
}

export function Badge({ tone = "neutral", children }: BadgeProps) {
  const tone_ = badgeTones[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: spacing[1],
        padding: `${spacing[0]}px ${spacing[2]}px`,
        borderRadius: radius.pill,
        backgroundColor: tone_.bg,
        color: tone_.fg,
        border: `1px solid ${color.border.subtle}`,
        fontSize: typography.fontSize.xs,
        fontWeight: typography.fontWeight.medium,
        lineHeight: typography.lineHeight.tight,
        ...fontSans,
      }}
    >
      {children}
    </span>
  );
}

export interface StatusPillProps {
  tone: BadgeTone;
  children: ReactNode;
}

export function StatusPill({ tone, children }: StatusPillProps) {
  const tone_ = badgeTones[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: spacing[1],
        padding: `${spacing[0]}px ${spacing[2]}px`,
        borderRadius: radius.pill,
        backgroundColor: tone_.bg,
        color: tone_.fg,
        border: `1px solid ${color.border.subtle}`,
        fontSize: typography.fontSize.xs,
        fontWeight: typography.fontWeight.medium,
        lineHeight: typography.lineHeight.tight,
        ...fontSans,
      }}
    >
      {/* Non-color status cue (§7.8): filled dot for warning/danger, hollow otherwise. */}
      <span
        aria-hidden="true"
        style={{
          width: STATUS_DOT_SIZE_PX,
          height: STATUS_DOT_SIZE_PX,
          borderRadius: radius.pill,
          backgroundColor: tone === "warning" || tone === "danger" ? tone_.fg : "transparent",
          border: `${STATUS_DOT_BORDER_PX}px solid ${tone_.fg}`,
        }}
      />
      {children}
    </span>
  );
}

/* --------------------------------- Table ----------------------------------- */

export interface TableProps extends Omit<
  TableHTMLAttributes<HTMLTableElement>,
  "dangerouslySetInnerHTML"
> {
  caption: string;
  /** Number of columns, used to span the empty-state row. */
  columnCount: number;
  /** When set, renders the empty state instead of children (§8.4: explain what is missing). */
  emptyMessage?: string;
  /** Sticky header hook (brief §11); adds the `aquarela-table-sticky` class. */
  stickyHeader?: boolean;
  children?: ReactNode;
}

export function Table({
  caption,
  columnCount,
  emptyMessage,
  stickyHeader = false,
  children,
  className,
  ...rest
}: TableProps) {
  return (
    <table
      {...rest}
      className={cx("aquarela-table", stickyHeader && "aquarela-table-sticky", className)}
      style={{
        width: "100%",
        borderCollapse: "collapse",
        fontSize: typography.fontSize.md,
        color: color.ink.primary,
        ...fontSans,
        ...rest.style,
      }}
    >
      <caption
        style={{
          textAlign: "left",
          captionSide: "top",
          padding: `${spacing[2]}px 0`,
          fontSize: typography.fontSize.sm,
          color: color.ink.secondary,
        }}
      >
        {caption}
      </caption>
      {emptyMessage ? (
        <tbody>
          <tr>
            <td
              colSpan={columnCount}
              style={{
                padding: spacing[6],
                textAlign: "center",
                color: color.ink.secondary,
                backgroundColor: color.surface.muted,
              }}
            >
              {emptyMessage}
            </td>
          </tr>
        </tbody>
      ) : (
        children
      )}
    </table>
  );
}

export function Th({
  children,
  ...rest
}: { children: ReactNode } & Omit<
  ThHTMLAttributes<HTMLTableCellElement>,
  "dangerouslySetInnerHTML"
>) {
  return (
    <th
      scope="col"
      {...rest}
      style={{
        textAlign: "left",
        height: geometry.tableHeaderHeight,
        padding: `${spacing[2]}px ${spacing[4]}px`,
        backgroundColor: color.surface.well,
        color: color.ink.secondary,
        fontSize: typography.fontSize.xs,
        fontWeight: typography.fontWeight.medium,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        borderBottom: `1px solid ${color.border.default}`,
        ...rest.style,
      }}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  ...rest
}: { children: ReactNode } & Omit<
  TdHTMLAttributes<HTMLTableCellElement>,
  "dangerouslySetInnerHTML"
>) {
  return (
    <td
      {...rest}
      style={{
        height: geometry.tableRowHeight.default,
        padding: `${spacing[3]}px ${spacing[4]}px`,
        borderBottom: `1px solid ${color.border.subtle}`,
        color: color.ink.primary,
        fontVariantNumeric: typography.fontVariantNumeric.tabular,
        ...rest.style,
      }}
    >
      {children}
    </td>
  );
}

/* ------------------------------- PageHeader -------------------------------- */

export interface PageHeaderProps {
  title: string;
  /** Breadcrumb or scope line rendered above the title (small, muted). */
  scope?: ReactNode;
  /** Action buttons rendered on the right. */
  actions?: ReactNode;
  /** Optional supporting line under the title. */
  description?: string;
}

/** Brief §4: page title 28–36px, weight ~450–550, tight line-height. */
export function PageHeader({ title, scope, actions, description }: PageHeaderProps) {
  return (
    <header
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: spacing[4],
        marginBottom: spacing[6],
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: spacing[1] }}>
        {scope ? (
          <span
            style={{
              fontSize: typography.fontSize.sm,
              color: color.ink.tertiary,
              ...fontSans,
            }}
          >
            {scope}
          </span>
        ) : null}
        <h1
          style={{
            ...fontDisplay,
            margin: 0,
            fontSize: typography.fontSize["3xl"],
            fontWeight: typography.fontWeight.medium,
            color: color.ink.primary,
            lineHeight: typography.lineHeight.tight,
            letterSpacing: "-0.01em",
          }}
        >
          {title}
        </h1>
        {description ? (
          <p
            style={{
              margin: 0,
              fontSize: typography.fontSize.md,
              color: color.ink.secondary,
              ...fontSans,
            }}
          >
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "flex-end",
            gap: spacing[2],
            minWidth: 0,
            marginLeft: "auto",
          }}
        >
          {actions}
        </div>
      ) : null}
    </header>
  );
}

/* --------------------------- Shared icon plumbing -------------------------- */

/** Consistent thin line-icon wrapper (brief §20): 16–20px, stroke 1.5, currentColor. */
export interface IconProps {
  size?: (typeof iconSize)[keyof typeof iconSize];
  children: ReactNode;
  /** Decorative by default; pass a label for a meaningful icon. */
  label?: string;
  style?: CSSProperties;
}

export function Icon({ size = iconSize.sm, children, label, style }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      style={{ flexShrink: 0, ...style }}
    >
      {children}
    </svg>
  );
}

/** Magnifier glyph for Search (brief §12). */
export function SearchIcon(props: Omit<IconProps, "children">) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </Icon>
  );
}
