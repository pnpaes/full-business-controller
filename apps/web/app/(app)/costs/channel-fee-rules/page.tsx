import { FEE_BASIS, FEE_KIND } from "@aquarela/persistence";
import { Badge, EmptyState, SectionCard, Table, Td, Th } from "@aquarela/ui";

import { getCostingReadContext, loadChannelFeeRules, loadChannels, loadTaxRules } from "../data";
import { formatInstantWindow, formatMoney, formatPercent } from "../format";
import { RegisterChannelFeeRuleForm } from "./register-channel-fee-rule-form";

export const dynamic = "force-dynamic";

function humanize(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Channel fee rules (`DEC-112`): the per-channel commission/processing/fixed
 * costs the channel-variable-cost resolver reads. Each rule may reference an
 * effective-dated tax rule (PRICE-005); the register form offers the real rule
 * as a `code · name` picker instead of a pasted UUID.
 */
export default async function ChannelFeeRulesPage() {
  const context = await getCostingReadContext();
  const [rules, channels, taxRules] = await Promise.all([
    loadChannelFeeRules(context),
    loadChannels(context),
    loadTaxRules(context),
  ]);
  const taxRuleCodes = new Map(taxRules.map((rule) => [rule.id, rule.code]));

  return (
    <>
      <SectionCard
        title="Channel fee rules"
        meta={`${rules.length} ${rules.length === 1 ? "rule" : "rules"} · newest first`}
      >
        {rules.length === 0 ? (
          <EmptyState title="No channel fee rules registered">
            A rule records a channel&apos;s commission, processing fee or fixed per-order cost. None
            exist in this organization yet.
          </EmptyState>
        ) : (
          <div style={{ overflowX: "auto", minWidth: 0 }}>
            <Table
              caption="Channel fee rules, newest effective window first, with the tax rule each references."
              columnCount={6}
            >
              <thead>
                <tr>
                  <Th>Channel</Th>
                  <Th>Fee kind</Th>
                  <Th>Amount</Th>
                  <Th>Basis</Th>
                  <Th>Tax rule</Th>
                  <Th>Effective</Th>
                </tr>
              </thead>
              <tbody>
                {rules.map((row) => (
                  <tr key={row.id}>
                    <Td>{row.channelName ?? row.channelId}</Td>
                    <Td>{humanize(row.feeKind)}</Td>
                    <Td style={{ whiteSpace: "nowrap" }}>
                      {row.percentageRate !== null
                        ? formatPercent(row.percentageRate)
                        : row.fixedAmount !== null
                          ? formatMoney(row.fixedAmount)
                          : "—"}
                    </Td>
                    <Td>{humanize(row.feeBasis)}</Td>
                    <Td>
                      {row.taxRuleId === null ? (
                        <span style={{ opacity: 0.7 }}>Unlinked</span>
                      ) : (
                        <Badge>{taxRuleCodes.get(row.taxRuleId) ?? row.taxRuleId}</Badge>
                      )}
                    </Td>
                    <Td style={{ whiteSpace: "nowrap" }}>
                      {formatInstantWindow(row.effectiveFrom, row.effectiveTo)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </SectionCard>

      {channels.length === 0 ? (
        <SectionCard title="Register a channel fee rule" meta="DEC-112">
          <EmptyState title="No channels registered">
            A channel fee rule is scoped to a sales channel. Register a channel first.
          </EmptyState>
        </SectionCard>
      ) : (
        <RegisterChannelFeeRuleForm
          channels={channels.map((channel) => ({
            id: channel.id,
            code: channel.code,
            name: channel.name,
          }))}
          taxRules={taxRules.map((rule) => ({
            id: rule.id,
            code: rule.code,
            name: rule.name,
            ratePct: rule.ratePct,
            appliesTo: rule.appliesTo,
          }))}
          feeKinds={FEE_KIND}
          feeBases={FEE_BASIS}
        />
      )}
    </>
  );
}
