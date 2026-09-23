import {
  Badge,
  EmptyState,
  PageHeader,
  SectionCard,
  color,
  spacing,
  typography,
} from "@aquarela/ui";

export const metadata = { title: "Tasks — Aquarela Business Control" };

const plannedScreens = [
  {
    label: "Daily/month close checklist",
    href: "/close",
    note: "Begin, lock and reopen a location daily close or the company month close (DEC-119).",
  },
];

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

const screenLink = backLink;

export default function TasksPage() {
  return (
    <div style={contentColumn}>
      <PageHeader
        title="Tasks"
        scope="Aquarela Business Control"
        description="Work the daily and month-close checklist: exceptions, snapshots, approval and lock."
      />
      <SectionCard title="Screens" meta="08_UI_UX.md §8.3">
        <ul style={checklist}>
          {plannedScreens.map((screen) => (
            <li key={screen.href}>
              <a href={screen.href} style={screenLink}>
                {screen.label}
              </a>{" "}
              — {screen.note}
            </li>
          ))}
        </ul>
      </SectionCard>
      <EmptyState
        title="Tasks is not wired to data yet"
        action={
          <a href="/" style={backLink}>
            Back to Management home
          </a>
        }
      >
        <Badge>Not yet implemented</Badge> The close register is live at{" "}
        <a href="/close" style={backLink}>
          Close
        </a>
        ; the wider task list depends on sales, cost and stock slices being in place first. Until
        then this area shows no tasks rather than empty placeholders that look like real work.
      </EmptyState>
    </div>
  );
}
