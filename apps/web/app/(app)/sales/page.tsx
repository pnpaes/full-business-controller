import {
  Badge,
  EmptyState,
  PageHeader,
  SectionCard,
  color,
  spacing,
  typography,
} from "@aquarela/ui";
import Link from "next/link";

export const metadata = { title: "Sales — Aquarela Business Control" };

const contentColumn = {
  display: "flex",
  flexDirection: "column",
  gap: spacing[6],
  width: "100%",
  maxWidth: 1120,
  margin: "0 auto",
  padding: `${spacing[8]}px ${spacing[4]}px`,
} as const;

const linkStyle = {
  color: color.brand.berry,
  fontWeight: typography.fontWeight.semibold,
} as const;

/**
 * Sales landing (08_UI_UX.md §8.3). Slice 11 is the **import framework +
 * external mappings** only: it stops at `validated`/`needs_review` and posts
 * nothing. Posting, sales and settlement reconciliation are row 12, owner-gated
 * on `ADR-0008`, so Reconciliation is a placeholder here — not a stub that
 * shows invented figures.
 */
export default function SalesPage() {
  return (
    <div style={contentColumn}>
      <PageHeader
        title="Sales"
        scope="Aquarela Business Control"
        description="Import sales data from a POS export, review mappings and errors, and preview the source totals. Posting and settlement reconciliation arrive with row 12."
      />

      <SectionCard title="Sales import" meta="upload · review · preview">
        <p style={{ margin: `0 0 ${spacing[3]}px`, color: color.text.secondary }}>
          Register a sales export, stage its rows, validate and map them to the catalogue, and
          record a disposition for every row that will not be posted. The run stops at{" "}
          <strong>validated</strong> or <strong>needs review</strong>.
        </p>
        <Link href="/sales/import" style={linkStyle}>
          Open sales import →
        </Link>
      </SectionCard>

      <SectionCard title="Reconciliation" meta="08_UI_UX.md §8.3">
        <EmptyState title="Reconciliation is not yet implemented">
          <Badge>Not yet implemented</Badge> Source/posted/settlement totals, the amount tolerance
          and difference resolution arrive with row 12, which is owner-gated on{" "}
          <strong>ADR-0008</strong>. Until then this screen shows no reconciliation figures, and the
          import preview reports the residual for visibility only.
        </EmptyState>
      </SectionCard>
    </div>
  );
}
