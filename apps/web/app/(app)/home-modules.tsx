/**
 * Presentational sub-components for the Management home composition
 * (`designer-agent-modern-saas-ui-brief.md` §5, §8, §9, §11; DEC-120).
 *
 * Server-component compatible: no hooks, no effects, no client state. All
 * styling is token-driven inline styles; the responsive composition rules
 * (brief §18) live in the page-scoped `mh-` CSS block on `page.tsx`, which is
 * the only place inline styles cannot reach (media queries).
 */
import type { ReactNode } from "react";

import { Table, Td, Th, color, spacing, typography } from "@aquarela/ui";

const fontSans = { fontFamily: typography.fontFamily.sans } as const;

/* -------------------------------- Metric band ------------------------------- */

export interface MetricBandItem {
  /** Small muted caption naming the measure. */
  label: string;
  /** The figure, preformatted by the caller (unit/currency pairing). */
  value: ReactNode;
  /** Optional per-measure note (e.g. the contribution exclusion, `DEC-063`). */
  note?: ReactNode | undefined;
}

/**
 * The period measures as one analytical module (brief §5/§8/§16: related
 * metrics grouped into a single labelled band, not four identical cards).
 * The band-level meta line (period · scope · freshness) is carried by the
 * wrapping `SectionCard`, so the cells stay quiet; a cell may still add its
 * own note where a measure needs an extra qualifier.
 */
export function MetricBand({ items }: { readonly items: readonly MetricBandItem[] }) {
  return (
    <div className="mh-band">
      {items.map((item) => (
        <div key={item.label} className="mh-band-cell" style={{ minWidth: 0, ...fontSans }}>
          <span
            style={{
              display: "block",
              fontSize: typography.fontSize.sm,
              fontWeight: typography.fontWeight.medium,
              color: color.ink.secondary,
            }}
          >
            {item.label}
          </span>
          <span
            style={{
              display: "block",
              marginTop: spacing[1],
              fontSize: typography.fontSize["2xl"],
              fontWeight: typography.fontWeight.regular,
              lineHeight: typography.lineHeight.tight,
              fontVariantNumeric: typography.fontVariantNumeric.tabular,
              color: color.ink.primary,
            }}
          >
            {item.value}
          </span>
          {item.note ? (
            <span
              style={{
                display: "block",
                marginTop: spacing[1],
                fontSize: typography.fontSize.xs,
                lineHeight: typography.lineHeight.normal,
                color: color.ink.tertiary,
              }}
            >
              {item.note}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/* -------------------------- Location comparison table ----------------------- */

export interface LocationComparisonRow {
  /** The location label; links to its records when the data carries an id. */
  location: string;
  /** Drill-down href (`RPT-002` records route), or `null` when unlinked. */
  href: string | null;
  netSales: string;
  ingredientCost: string;
  contribution: string;
  margin: string;
}

const linkStyle = {
  color: color.ink.primary,
  fontWeight: typography.fontWeight.medium,
  textDecoration: "underline",
  textDecorationColor: color.border.strong,
  textUnderlineOffset: 3,
} as const;

const rightAlign = { textAlign: "right" } as const;

/**
 * The location comparison as a lightweight table integrated into the
 * composition (brief §11): quiet column labels, soft horizontal separators,
 * generous cells, tonal row hover via the `aquarela-table` class, and a
 * drill-down link on the location name where the group carries a
 * `locationId` (`08_UI_UX.md` §8.4: summaries drill to records). The
 * ingredient-cost column is dropped on phones (`.mh-col-cost` in the page
 * CSS) so the table reads without horizontal scrolling where practical.
 */
export function LocationComparisonTable({
  caption,
  rows,
}: {
  caption: string;
  readonly rows: readonly LocationComparisonRow[];
}) {
  return (
    <div className="mh-table-wrap" style={{ overflowX: "auto" }}>
      <Table caption={caption} columnCount={5}>
        <thead>
          <tr>
            <Th scope="col">Location</Th>
            <Th style={rightAlign}>Net sales</Th>
            <Th className="mh-col-cost" style={rightAlign}>
              Ingredient cost
            </Th>
            <Th style={rightAlign}>Contribution</Th>
            <Th style={rightAlign}>Margin</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              <Td style={{ fontWeight: typography.fontWeight.medium }}>
                {row.href ? (
                  <a href={row.href} style={linkStyle}>
                    {row.location}
                  </a>
                ) : (
                  row.location
                )}
              </Td>
              <Td style={rightAlign}>{row.netSales}</Td>
              <Td className="mh-col-cost" style={rightAlign}>
                {row.ingredientCost}
              </Td>
              <Td style={rightAlign}>{row.contribution}</Td>
              <Td style={rightAlign}>{row.margin}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
