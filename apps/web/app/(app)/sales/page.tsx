import { Badge, PageHeader, SectionCard, Tabs, color, spacing, typography } from "@aquarela/ui";
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
 * Sales landing (08_UI_UX.md §8.3). Links the three row-12 surfaces: the row-11
 * **import** framework, the posted **transactions**, and the **reconciliation**
 * of source/posted/settlement totals. Every figure shown downstream is read
 * from the database — nothing is fabricated.
 */
export default function SalesPage() {
  return (
    <div style={contentColumn}>
      <PageHeader
        title="Sales"
        scope="Aquarela Business Control"
        description="Import sales data from a POS export, post the validated rows, review the resulting transactions and reconcile source, posted and settlement totals."
      />

      <Tabs
        items={[
          { label: "Sales", href: "/sales", active: true },
          { label: "Sales import", href: "/sales/import" },
          { label: "Transactions", href: "/sales/transactions" },
          { label: "Reconciliation", href: "/sales/reconciliation" },
        ]}
        ariaLabel="Sales sections"
      />

      <SectionCard title="Sales import" meta="upload · review · post">
        <p style={{ margin: `0 0 ${spacing[3]}px`, color: color.text.secondary }}>
          Register a sales export, stage its rows, validate and map them to the catalogue, record a
          disposition for every row that will not be posted, then post the run into sales. Posting
          is idempotent on the external transaction/line keys, so a retry cannot duplicate a
          transaction.
        </p>
        <Link href="/sales/import" style={linkStyle}>
          Open sales import →
        </Link>
      </SectionCard>

      <SectionCard title="Transactions" meta="posted sales lines">
        <p style={{ margin: `0 0 ${spacing[3]}px`, color: color.text.secondary }}>
          The posted sales transactions with their location, channel, gross/net/tax totals and line
          count. Open a transaction to see its lines, the captured applied tax rate and each line's
          option kind and mapping state.
        </p>
        <Link href="/sales/transactions" style={linkStyle}>
          Open transactions →
        </Link>
      </SectionCard>

      <SectionCard title="Reconciliation" meta="source vs posted vs settlement">
        <p style={{ margin: `0 0 ${spacing[3]}px`, color: color.text.secondary }}>
          Reconcile a posted import run or a channel settlement against the posted sales, then
          resolve the exception with a note. The tolerance is the caller's explicit value or an
          explicit opt-in to the published DEC-026 default — there is no tolerance table, so a
          missing tolerance blocks close rather than defaulting silently.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: spacing[3] }}>
          <Link href="/sales/reconciliation" style={linkStyle}>
            Open reconciliation →
          </Link>
          <Badge>DEC-026 · DEC-035</Badge>
        </div>
      </SectionCard>
    </div>
  );
}
