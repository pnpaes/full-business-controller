import {
  Badge,
  EmptyState,
  PageHeader,
  SectionCard,
  color,
  spacing,
  typography,
} from "@aquarela/ui";

export const metadata = { title: "Sales — Aquarela Business Control" };

const plannedScreens = ["Sales import", "Reconciliation"];

const contentColumn = {
  display: "flex",
  flexDirection: "column",
  gap: spacing[6],
} as const;

const checklist = {
  margin: 0,
  paddingLeft: spacing[5],
  display: "flex",
  flexDirection: "column",
  gap: spacing[2],
  color: color.text.secondary,
  fontSize: typography.fontSize.md,
} as const;

const backLink = {
  color: color.brand.navy,
  fontWeight: typography.fontWeight.semibold,
} as const;

export default function SalesPage() {
  return (
    <div style={contentColumn}>
      <PageHeader
        title="Sales"
        scope="Aquarela Business Control"
        description="Import sales and settlement data, then reconcile source, posted and settlement totals."
      />
      <SectionCard title="Planned screens" meta="08_UI_UX.md §8.3">
        <ul style={checklist}>
          {plannedScreens.map((screen) => (
            <li key={screen}>{screen}</li>
          ))}
        </ul>
      </SectionCard>
      <EmptyState
        title="Sales is not wired to data yet"
        action={
          <a href="/" style={backLink}>
            Back to Management home
          </a>
        }
      >
        <Badge>Not yet implemented</Badge> Uploading sales files and reconciling them against
        settlements arrives with the sales slice. Until then this area shows no figures, and the
        Management dashboard will report the missing source data.
      </EmptyState>
    </div>
  );
}
