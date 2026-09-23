/**
 * Small dependency-free primitives added for the redesigned screens
 * (`designer-agent-modern-saas-ui-brief.md` §24; DEC-120).
 *
 * Server-component compatible like `components.tsx`: no hooks, no effects.
 * Interactive states (segmented selection, chip toggle, tooltip reveal) are
 * driven by native HTML semantics plus the rules in `uiGlobalCss`.
 */
import type { ButtonHTMLAttributes, CSSProperties, InputHTMLAttributes, ReactNode } from "react";

import { SearchIcon, cx } from "./components";
import { color, iconSize, radius, spacing, typography } from "./tokens";

const fontSans = { fontFamily: typography.fontFamily.sans } as const;

/* --------------------------------- Skeleton -------------------------------- */

export interface SkeletonProps {
  width?: number | string;
  height?: number;
  /** Rounded ends; defaults to a soft pill for bars. */
  radius?: number;
  style?: CSSProperties;
}

/** Soft shimmer loading block (brief §19). Decorative: `aria-hidden`. */
export function Skeleton({
  width = "100%",
  height = 12,
  radius: r = radius.pill,
  style,
}: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className="aquarela-skeleton"
      style={{ width, height, borderRadius: r, ...style }}
    />
  );
}

/* -------------------------------- IconButton ------------------------------- */

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Accessible name; applied as aria-label and title. Required. */
  label: string;
  children: ReactNode;
}

/** 44px icon-only button (§8.6 touch target); the label is mandatory. */
export function IconButton({
  label,
  type = "button",
  className,
  style,
  children,
  ...rest
}: IconButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      aria-label={label}
      title={label}
      className={cx("aquarela-btn aquarela-btn-ghost", className)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 44,
        minHeight: 44,
        padding: 0,
        borderRadius: radius.md,
        border: "1px solid transparent",
        background: "transparent",
        color: color.ink.secondary,
        cursor: "pointer",
        font: "inherit",
        ...fontSans,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

/* ---------------------------------- Search --------------------------------- */

export interface SearchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "type"> {
  name: string;
  /** Accessible label; visually hidden so the field stays quiet (§12). */
  label: string;
  id?: string;
  placeholder?: string;
  defaultValue?: string;
  value?: string;
  onChange?: InputHTMLAttributes<HTMLInputElement>["onChange"];
}

/** Quiet search field with a leading glyph (brief §12). A real input, never
 * a read-only placeholder stand-in. */
export function Search({ name, label, id, placeholder, className, style, ...rest }: SearchProps) {
  const inputId = id ?? `search-${name}`;
  return (
    <div
      className={cx("aquarela-field", className)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: spacing[2],
        minHeight: 44,
        padding: `0 ${spacing[3]}px`,
        backgroundColor: color.surface.well,
        border: `1px solid ${color.border.subtle}`,
        borderRadius: radius.md,
        color: color.ink.secondary,
        ...fontSans,
        ...style,
      }}
    >
      <label htmlFor={inputId} style={visuallyHidden}>
        {label}
      </label>
      <SearchIcon size={iconSize.sm} />
      <input
        {...rest}
        id={inputId}
        name={name}
        type="search"
        placeholder={placeholder}
        style={{
          flex: 1,
          minWidth: 0,
          border: "none",
          background: "transparent",
          padding: `${spacing[2]}px 0`,
          font: "inherit",
          fontSize: typography.fontSize.md,
          color: color.ink.primary,
          outline: "none",
        }}
      />
    </div>
  );
}

const visuallyHidden: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
  padding: 0,
};

/* ----------------------------- SegmentedControl ---------------------------- */

export interface SegmentedControlProps {
  /** Radiogroup name; also the base for input ids. */
  name: string;
  /** Accessible group label (rendered visually hidden). */
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange?: InputHTMLAttributes<HTMLInputElement>["onChange"];
  className?: string;
  style?: CSSProperties;
}

/** Accessible radiogroup styled as a segmented control (brief §12). Real
 * radio inputs carry the semantics; the checked segment gets the accent tint. */
export function SegmentedControl({
  name,
  label,
  options,
  value,
  onChange,
  className,
  style,
}: SegmentedControlProps) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx("aquarela-seg", className)}
      style={{
        display: "inline-flex",
        gap: 2,
        padding: 2,
        backgroundColor: color.surface.muted,
        borderRadius: radius.md,
        ...fontSans,
        ...style,
      }}
    >
      {options.map((option) => {
        const inputId = `${name}-${option.value}`;
        const checked = option.value === value;
        return (
          <label
            key={option.value}
            htmlFor={inputId}
            style={{
              position: "relative",
              display: "inline-flex",
              borderRadius: radius.sm,
            }}
          >
            <input
              type="radio"
              id={inputId}
              name={name}
              value={option.value}
              checked={checked}
              onChange={onChange}
              style={{ cursor: "pointer" }}
            />
            <span
              style={{
                padding: `${spacing[1]}px ${spacing[3]}px`,
                borderRadius: radius.sm,
                fontSize: typography.fontSize.sm,
                fontWeight: checked ? typography.fontWeight.medium : typography.fontWeight.regular,
                color: checked ? undefined : color.ink.secondary,
                whiteSpace: "nowrap",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              {option.label}
            </span>
          </label>
        );
      })}
    </div>
  );
}

/* -------------------------------- FilterChip ------------------------------- */

export interface FilterChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Toggle state; drives `aria-pressed` and the accent active style. */
  active?: boolean;
  children: ReactNode;
}

/** Toggleable filter chip (brief §12); active filters use the accent. */
export function FilterChip({
  active = false,
  type = "button",
  className,
  style,
  children,
  ...rest
}: FilterChipProps) {
  return (
    <button
      {...rest}
      type={type}
      aria-pressed={active}
      className={cx("aquarela-chip", className)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: spacing[1],
        minHeight: 32,
        padding: `${spacing[1]}px ${spacing[3]}px`,
        borderRadius: radius.pill,
        backgroundColor: color.surface.base,
        border: `1px solid ${color.border.default}`,
        color: color.ink.secondary,
        fontSize: typography.fontSize.sm,
        fontWeight: typography.fontWeight.medium,
        cursor: "pointer",
        font: "inherit",
        ...fontSans,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

/* --------------------------------- Tooltip --------------------------------- */

export interface TooltipProps {
  /** Tooltip text; revealed on hover and keyboard focus of the trigger. */
  content: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/** CSS-only tooltip (brief §24). The trigger must be focusable for keyboard
 * users; pair with a focusable child (Button, IconButton, link). */
export function Tooltip({ content, children, className, style }: TooltipProps) {
  return (
    <span className={cx("aquarela-tooltip", className)} style={style}>
      {children}
      <span role="tooltip" className="aquarela-tooltip-bubble">
        {content}
      </span>
    </span>
  );
}

/* ---------------------------------- Avatar --------------------------------- */

export interface AvatarProps {
  /** Full name; initials are derived from it. */
  name: string;
  size?: number;
  /** Optional tone for the tonal background. */
  tone?: "neutral" | "accent";
  style?: CSSProperties;
}

/** Initials-based avatar, no imagery (brief §24). */
export function Avatar({ name, size = 32, tone = "neutral", style }: AvatarProps) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: radius.pill,
        backgroundColor: tone === "accent" ? color.accent.soft : color.surface.muted,
        color: tone === "accent" ? color.accent.deep : color.ink.secondary,
        border: `1px solid ${color.border.subtle}`,
        fontSize: Math.round(size * 0.38),
        fontWeight: typography.fontWeight.medium,
        lineHeight: 1,
        flexShrink: 0,
        ...fontSans,
        ...style,
      }}
    >
      {initials}
    </span>
  );
}
