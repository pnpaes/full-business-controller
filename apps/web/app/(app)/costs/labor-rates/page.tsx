import { EmptyState, SectionCard, Table, Td, Th, color, spacing, typography } from "@aquarela/ui";
import { ROLE_CODE } from "@aquarela/persistence";

import { getCostingReadContext, loadCostCenters, loadLaborRates } from "../data";
import { formatMoney, formatPercent, formatWindow, orDash } from "../format";
import { RegisterLaborRateForm } from "./register-labor-rate-form";

export const dynamic = "force-dynamic";

const numCell = { textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;

/**
 * Labour rates (COST-004): the loaded hourly rate per role and cost centre,
 * newest effective window first. `productive_hours_pct` null means 100%
 * productive; it is not the same as zero. The register form posts to the same
 * command route the API exposes.
 */
export default async function LaborRatesPage() {
  const context = await getCostingReadContext();
  const [rows, costCenters] = await Promise.all([
    loadLaborRates(context),
    loadCostCenters(context),
  ]);

  const costCenterOptions = costCenters.map((center) => ({
    id: center.id,
    code: center.code,
    name: center.name,
  }));

  return (
    <>
      <SectionCard
        title="Labour rates"
        meta={`${rows.length} ${rows.length === 1 ? "rate" : "rates"}`}
      >
        {rows.length === 0 ? (
          <EmptyState title="No labour rates registered">
            A labour rate appears once a role&apos;s base wage and statutory percentages are
            recorded for a cost centre. None exist in this organization yet.
          </EmptyState>
        ) : (
          <div style={{ overflowX: "auto", minWidth: 0 }}>
            <Table caption="Loaded labour rates, newest effective window first." columnCount={5}>
              <thead>
                <tr>
                  <Th>Role</Th>
                  <Th>Cost centre</Th>
                  <Th style={numCell}>Loaded hourly rate</Th>
                  <Th style={numCell}>Productive hours</Th>
                  <Th>Effective</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <Td>{row.roleCode}</Td>
                    <Td>{orDash(row.costCenterName)}</Td>
                    <Td style={numCell}>{formatMoney(row.loadedHourlyRate)}</Td>
                    <Td style={numCell}>
                      {row.productiveHoursPct === null ? (
                        <span style={{ color: color.text.muted }}>100% (default)</span>
                      ) : (
                        formatPercent(row.productiveHoursPct)
                      )}
                    </Td>
                    <Td style={{ whiteSpace: "nowrap" }}>
                      {formatWindow(row.effectiveFrom, row.effectiveTo)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
        <p
          style={{
            margin: `${spacing[3]}px 0 0`,
            fontSize: typography.fontSize.xs,
            color: color.text.muted,
          }}
        >
          The loaded rate is derived from the base wage and statutory percentages at registration;
          the stored 2 dp value is shown here.
        </p>
      </SectionCard>
      <RegisterLaborRateForm
        costCenters={costCenterOptions}
        currency={context.currency}
        roleCodes={ROLE_CODE}
      />
    </>
  );
}
