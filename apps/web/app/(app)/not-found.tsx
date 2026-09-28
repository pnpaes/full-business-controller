import { EmptyState, color, spacing, typography } from "@aquarela/ui";
import Link from "next/link";

export const metadata = { title: "Page not found — Aquarela Business Control" };

const frame = {
  display: "flex",
  justifyContent: "center",
  padding: `${spacing[12]}px ${spacing[4]}px`,
} as const;

const link = {
  color: color.accent.deep,
  fontSize: typography.fontSize.md,
  fontWeight: typography.fontWeight.medium,
  textDecoration: "underline",
} as const;

/** Authenticated-area not-found state: a calm block with a way back to the
 * board, no internals. */
export default function AppNotFound() {
  return (
    <main style={frame}>
      <div style={{ width: "100%", maxWidth: 520 }}>
        <EmptyState
          title="Page not found"
          action={
            <Link href="/" style={link}>
              Go to home
            </Link>
          }
        >
          We couldn't find the page you asked for. It may have moved, or the link may be out of
          date.
        </EmptyState>
      </div>
    </main>
  );
}
