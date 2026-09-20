import { PageHeader, spacing } from "@aquarela/ui";
import type { ReactNode } from "react";

import { CostsTabs } from "./tabs";

export const metadata = { title: "Costs — Aquarela Business Control" };

/**
 * Costs area shell (08_UI_UX.md §8.3): one page header and a link-based section
 * strip shared by the cost-card, price-scenario and slice-6 fact screens. The
 * route group's layout already resolved the session, so these pages are only
 * reachable while signed in.
 */
export default function CostsLayout({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: spacing[5],
        width: "100%",
        maxWidth: 1120,
        margin: "0 auto",
      }}
    >
      <PageHeader
        title="Costs"
        scope="Aquarela Business Control"
        description="Product costs from their components and labour, overhead pools and allocation, and priced scenarios."
      />
      <CostsTabs />
      {children}
    </div>
  );
}
