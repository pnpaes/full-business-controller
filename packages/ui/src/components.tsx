/**
 * Presentation primitives for the Aquarela Business Controller screens
 * (08_UI_UX.md §8.3–§8.9, 07_SECURITY_AND_NFR.md §7.8).
 *
 * Server-component compatible: no hooks, no effects, no client state.
 * All styling is token-driven inline styles; see `uiGlobalCss` for the few
 * rules (focus ring) that inline styles cannot express.
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

import { color, elevation, radius, spacing, typography } from "./tokens";

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
 * Global CSS the components rely on for the visible focus ring (§7.8).
 * Drop into the app shell once: `<style>{uiGlobalCss}</style>`.
 * Inline styles cannot express `:focus-within`, so the TextField wrapper
 * carries a stable class and this rule draws its focus ring.
 */
export const uiGlobalCss = `
:where(a, button, input, select, textarea, [tabindex]):focus-visible {
  outline: 2px solid ${color.border.focus};
  outline-offset: 2px;
}
.aquarela-field:focus-within {
  outline: 2px solid ${color.border.focus};
  outline-offset: 2px;
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

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

const buttonVariants: Record<ButtonVariant, CSSProperties> = {
  primary: {
    backgroundColor: color.brand.navy,
    color: color.text.onNavy,
    border: `1px solid ${color.brand.navy}`,
  },
  secondary: {
    backgroundColor: color.background.surface,
    color: color.text.primary,
    border: `1px solid ${color.border.strong}`,
  },
  danger: {
    backgroundColor: color.status.danger.fg,
    color: color.text.inverse,
    border: `1px solid ${color.status.danger.fg}`,
  },
  ghost: {
    backgroundColor: "transparent",
    color: color.text.primary,
    border: "1px solid transparent",
  },
};

/** md is 44px tall: touch targets suitable for kitchen/phone use (§8.6). */
const buttonSizes: Record<ButtonSize, CSSProperties> = {
  sm: {
    minHeight: 32,
    padding: `${spacing[1]}px ${spacing[3]}px`,
    fontSize: typography.fontSize.sm,
  },
  md: {
    minHeight: MIN_TOUCH_TARGET_PX,
    padding: `${spacing[2]}px ${spacing[4]}px`,
    fontSize: typography.fontSize.md,
  },
  lg: {
    minHeight: 48,
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
      style={{
        ...focusableReset,
        ...buttonVariants[variant],
        ...buttonSizes[size],
        display: "inline-flex",
        alignItems: "center",
        gap: spacing[2],
        borderRadius: radius.sm,
        fontWeight: typography.fontWeight.medium,
        cursor: inactive ? "not-allowed" : "pointer",
        opacity: inactive ? 0.6 : 1,
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
          backgroundColor: color.background.surface,
          border: `1px solid ${error ? color.status.danger.fg : color.border.default}`,
          borderRadius: radius.sm,
          minHeight: MIN_TOUCH_TARGET_PX,
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
  /** Elevation level; `raised` cards float above the page cream. */
  elevation?: "flat" | "raised" | "floating";
  children: ReactNode;
}

const cardElevations = {
  flat: { backgroundColor: color.background.surfaceAlt, boxShadow: elevation.none },
  raised: { backgroundColor: color.background.surface, boxShadow: elevation.sm },
  floating: { backgroundColor: color.background.surface, boxShadow: elevation.md },
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
            fontSize: typography.fontSize.xl,
            fontWeight: typography.fontWeight.semibold,
            color: color.text.primary,
          }}
        >
          {title}
        </Heading>
        {meta ? (
          <span style={{ fontSize: typography.fontSize.sm, color: color.text.muted }}>{meta}</span>
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

export function Alert({ tone, title, children }: AlertProps) {
  const tone_ = color.status[tone];
  return (
    <div
      role={alertRoles[tone]}
      style={{
        display: "flex",
        gap: spacing[3],
        padding: `${spacing[3]}px ${spacing[4]}px`,
        backgroundColor: tone_.bg,
        color: tone_.fg,
        border: `1px solid ${tone_.border}`,
        borderLeftWidth: 4,
        borderRadius: radius.sm,
        fontSize: typography.fontSize.md,
        ...fontSans,
      }}
    >
      {title ? (
        <strong style={{ fontWeight: typography.fontWeight.semibold }}>{title}</strong>
      ) : null}
      <div>{children}</div>
    </div>
  );
}

/* ----------------------------- Badge / StatusPill --------------------------- */

export interface BadgeProps {
  children: ReactNode;
}

export function Badge({ children }: BadgeProps) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: `${spacing[0]}px ${spacing[2]}px`,
        borderRadius: radius.pill,
        backgroundColor: color.background.inset,
        color: color.text.secondary,
        border: `1px solid ${color.border.subtle}`,
        fontSize: typography.fontSize.xs,
        fontWeight: typography.fontWeight.medium,
        ...fontSans,
      }}
    >
      {children}
    </span>
  );
}

export interface StatusPillProps {
  tone: Tone;
  children: ReactNode;
}

export function StatusPill({ tone, children }: StatusPillProps) {
  const tone_ = color.status[tone];
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
        border: `1px solid ${tone_.border}`,
        fontSize: typography.fontSize.xs,
        fontWeight: typography.fontWeight.semibold,
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
  children?: ReactNode;
}

export function Table({ caption, columnCount, emptyMessage, children, ...rest }: TableProps) {
  return (
    <table
      {...rest}
      style={{
        width: "100%",
        borderCollapse: "collapse",
        fontSize: typography.fontSize.md,
        color: color.text.primary,
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
          color: color.text.muted,
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
                color: color.text.muted,
                backgroundColor: color.background.surfaceAlt,
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
        padding: `${spacing[2]}px ${spacing[3]}px`,
        backgroundColor: color.background.inset,
        color: color.text.primary,
        fontSize: typography.fontSize.sm,
        fontWeight: typography.fontWeight.semibold,
        borderBottom: `2px solid ${color.border.strong}`,
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
        padding: `${spacing[2]}px ${spacing[3]}px`,
        borderBottom: `1px solid ${color.border.subtle}`,
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

export function PageHeader({ title, scope, actions, description }: PageHeaderProps) {
  return (
    <header
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: spacing[4],
        marginBottom: spacing[6],
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: spacing[1] }}>
        {scope ? (
          <span style={{ fontSize: typography.fontSize.sm, color: color.text.muted, ...fontSans }}>
            {scope}
          </span>
        ) : null}
        <h1
          style={{
            ...fontDisplay,
            margin: 0,
            fontSize: typography.fontSize["3xl"],
            fontWeight: typography.fontWeight.semibold,
            color: color.brand.navy,
            lineHeight: typography.lineHeight.tight,
          }}
        >
          {title}
        </h1>
        {description ? (
          <p
            style={{
              margin: 0,
              fontSize: typography.fontSize.md,
              color: color.text.secondary,
              ...fontSans,
            }}
          >
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div style={{ display: "flex", gap: spacing[2], flexShrink: 0 }}>{actions}</div>
      ) : null}
    </header>
  );
}
