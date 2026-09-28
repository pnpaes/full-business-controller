"use client";

/**
 * `InfoTip` — the standard (i) affordance for explainability
 * (`docs/ux/README.md`, "Explainability policy ((i) InfoTips)").
 *
 * It wraps the CSS-only `Tooltip` in a real, keyboard-focusable `<button>`
 * and wires the bubble to the trigger with `aria-describedby`, so the tip is
 * announced by screen readers as well as revealed on hover/focus.
 *
 * Use it when the reader must *know* something to use the screen safely: a
 * domain term, a calculated number (formula/basis/date/currency), a status
 * value, or an action's consequence. Do **not** use it for required
 * instructions (inline microcopy) or anything essential to complete the task —
 * tooltips are hover/focus only. Keep the content to one short line.
 *
 * Client component only because it needs a stable unique id (`useId`) for the
 * `aria-describedby` relationship; it holds no state and renders no effects.
 */
import { useId } from "react";
import type { CSSProperties } from "react";

import { Tooltip } from "./primitives";
import { color, radius, spacing, typography } from "./tokens";

export interface InfoTipProps {
  /** Short definition, formula or consequence. */
  content: string;
  /** Accessible name for the (i) trigger. Defaults to a generic label. */
  label?: string;
  style?: CSSProperties;
}

/** The (i) trigger: a 24px focusable button, visually quiet at rest. */
const triggerStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 20,
  height: 20,
  minWidth: 20,
  minHeight: 20,
  marginLeft: spacing[1],
  padding: 0,
  verticalAlign: "text-bottom",
  borderRadius: radius.pill,
  border: `1px solid ${color.border.strong}`,
  backgroundColor: "transparent",
  color: color.ink.tertiary,
  font: "inherit",
  fontFamily: typography.fontFamily.sans,
  fontSize: typography.fontSize["2xs"],
  fontWeight: typography.fontWeight.semibold,
  lineHeight: 1,
  cursor: "help",
};

export function InfoTip({ content, label = "More information", style }: InfoTipProps) {
  const bubbleId = useId();
  const tooltipProps = { content, id: bubbleId, ...(style === undefined ? {} : { style }) };
  return (
    <Tooltip {...tooltipProps}>
      <button type="button" aria-label={label} aria-describedby={bubbleId} style={triggerStyle}>
        <span aria-hidden="true">i</span>
      </button>
    </Tooltip>
  );
}
