import {
  Badge,
  EmptyState,
  PageHeader,
  SectionCard,
  color,
  spacing,
  typography,
} from "@aquarela/ui";

export const metadata = { title: "Production — Aquarela Business Control" };

const plannedScreens = ["Production board", "Batch entry", "Waste entry"];

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

export default function ProductionPage() {
  return (
    <div style={contentColumn}>
      <PageHeader
        title="Production"
        scope="Aquarela Business Control"
        description="Plan, release and complete batches, then record waste against the recipe and stock."
      />
      <SectionCard title="Planned screens" meta="08_UI_UX.md §8.3">
        <ul style={checklist}>
          {plannedScreens.map((screen) => (
            <li key={screen}>{screen}</li>
          ))}
        </ul>
      </SectionCard>
      <EmptyState
        title="Production is not wired to data yet"
        action={
          <a href="/inventory" style={backLink}>
            Go to Inventory
          </a>
        }
      >
        <Badge>Not yet implemented</Badge> The board, batch entry and waste entry need recipes,
        stock availability and posted movements before they can show anything. Until then this area
        explains what is missing rather than displaying invented figures.
      </EmptyState>
    </div>
  );
}
