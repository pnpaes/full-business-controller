"use client";

/**
 * Client-only dialog for the Aquarela Business Controller screens
 * (08_UI_UX.md §8.5 explicit submit, §8.6 mobile operational behavior,
 * §8.7 visual direction; 07_SECURITY_AND_NFR.md §7.8).
 *
 * This is the one pattern that needs client behaviour (Escape/backdrop close,
 * focus on open), so it lives in its own `"use client"` module and the rest of
 * `patterns.tsx` stays server-component compatible. Render it from a client
 * component, never directly from a server component.
 */
import { useEffect, useId, useRef } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";

import { MIN_TOUCH_TARGET_PX } from "./components";
import { color, elevation, radius, spacing, typography } from "./tokens";

const fontSans = { fontFamily: typography.fontFamily.sans } as const;
const fontDisplay = { fontFamily: typography.fontFamily.display } as const;

export interface ModalProps {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  open?: boolean;
  onClose?: () => void;
}

/**
 * Dialog with `role="dialog"` + `aria-modal`, Escape and backdrop close, and
 * focus moved to the dialog on open. Controls are ≥44px (§8.6). Renders nothing
 * when `open` is false.
 */
export function Modal({ title, children, footer, open = false, onClose }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const closeOnBackdrop = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose?.();
  };

  return (
    <div
      onMouseDown={closeOnBackdrop}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: spacing[4],
        backgroundColor: "rgba(23, 25, 24, 0.45)",
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{
          ...fontSans,
          width: "100%",
          maxWidth: 560,
          maxHeight: "90vh",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: spacing[4],
          padding: spacing[5],
          backgroundColor: color.surface.strong,
          borderRadius: radius["2xl"],
          boxShadow: elevation.lg,
          outline: "none",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: spacing[3],
          }}
        >
          <h2
            id={titleId}
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
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                minWidth: MIN_TOUCH_TARGET_PX,
                minHeight: MIN_TOUCH_TARGET_PX,
                padding: 0,
                background: "transparent",
                border: "none",
                borderRadius: radius.sm,
                color: color.text.secondary,
                fontSize: typography.fontSize.xl,
                lineHeight: typography.lineHeight.tight,
                cursor: "pointer",
              }}
            >
              <span aria-hidden="true">×</span>
            </button>
          ) : null}
        </div>
        <div>{children}</div>
        {footer ? (
          <div style={{ display: "flex", justifyContent: "flex-end", gap: spacing[3] }}>
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
