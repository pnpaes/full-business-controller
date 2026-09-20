import {
  Badge,
  EmptyState,
  PageHeader,
  SectionCard,
  color,
  spacing,
  typography,
} from "@aquarela/ui";

export const metadata = { title: "Insights — Aquarela Business Control" };

const plannedScreens = ["Planning", "Competitors"];

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

export default function InsightsPage() {
  return (
    <div style={contentColumn}>
      <PageHeader
        title="Insights"
        scope="Aquarela Business Control"
        description="Compare forecast with actual, review suggestions and overrides, and track competitor pricing."
      />
      <SectionCard title="Planned screens" meta="08_UI_UX.md §8.3">
        <ul style={checklist}>
          {plannedScreens.map((screen) => (
            <li key={screen}>{screen}</li>
          ))}
        </ul>
      </SectionCard>
      <EmptyState
        title="Insights is not wired to data yet"
        action={
          <a href="/" style={backLink}>
            Back to Management home
          </a>
        }
      >
        <Badge>Not yet implemented</Badge> Planning and competitor views need history and dated
        observations before they can show accuracy or seasonality. Until then this area describes
        what is planned instead of charting placeholders.
      </EmptyState>
    </div>
  );
}
