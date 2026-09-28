"use client";

import { Alert, Button, color, spacing, typography } from "@aquarela/ui";
import Link from "next/link";
import { useEffect } from "react";

const content = {
  display: "flex",
  flexDirection: "column",
  gap: spacing[4],
  width: "100%",
  maxWidth: 520,
  margin: "0 auto",
  padding: `${spacing[12]}px ${spacing[4]}px`,
} as const;

const link = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: 44,
  color: color.accent.deep,
  fontSize: typography.fontSize.md,
  fontWeight: typography.fontWeight.medium,
  textDecoration: "underline",
} as const;

/** Authenticated-area error state. Recovers in place without reloading the
 * shell; the real error is logged to the console only, never shown. */
export default function AppError({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main style={content}>
      <Alert tone="danger" title="Something went wrong">
        We couldn't load this page. Your data is safe. Try again, or go back to the start.
      </Alert>
      <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[3] }}>
        <Button onClick={() => reset()}>Try again</Button>
        <Link href="/" style={link}>
          Go to home
        </Link>
      </div>
    </main>
  );
}
