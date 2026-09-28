import { EmptyState, color, spacing, typography } from "@aquarela/ui";
import Link from "next/link";

export const metadata = { title: "Page not found — Aquarela Business Control" };

const frame = {
  display: "flex",
  justifyContent: "center",
  padding: `${spacing[12]}px ${spacing[4]}px`,
  backgroundColor: color.background.page,
} as const;

const link = {
  color: color.accent.deep,
  fontSize: typography.fontSize.md,
  fontWeight: typography.fontWeight.medium,
  textDecoration: "underline",
} as const;

/** Root not-found state (covers unauthenticated routes). No session
 * assumption; the way back is the app home. */
export default function RootNotFound() {
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
