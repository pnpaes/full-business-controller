import { MIN_TOUCH_TARGET_PX, color, cx, radius, spacing, typography } from "@aquarela/ui";
import type { CSSProperties, ChangeEvent, SelectHTMLAttributes } from "react";

/**
 * Local form controls for the inventory screens. `@aquarela/ui` ships
 * `TextField` but no `Select`/`Checkbox`, and this slice must not edit the
 * frozen UI package, so the missing controls are hand-rolled here with the same
 * tokens and the same label/help/error wiring as `TextField` (§8.5, §8.6: ≥44px
 * targets, explicit labels, error text linked to the control).
 *
 * Plain components (no hooks): usable from both server and client components.
 */

const fontSans = { fontFamily: typography.fontFamily.sans } as const;
const labelStyle: CSSProperties = {
  fontSize: typography.fontSize.sm,
  fontWeight: typography.fontWeight.medium,
  color: color.text.secondary,
};
const helpStyle: CSSProperties = {
  margin: 0,
  fontSize: typography.fontSize.sm,
  color: color.text.muted,
};
const errorStyle: CSSProperties = {
  margin: 0,
  fontSize: typography.fontSize.sm,
  color: color.status.danger.fg,
};

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

export interface SelectFieldProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "id" | "size"
> {
  readonly name: string;
  readonly label: string;
  readonly id?: string;
  readonly options: readonly SelectOption[];
  readonly required?: boolean;
  readonly help?: string;
  readonly error?: string;
  /** Rendered as a disabled first option so an empty selection is explicit. */
  readonly placeholder?: string;
}

export function SelectField({
  name,
  label,
  id,
  options,
  required = false,
  help,
  error,
  placeholder,
  className,
  style,
  ...rest
}: SelectFieldProps) {
  const controlId = id ?? `field-${name}`;
  const helpId = help ? `${controlId}-help` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  return (
    <div
      className={cx("aquarela-field", className)}
      style={{ display: "flex", flexDirection: "column", gap: spacing[1], ...fontSans, ...style }}
    >
      <label htmlFor={controlId} style={labelStyle}>
        {label}
        {required ? (
          <span aria-hidden="true" style={{ color: color.status.danger.fg }}>
            {" "}
            *
          </span>
        ) : null}
      </label>
      <select
        {...rest}
        id={controlId}
        name={name}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : helpId}
        style={{
          minHeight: MIN_TOUCH_TARGET_PX,
          padding: `${spacing[2]}px ${spacing[3]}px`,
          font: "inherit",
          fontSize: typography.fontSize.md,
          color: color.text.primary,
          backgroundColor: color.background.surface,
          border: `1px solid ${error ? color.status.danger.fg : color.border.default}`,
          borderRadius: radius.sm,
        }}
      >
        {placeholder ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? (
        <p id={errorId} style={errorStyle}>
          {error}
        </p>
      ) : help ? (
        <p id={helpId} style={helpStyle}>
          {help}
        </p>
      ) : null}
    </div>
  );
}

export interface CheckboxFieldProps {
  readonly name: string;
  readonly label: string;
  readonly id?: string;
  readonly checked?: boolean;
  readonly defaultChecked?: boolean;
  readonly disabled?: boolean;
  readonly onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly help?: string;
}

export function CheckboxField({
  name,
  label,
  id,
  checked,
  defaultChecked,
  disabled = false,
  onChange,
  help,
}: CheckboxFieldProps) {
  const controlId = id ?? `field-${name}`;
  const helpId = help ? `${controlId}-help` : undefined;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[1], ...fontSans }}>
      <label
        htmlFor={controlId}
        style={{
          display: "flex",
          alignItems: "center",
          gap: spacing[2],
          minHeight: MIN_TOUCH_TARGET_PX,
        }}
      >
        <input
          id={controlId}
          name={name}
          type="checkbox"
          checked={checked}
          defaultChecked={defaultChecked}
          disabled={disabled}
          onChange={onChange}
          aria-describedby={helpId}
          style={{ width: 20, height: 20, accentColor: color.brand.navy }}
        />
        <span style={{ ...labelStyle, color: color.text.primary }}>{label}</span>
      </label>
      {help ? (
        <p id={helpId} style={{ ...helpStyle, marginLeft: 28 }}>
          {help}
        </p>
      ) : null}
    </div>
  );
}
