import { Badge, EmptyState, SectionCard, Table, Td, Th } from "@aquarela/ui";

import { getCostingReadContext, loadCostPools } from "../data";
import { formatWindow, orDash } from "../format";

export const dynamic = "force-dynamic";

/**
 * Cost pools (COST-007): a pool code is versioned, not unique, so several rows
 * can share a code with non-overlapping effective windows.
 */
export default async function CostPoolsPage() {
  const context = await getCostingReadContext();
  const rows = await loadCostPools(context);

  return (
    <SectionCard title="Cost pools" meta={`${rows.length} ${rows.length === 1 ? "pool" : "pools"}`}>
      {rows.length === 0 ? (
        <EmptyState title="No cost pools registered">
          A cost pool groups shared overhead for allocation to locations or products. None exist in
          this organization yet.
        </EmptyState>
      ) : (
        <Table caption="Cost pools, grouped by code and newest version first." columnCount={4}>
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Name</Th>
              <Th>Effective</Th>
              <Th>Version</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <Td>{orDash(row.code)}</Td>
                <Td>{orDash(row.name)}</Td>
                <Td style={{ whiteSpace: "nowrap" }}>
                  {formatWindow(row.effectiveFrom, row.effectiveTo)}
                </Td>
                <Td>{row.effectiveTo === null ? <Badge>Current</Badge> : <Badge>Closed</Badge>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </SectionCard>
  );
}
