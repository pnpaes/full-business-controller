"use client";

import { Alert, Button, color, spacing, typography } from "@aquarela/ui";
import Link from "next/link";
import { useEffect } from "react";

const frame = {
  display: "flex",
  justifyContent: "center",
  padding: `${spacing[12]}px ${spacing[4]}px`,
  backgroundColor: color.background.page,
} as const;

const content = {
  display: "flex",
  flexDirection: "column",
  gap: spacing[4],
  width: "100%",
  maxWidth: 520,
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

/** Root error state (covers unauthenticated routes such as `/login`). Client
 * component: it must not assume a session, show a stack or expose internal
 * identifiers — the real error goes to the console only. */
export default function RootError({
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
    <main style={frame}>
      <div style={content}>
        <Alert tone="danger" title="Something went wrong">
          We couldn't load this page. Your data is safe. Try again, or go back to the start.
        </Alert>
        <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[3] }}>
          <Button onClick={() => reset()}>Try again</Button>
          <Link href="/" style={link}>
            Go to home
          </Link>
        </div>
      </div>
    </main>
  );
}
