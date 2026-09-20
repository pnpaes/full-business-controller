/**
 * Composite patterns for the Aquarela Business Controller screens
 * (08_UI_UX.md §8.5 forms and tables, §8.6 mobile operational behavior, §8.7
 * visual direction; 07_SECURITY_AND_NFR.md §7.8).
 *
 * Every primitive here is a pure, hook-free function with token-driven inline
 * styles, exactly like `components.tsx`, so it renders identically under SSR
 * and can be used from server components. The one pattern that needs client
 * behaviour (`Modal`) lives in its own `"use client"` module, `modal.tsx`.
 */
import { Fragment } from "react";
import type {
  CSSProperties,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

import { MIN_TOUCH_TARGET_PX, Table, Td, Th, cx } from "./components";
import { color, radius, spacing, typography } from "./tokens";

const fontSans = { fontFamily: typography.fontFamily.sans } as const;
const fontDisplay = { fontFamily: typography.fontFamily.display } as const;

const controlStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  border: "none",
  background: "transparent",
  padding: `${spacing[2]}px ${spacing[3]}px`,
  font: "inherit",
  fontSize: typography.fontSize.md,
  color: color.text.primary,
  outline: "none",
};

/** Bordered input frame; the border turns danger when a `TextField`-style error is set. */
function controlFrame(error: string | undefined): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    backgroundColor: color.background.surface,
    border: `1px solid ${error ? color.status.danger.fg : color.border.default}`,
    borderRadius: radius.sm,
    minHeight: MIN_TOUCH_TARGET_PX,
  };
}

/** The unit/adornment chip that pairs a numeric quantity with its unit (§8.5). */
const unitStyle: CSSProperties = {
  padding: `0 ${spacing[3]}px`,
  fontSize: typography.fontSize.sm,
  color: color.text.muted,
  borderLeft: `1px solid ${color.border.subtle}`,
  alignSelf: "stretch",
  display: "flex",
  alignItems: "center",
};

interface FieldLabelProps {
  htmlFor: string;
  label: string;
  required?: boolean | undefined;
}

/** Shared label with the required cue, matching `TextField`. */
function FieldLabel({ htmlFor, label, required }: FieldLabelProps) {
  return (
    <label
      htmlFor={htmlFor}
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
  );
}

interface FieldMessageProps {
  helpId?: string | undefined;
  errorId?: string | undefined;
  help?: string | undefined;
  error?: string | undefined;
}

/** Error (priority) or help text, wired to the control via `aria-describedby` (§8.5). */
function FieldMessage({ helpId, errorId, help, error }: FieldMessageProps) {
  if (error) {
    return (
      <p
        id={errorId}
        style={{ margin: 0, fontSize: typography.fontSize.sm, color: color.status.danger.fg }}
      >
        {error}
      </p>
    );
  }
  if (help) {
    return (
      <p
        id={helpId}
        style={{ margin: 0, fontSize: typography.fontSize.sm, color: color.text.muted }}
      >
        {help}
      </p>
    );
  }
  return null;
}

/** Stable ids and `aria-describedby` wiring shared by every framed field. */
function fieldWiring(
  name: string,
  id: string | undefined,
  help: string | undefined,
  error: string | undefined,
) {
  const inputId = id ?? `field-${name}`;
  const helpId = help ? `${inputId}-help` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  // Only reference ids actually rendered: when an error is shown the help
  // paragraph is not, so its id must not appear in aria-describedby.
  const describedBy = error ? errorId : helpId;
  return { inputId, helpId, errorId, describedBy };
}

/* ------------------------------- SelectField ------------------------------- */

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> {
  name: string;
  label: string;
  id?: string;
  options: readonly SelectOption[];
  value?: string;
  defaultValue?: string;
  required?: boolean;
  disabled?: boolean;
  /** Help text shown under the label. */
  help?: string;
  /** Validation error; sets aria-invalid and links the message via aria-describedby. */
  error?: string;
  /** Empty first option (e.g. "Select a storage location"). */
  placeholder?: string;
}

/** Accessible select with the same label/help/error wiring as `TextField` (§8.5). */
export function SelectField({
  name,
  label,
  id,
  options,
  value,
  defaultValue,
  required = false,
  disabled = false,
  help,
  error,
  placeholder,
  className,
  style,
  ...rest
}: SelectFieldProps) {
  const { inputId, helpId, errorId, describedBy } = fieldWiring(name, id, help, error);
  return (
    <div
      className={cx("aquarela-field", className)}
      style={{ display: "flex", flexDirection: "column", gap: spacing[1], ...fontSans, ...style }}
    >
      <FieldLabel htmlFor={inputId} label={label} required={required} />
      <div style={controlFrame(error)}>
        <select
          {...rest}
          id={inputId}
          name={name}
          value={value}
          defaultValue={defaultValue}
          required={required}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          style={{ ...controlStyle, cursor: disabled ? "not-allowed" : "pointer" }}
        >
          {placeholder ? (
            <option value="" disabled={required}>
              {placeholder}
            </option>
          ) : null}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <FieldMessage helpId={helpId} errorId={errorId} help={help} error={error} />
    </div>
  );
}

/* ------------------------------- NumberField ------------------------------- */

export interface NumberFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "id" | "size" | "type"
> {
  name: string;
  label: string;
  id?: string;
  /** Unit paired with the value, e.g. "kg" or "€" (§8.5: no unit ambiguity). */
  unit?: string;
  step?: number | string;
  min?: number | string;
  max?: number | string;
  value?: string | number;
  defaultValue?: string | number;
  required?: boolean;
  disabled?: boolean;
  help?: string;
  error?: string;
  inputMode?: "numeric" | "decimal" | "text";
}

/**
 * Numeric input with a visible unit suffix and a decimal keyboard by default
 * (§8.5 unit pairing, §8.6 numeric keyboards on phone/tablet). The unit is
 * announced with the field: it is part of `aria-describedby`, not decoration.
 */
export function NumberField({
  name,
  label,
  id,
  unit,
  step,
  min,
  max,
  value,
  defaultValue,
  required = false,
  disabled = false,
  help,
  error,
  inputMode = "decimal",
  className,
  style,
  ...rest
}: NumberFieldProps) {
  const { inputId, helpId, errorId, describedBy } = fieldWiring(name, id, help, error);
  const unitId = unit ? `${inputId}-unit` : undefined;
  const describedByIds = [describedBy, unitId].filter(Boolean).join(" ") || undefined;
  return (
    <div
      className={cx("aquarela-field", className)}
      style={{ display: "flex", flexDirection: "column", gap: spacing[1], ...fontSans, ...style }}
    >
      <FieldLabel htmlFor={inputId} label={label} required={required} />
      <div style={controlFrame(error)}>
        <input
          {...rest}
          id={inputId}
          name={name}
          type="number"
          value={value}
          defaultValue={defaultValue}
          step={step}
          min={min}
          max={max}
          required={required}
          disabled={disabled}
          inputMode={inputMode}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedByIds}
          style={controlStyle}
        />
        {unit ? (
          <span id={unitId} style={unitStyle}>
            {unit}
          </span>
        ) : null}
      </div>
      <FieldMessage helpId={helpId} errorId={errorId} help={help} error={error} />
    </div>
  );
}

/* -------------------------------- DateField -------------------------------- */

export interface DateFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "id" | "size" | "type"
> {
  name: string;
  label: string;
  id?: string;
  value?: string;
  defaultValue?: string;
  required?: boolean;
  help?: string;
  error?: string;
}

/** Native `type="date"` field with the shared label/help/error wiring (§8.5). */
export function DateField({
  name,
  label,
  id,
  value,
  defaultValue,
  required = false,
  help,
  error,
  className,
  style,
  ...rest
}: DateFieldProps) {
  const { inputId, helpId, errorId, describedBy } = fieldWiring(name, id, help, error);
  return (
    <div
      className={cx("aquarela-field", className)}
      style={{ display: "flex", flexDirection: "column", gap: spacing[1], ...fontSans, ...style }}
    >
      <FieldLabel htmlFor={inputId} label={label} required={required} />
      <div style={controlFrame(error)}>
        <input
          {...rest}
          id={inputId}
          name={name}
          type="date"
          value={value}
          defaultValue={defaultValue}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          style={controlStyle}
        />
      </div>
      <FieldMessage helpId={helpId} errorId={errorId} help={help} error={error} />
    </div>
  );
}

/* ------------------------------ TextareaField ------------------------------ */

export interface TextareaFieldProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "id"
> {
  name: string;
  label: string;
  id?: string;
  rows?: number;
  value?: string;
  defaultValue?: string;
  required?: boolean;
  help?: string;
  error?: string;
}

/** Multi-line notes field (waste notes, reconciliation exceptions) (§8.5). */
export function TextareaField({
  name,
  label,
  id,
  rows = 3,
  value,
  defaultValue,
  required = false,
  help,
  error,
  className,
  style,
  ...rest
}: TextareaFieldProps) {
  const { inputId, helpId, errorId, describedBy } = fieldWiring(name, id, help, error);
  return (
    <div
      className={cx("aquarela-field", className)}
      style={{ display: "flex", flexDirection: "column", gap: spacing[1], ...fontSans, ...style }}
    >
      <FieldLabel htmlFor={inputId} label={label} required={required} />
      <div style={{ ...controlFrame(error), alignItems: "stretch" }}>
        <textarea
          {...rest}
          id={inputId}
          name={name}
          rows={rows}
          value={value}
          defaultValue={defaultValue}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          style={{
            ...controlStyle,
            minHeight: 80,
            resize: "vertical",
            lineHeight: typography.lineHeight.normal,
          }}
        />
      </div>
      <FieldMessage helpId={helpId} errorId={errorId} help={help} error={error} />
    </div>
  );
}

/* ------------------------------ CheckboxField ------------------------------ */

export interface CheckboxFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "id" | "type"
> {
  name: string;
  label: string;
  id?: string;
  defaultChecked?: boolean;
  help?: string;
}

/** Single boolean toggle; the whole label row is a ≥44px touch target (§8.6). */
export function CheckboxField({
  name,
  label,
  id,
  defaultChecked,
  help,
  className,
  style,
  ...rest
}: CheckboxFieldProps) {
  const inputId = id ?? `field-${name}`;
  const helpId = help ? `${inputId}-help` : undefined;
  return (
    <div
      className={cx(className)}
      style={{ display: "flex", flexDirection: "column", gap: spacing[1], ...fontSans, ...style }}
    >
      <label
        htmlFor={inputId}
        style={{
          display: "flex",
          alignItems: "center",
          gap: spacing[2],
          minHeight: MIN_TOUCH_TARGET_PX,
          cursor: "pointer",
        }}
      >
        <input
          {...rest}
          id={inputId}
          name={name}
          type="checkbox"
          defaultChecked={defaultChecked}
          aria-describedby={helpId}
          style={{ width: 20, height: 20, accentColor: color.brand.navy, flexShrink: 0 }}
        />
        <span style={{ fontSize: typography.fontSize.md, color: color.text.primary }}>{label}</span>
      </label>
      {help ? (
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

/* -------------------------------- DataTable -------------------------------- */

export type DataTableRow = Record<string, ReactNode>;

export interface DataTableColumn {
  key: string;
  header: ReactNode;
  align?: "left" | "center" | "right";
  width?: string | number;
}

export interface DataTableProps {
  caption: string;
  columns: readonly DataTableColumn[];
  rows: readonly DataTableRow[];
  /** Shown instead of the body when there are no rows (§8.4: explain what is missing). */
  emptyMessage?: string;
  /** When provided, the first column of each row is wrapped in a link to this href. */
  rowHref?: (row: DataTableRow, index: number) => string;
}

/** Column alignment/width as a partial style; kept empty when unset. */
function columnStyle(column: DataTableColumn): CSSProperties {
  const style: CSSProperties = {};
  if (column.align) style.textAlign = column.align;
  if (column.width !== undefined) style.width = column.width;
  return style;
}

/**
 * Generic table over `Table`/`Th`/`Td` with an empty state and an optional
 * per-row link (§8.5 tables, §8.4 empty states). Rows are plain column-keyed
 * records so callers map domain records without inventing a view model.
 */
export function DataTable({ caption, columns, rows, emptyMessage, rowHref }: DataTableProps) {
  const isEmpty = rows.length === 0;
  // exactOptionalPropertyTypes: only forward emptyMessage when it is set.
  const emptyProps = isEmpty && emptyMessage !== undefined ? { emptyMessage } : {};
  return (
    <Table caption={caption} columnCount={columns.length} {...emptyProps}>
      <thead>
        <tr>
          {columns.map((column) => (
            <Th key={column.key} style={columnStyle(column)}>
              {column.header}
            </Th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => {
          const href = rowHref?.(row, index);
          return (
            <tr key={index}>
              {columns.map((column, columnIndex) => (
                <Td key={column.key} style={columnStyle(column)}>
                  {href && columnIndex === 0 ? (
                    <a href={href} style={{ color: color.brand.berry }}>
                      {row[column.key]}
                    </a>
                  ) : (
                    row[column.key]
                  )}
                </Td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

/* -------------------------------- FilterBar -------------------------------- */

export interface FilterBarProps {
  children: ReactNode;
}

/** Compact toolbar row for filters/search on the cream canvas (§8.5 saved filters). */
export function FilterBar({ children }: FilterBarProps) {
  return (
    <div
      style={{
        ...fontSans,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "flex-end",
        gap: spacing[3],
        padding: `${spacing[3]}px ${spacing[4]}px`,
        backgroundColor: color.background.surfaceAlt,
        border: `1px solid ${color.border.subtle}`,
        borderRadius: radius.md,
      }}
    >
      {children}
    </div>
  );
}

/* ------------------------------- Breadcrumbs ------------------------------- */

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface BreadcrumbsProps {
  items: readonly BreadcrumbItem[];
}

/** Small muted trail; the last item is the current page (`aria-current`) (§8.1). */
export function Breadcrumbs({ items }: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb" style={{ ...fontSans, fontSize: typography.fontSize.sm }}>
      <ol
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: spacing[2],
          margin: 0,
          padding: 0,
          listStyle: "none",
          color: color.text.muted,
        }}
      >
        {items.map((item, index) => {
          const current = index === items.length - 1;
          return (
            <Fragment key={index}>
              {index > 0 ? (
                <li aria-hidden="true" style={{ color: color.border.strong }}>
                  /
                </li>
              ) : null}
              <li>
                {item.href && !current ? (
                  <a
                    href={item.href}
                    style={{ color: color.text.secondary, textDecoration: "none" }}
                  >
                    {item.label}
                  </a>
                ) : (
                  <span
                    aria-current={current ? "page" : undefined}
                    style={{ color: color.text.muted }}
                  >
                    {item.label}
                  </span>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

/* ----------------------------- DescriptionList ----------------------------- */

export interface DescriptionListItem {
  term: string;
  description: ReactNode;
}

export interface DescriptionListProps {
  items: readonly DescriptionListItem[];
}

/** Two-column definition list for detail pages: muted term, value beside it (§8.3). */
export function DescriptionList({ items }: DescriptionListProps) {
  return (
    <dl
      style={{
        ...fontSans,
        display: "grid",
        gridTemplateColumns: "minmax(8rem, max-content) 1fr",
        rowGap: spacing[2],
        columnGap: spacing[4],
        margin: 0,
      }}
    >
      {items.map((item, index) => (
        <Fragment key={index}>
          <dt
            style={{
              fontSize: typography.fontSize.sm,
              color: color.text.muted,
              fontWeight: typography.fontWeight.medium,
            }}
          >
            {item.term}
          </dt>
          <dd style={{ margin: 0, fontSize: typography.fontSize.md, color: color.text.primary }}>
            {item.description}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

/* ------------------------- FormSection / FormActions ----------------------- */

export interface FormSectionProps {
  title: string;
  description?: string;
  children: ReactNode;
}

/** Titled group of related fields (§8.5: effective-date conflicts visible before submit). */
export function FormSection({ title, description, children }: FormSectionProps) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: spacing[3], ...fontSans }}>
      <div style={{ display: "flex", flexDirection: "column", gap: spacing[1] }}>
        <h2
          style={{
            ...fontDisplay,
            margin: 0,
            fontSize: typography.fontSize.xl,
            fontWeight: typography.fontWeight.semibold,
            color: color.text.primary,
          }}
        >
          {title}
        </h2>
        {description ? (
          <p style={{ margin: 0, fontSize: typography.fontSize.sm, color: color.text.secondary }}>
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export interface FormActionsProps {
  children: ReactNode;
}

/** Explicit submit row: draft autosave is allowed, submit/post is deliberate (§8.5). */
export function FormActions({ children }: FormActionsProps) {
  return (
    <div
      style={{
        ...fontSans,
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "flex-end",
        gap: spacing[3],
        paddingTop: spacing[4],
        borderTop: `1px solid ${color.border.subtle}`,
      }}
    >
      {children}
    </div>
  );
}

/* ---------------------------------- Tabs ----------------------------------- */

export interface TabItem {
  label: string;
  href: string;
  active?: boolean;
}

export interface TabsProps {
  items: readonly TabItem[];
  ariaLabel: string;
}

/** Link-based area-section tabs: no client state, the router owns the hrefs (§8.1). */
export function Tabs({ items, ariaLabel }: TabsProps) {
  return (
    <nav aria-label={ariaLabel}>
      <ul
        style={{
          ...fontSans,
          display: "flex",
          flexWrap: "wrap",
          gap: spacing[1],
          margin: 0,
          padding: 0,
          listStyle: "none",
          borderBottom: `1px solid ${color.border.subtle}`,
        }}
      >
        {items.map((item) => (
          <li key={item.href}>
            <a
              href={item.href}
              aria-current={item.active ? "page" : undefined}
              style={{
                display: "inline-flex",
                alignItems: "center",
                minHeight: MIN_TOUCH_TARGET_PX,
                padding: `0 ${spacing[4]}px`,
                color: item.active ? color.brand.navy : color.text.secondary,
                borderBottom: `2px solid ${item.active ? color.brand.berry : "transparent"}`,
                fontWeight: item.active
                  ? typography.fontWeight.semibold
                  : typography.fontWeight.regular,
                fontSize: typography.fontSize.md,
                textDecoration: "none",
              }}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/* ------------------------------- ProgressBar ------------------------------- */

export type ProgressTone = "info" | "success" | "warning" | "danger";

export interface ProgressBarProps {
  value: number;
  /** Upper bound; values at or below zero fall back to 100. Default 100. */
  max?: number;
  /** Status token for the fill; default info. */
  tone?: ProgressTone;
  /** Accessible name for the bar, also shown as a visible caption. */
  label?: string;
}

const progressTones: Record<ProgressTone, string> = {
  info: color.status.info.fg,
  success: color.status.success.fg,
  warning: color.status.warning.fg,
  danger: color.status.danger.fg,
};

/** Token-coloured progress bar; `value` is clamped into `[0, max]` (§7.8, §8.7). */
export function ProgressBar({ value, max = 100, tone = "info", label }: ProgressBarProps) {
  const safeMax = max > 0 ? max : 100;
  const finite = Number.isFinite(value) ? value : 0;
  const clamped = Math.min(Math.max(finite, 0), safeMax);
  const percent = (clamped / safeMax) * 100;
  return (
    <div style={{ ...fontSans, display: "flex", flexDirection: "column", gap: spacing[1] }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: spacing[2] }}>
        {label ? (
          <span style={{ fontSize: typography.fontSize.sm, color: color.text.secondary }}>
            {label}
          </span>
        ) : (
          <span />
        )}
        <span
          aria-hidden="true"
          style={{ fontSize: typography.fontSize.sm, color: color.text.muted }}
        >
          {`${Math.round(percent)}%`}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-label={label}
        style={{
          width: "100%",
          height: 8,
          backgroundColor: color.background.inset,
          borderRadius: radius.pill,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${percent}%`,
            height: "100%",
            backgroundColor: progressTones[tone],
            borderRadius: radius.pill,
          }}
        />
      </div>
    </div>
  );
}
