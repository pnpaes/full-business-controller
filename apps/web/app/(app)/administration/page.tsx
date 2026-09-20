import {
  Badge,
  EmptyState,
  PageHeader,
  SectionCard,
  color,
  spacing,
  typography,
} from "@aquarela/ui";

export const metadata = { title: "Administration — Aquarela Business Control" };

const accessAndRules = ["Users/scopes", "Tax/rules", "Units"];
const dataAndIntegrations = ["Imports", "Integrations", "Audit", "Data quality"];

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

export default function AdministrationPage() {
  return (
    <div style={contentColumn}>
      <PageHeader
        title="Administration"
        scope="Aquarela Business Control"
        description="Manage users and scopes, tax and unit rules, imports, integrations, audit and data quality."
      />
      <SectionCard title="Access, rules and units" meta="08_UI_UX.md §8.3">
        <ul style={checklist}>
          {accessAndRules.map((screen) => (
            <li key={screen}>{screen}</li>
          ))}
        </ul>
      </SectionCard>
      <SectionCard title="Data, integrations and audit" headingLevel={3}>
        <ul style={checklist}>
          {dataAndIntegrations.map((screen) => (
            <li key={screen}>{screen}</li>
          ))}
        </ul>
      </SectionCard>
      <EmptyState
        title="Administration is not wired to data yet"
        action={
          <a href="/" style={backLink}>
            Back to Management home
          </a>
        }
      >
        <Badge>Not yet implemented</Badge> Administration needs the persistence and auth slices
        before users, scopes, rules or imports can be managed. Until then this area lists the
        planned screens instead of offering controls that do nothing.
      </EmptyState>
    </div>
  );
}
