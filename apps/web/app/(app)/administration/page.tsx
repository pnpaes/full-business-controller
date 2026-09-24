import { Badge, PageHeader, SectionCard, color, spacing, typography } from "@aquarela/ui";

export const metadata = { title: "Administration — Aquarela Business Control" };

/**
 * Administration hub (08_UI_UX.md §8.3: users/scopes, tax/rules, units,
 * imports, integrations, audit and data quality). Only capabilities with an
 * existing screen and application service are linked — Imports today. The
 * remaining domains have no application read service and no route yet, so they
 * are listed as unavailable instead of offering controls that do nothing.
 * No backend was added in this wave.
 */

const contentColumn = {
  display: "flex",
  flexDirection: "column",
  gap: spacing[6],
} as const;

const list = {
  margin: 0,
  padding: 0,
  listStyle: "none",
  display: "flex",
  flexDirection: "column",
  gap: spacing[2],
  color: color.text.secondary,
  fontSize: typography.fontSize.md,
} as const;

const link = {
  color: color.brand.navy,
  fontWeight: typography.fontWeight.semibold,
} as const;

const backLink = {
  ...link,
  alignSelf: "flex-start",
  minHeight: 44,
  display: "inline-flex",
  alignItems: "center",
} as const;

const muted = {
  color: color.text.secondary,
} as const;

export default function AdministrationPage() {
  return (
    <div style={contentColumn}>
      <PageHeader
        title="Administration"
        scope="Aquarela Business Control"
        description="Configuration and oversight areas. Only capabilities with an existing screen are linked; the rest stay listed with the reason they are not available yet."
      />
      <SectionCard title="Available" meta="Linked screens">
        <ul style={list}>
          <li>
            <a href="/sales/import" style={link}>
              Imports
            </a>{" "}
            — sales import history: register, stage, validate, map and preview runs at{" "}
            <span style={muted}>/sales/import</span>.
          </li>
        </ul>
      </SectionCard>
      <SectionCard title="Not available yet" headingLevel={3} meta="No backend">
        <ul style={list}>
          <li>
            <Badge>No backend</Badge> Users/scopes — no user, role or location scope management
            service or screen exists yet.
          </li>
          <li>
            <Badge>No backend</Badge> Tax/rules — no tax or rule configuration service or screen
            exists yet.
          </li>
          <li>
            <Badge>No backend</Badge> Units — unit registration exists in the catalog service, but
            there is no read service or screen to list units, so nothing can be shown read-only yet.
          </li>
          <li>
            <Badge>No backend</Badge> Integrations — no integration configuration service or screen
            exists yet.
          </li>
          <li>
            <Badge>No backend</Badge> Audit — no audit event service or screen exists yet.
          </li>
          <li>
            <Badge>No backend</Badge> Data quality — exceptions can only be recorded by other
            slices; there is no read service or screen to review them yet.
          </li>
        </ul>
      </SectionCard>
      <a href="/" style={backLink}>
        Back to Management home
      </a>
    </div>
  );
}
