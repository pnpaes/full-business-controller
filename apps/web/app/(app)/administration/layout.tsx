import { PageHeader, containerWidth, spacing } from "@aquarela/ui";
import type { ReactNode } from "react";

import { AdminTabs } from "./tabs";

export const metadata = { title: "Administration — Aquarela Business Control" };

/**
 * Administration area shell: one page header and the section strip shared by
 * the hub and the per-area registers (users, integrations, tax rules, units,
 * data quality, audit). The route group's layout already resolved the session,
 * so these pages are only reachable while signed in.
 */
export default function AdministrationLayout({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: spacing[5],
        width: "100%",
        maxWidth: containerWidth.default,
        margin: "0 auto",
      }}
    >
      <PageHeader
        title="Administration"
        scope="Aquarela Business Control"
        description="Configuration and oversight areas — one screen per area, chosen from the section tabs."
      />
      <AdminTabs />
      {children}
    </div>
  );
}
