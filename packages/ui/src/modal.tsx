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
import type { FormEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";

import { Alert, Button, MIN_TOUCH_TARGET_PX } from "./components";
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

  // Focus the dialog on open and return focus to whatever was focused before
  // (usually the trigger) on close, so keyboard users are never stranded.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => previouslyFocused?.focus();
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
          borderRadius: radius.xl,
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

export interface FormModalProps {
  title: string;
  /** One line stating what the form does (inline microcopy, not an InfoTip). */
  description?: string;
  open: boolean;
  onClose: () => void;
  /** Called with the form's submit event; the caller owns async work + `busy`. */
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  /** While busy: the submit shows `loading`, and Escape/backdrop/Cancel no-op. */
  busy?: boolean;
  submitLabel?: string;
  cancelLabel?: string;
  /** Optional error shown above the actions (e.g. a failed mutation). */
  error?: ReactNode;
  children: ReactNode;
}

/**
 * The one **create/edit** modal shape (`docs/ux/README.md`, hard rule 1:
 * "creating and editing happen in a modal … a register's header carries
 * exactly one primary button and no form"). Wraps `Modal` — whose API is
 * unchanged — with the consistent furniture: title, description, a `<form>`
 * body, a danger-toned error slot and a Cancel / submit action row with a busy
 * state. Escape and backdrop close are inherited; both are suppressed while
 * `busy`.
 *
 * Focus handling: `Modal` moves focus to the dialog on open and returns it to
 * the trigger on close; `FormModal` then focuses the first field, so a form
 * opens ready to type.
 */
export function FormModal({
  title,
  description,
  open,
  onClose,
  onSubmit,
  busy = false,
  submitLabel = "Save",
  cancelLabel = "Cancel",
  error,
  children,
}: FormModalProps) {
  const formRef = useRef<HTMLFormElement>(null);

  const handleClose = () => {
    if (!busy) onClose();
  };

  useEffect(() => {
    if (!open) return;
    const firstField = formRef.current?.querySelector<HTMLElement>(
      'input:not([type="hidden"]), select, textarea, button',
    );
    firstField?.focus();
  }, [open]);

  return (
    <Modal title={title} open={open} onClose={handleClose}>
      <form
        ref={formRef}
        onSubmit={onSubmit}
        style={{ ...fontSans, display: "flex", flexDirection: "column", gap: spacing[4] }}
      >
        {description ? (
          <p
            style={{
              margin: 0,
              fontSize: typography.fontSize.md,
              lineHeight: typography.lineHeight.normal,
              color: color.text.secondary,
            }}
          >
            {description}
          </p>
        ) : null}
        {children}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: spacing[3],
            paddingTop: spacing[2],
          }}
        >
          <Button type="button" variant="secondary" onClick={handleClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button type="submit" loading={busy} disabled={busy}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
