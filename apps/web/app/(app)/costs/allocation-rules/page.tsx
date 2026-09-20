import { EmptyState, SectionCard, Table, Td, Th } from "@aquarela/ui";

import { getCostingReadContext, loadAllocationRules } from "../data";
import { formatWindow, orDash } from "../format";

export const dynamic = "force-dynamic";

/**
 * Allocation rules (COST-007/011): how each pool is split. `denominator_source`
 * is currently free text (a closed vocabulary is an open owner decision), so it
 * is shown verbatim.
 */
export default async function AllocationRulesPage() {
  const context = await getCostingReadContext();
  const rows = await loadAllocationRules(context);

  return (
    <SectionCard
      title="Allocation rules"
      meta={`${rows.length} ${rows.length === 1 ? "rule" : "rules"}`}
    >
      {rows.length === 0 ? (
        <EmptyState title="No allocation rules registered">
          An allocation rule says how a cost pool is split — its driver, scope and denominator
          source. None exist in this organization yet.
        </EmptyState>
      ) : (
        <Table caption="Allocation rules, grouped by pool code and newest first." columnCount={6}>
          <thead>
            <tr>
              <Th>Pool</Th>
              <Th>Driver</Th>
              <Th>Scope</Th>
              <Th>Denominator source</Th>
              <Th>Fallback</Th>
              <Th>Effective</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <Td>{orDash(row.costPoolCode)}</Td>
                <Td>{row.driver}</Td>
                <Td>{row.scopeType}</Td>
                <Td>{orDash(row.denominatorSource)}</Td>
                <Td>{row.fallbackBehavior}</Td>
                <Td style={{ whiteSpace: "nowrap" }}>
                  {formatWindow(row.effectiveFrom, row.effectiveTo)}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </SectionCard>
  );
}
