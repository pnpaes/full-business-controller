"use client";

/**
 * `SuccessToast` — the single post-mutation success pattern
 * (`docs/ux/README.md`, "State coverage": "success feedback after a
 * mutation").
 *
 * **When to use it vs `Alert`:**
 * - `SuccessToast` — a *transient* confirmation of a completed mutation
 *   ("Supplier created."). It is `position: fixed`, announced politely
 *   (`role="status"`), auto-dismisses, and shows one at a time. Use it after
 *   create/update/delete succeeds, including when the mutation navigates away
 *   — the toast survives the navigation when mounted in a layout.
 * - `Alert` — *persistent, in-flow* status: a page-level result, a validation
 *   summary, a warning the operator must keep seeing. Never use a toast for
 *   anything the reader must act on later; toasts disappear.
 */
import { useEffect } from "react";
import type { ReactNode } from "react";

import { color, elevation, radius, spacing, typography } from "./tokens";

const fontSans = { fontFamily: typography.fontFamily.sans } as const;

export interface SuccessToastProps {
  message: ReactNode;
  /** Visibility; render the component and toggle this from the mutation handler. */
  open?: boolean;
  /** Called on auto-dismiss or the × button. Omit for a non-dismissible toast. */
  onDismiss?: () => void;
  /** Auto-dismiss delay in ms; `0` disables it. Default 5000. */
  duration?: number;
  /** Optional single action (e.g. an "Undo" or "View" link). */
  action?: ReactNode;
}

export function SuccessToast({
  message,
  open = true,
  onDismiss,
  duration = 5000,
  action,
}: SuccessToastProps) {
  useEffect(() => {
    if (!open || duration <= 0 || !onDismiss) return;
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
  }, [open, duration, onDismiss]);

  if (!open) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="aquarela-toast"
      style={{
        ...fontSans,
        position: "fixed",
        right: spacing[6],
        bottom: spacing[6],
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        gap: spacing[3],
        maxWidth: 420,
        padding: `${spacing[3]}px ${spacing[4]}px`,
        backgroundColor: color.surface.strong,
        border: `1px solid ${color.border.subtle}`,
        borderLeft: `3px solid ${color.status.success.fg}`,
        borderRadius: radius.md,
        boxShadow: elevation.lg,
        fontSize: typography.fontSize.md,
        color: color.ink.primary,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 20,
          height: 20,
          flexShrink: 0,
          borderRadius: radius.pill,
          backgroundColor: color.status.success.bg,
          color: color.status.success.fg,
          fontSize: typography.fontSize.sm,
          fontWeight: typography.fontWeight.bold,
        }}
      >
        ✓
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>{message}</span>
      {action ? <span style={{ flexShrink: 0 }}>{action}</span> : null}
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss notification"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 24,
            height: 24,
            flexShrink: 0,
            padding: 0,
            border: "none",
            borderRadius: radius.sm,
            background: "transparent",
            color: color.ink.tertiary,
            fontSize: typography.fontSize.lg,
            lineHeight: 1,
            cursor: "pointer",
          }}
        >
          <span aria-hidden="true">×</span>
        </button>
      ) : null}
    </div>
  );
}
