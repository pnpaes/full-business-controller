import { EmptyState, SectionCard, Table, Td, Th } from "@aquarela/ui";
import {
  ALLOCATION_DENOMINATOR_SOURCE,
  ALLOCATION_DRIVER,
  ALLOCATION_FALLBACK,
  SCOPE_TYPE,
} from "@aquarela/persistence";

import { getCostingReadContext, loadAllocationRules, loadCostPools } from "../data";
import { formatWindow, orDash } from "../format";
import { RegisterAllocationRuleForm } from "./register-allocation-rule-form";

export const dynamic = "force-dynamic";

/**
 * Allocation rules (COST-007/011): how each pool is split. The denominator
 * source is a closed vocabulary (`ALLOCATION_DENOMINATOR_SOURCE`), so the
 * register form offers it as a select; the register form posts to the same
 * command route the API exposes.
 */
export default async function AllocationRulesPage() {
  const context = await getCostingReadContext();
  const [rows, pools] = await Promise.all([loadAllocationRules(context), loadCostPools(context)]);

  return (
    <>
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
          <div style={{ overflowX: "auto", minWidth: 0 }}>
            <Table
              caption="Allocation rules, grouped by pool code and newest first."
              columnCount={6}
            >
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
          </div>
        )}
      </SectionCard>
      <RegisterAllocationRuleForm
        pools={pools.map((pool) => ({ id: pool.id, code: pool.code, name: pool.name }))}
        drivers={ALLOCATION_DRIVER}
        scopeTypes={SCOPE_TYPE}
        denominatorSources={ALLOCATION_DENOMINATOR_SOURCE}
        fallbacks={ALLOCATION_FALLBACK}
      />
    </>
  );
}
