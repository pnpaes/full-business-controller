/**
 * Presentational sub-components for the Management home composition.
 *
 * Server-component compatible: no hooks, no effects, no client state. All
 * styling is token-driven inline styles; the responsive rule the table needs
 * (dropping the ingredient-cost column on phones) lives in the page-scoped
 * `mh-` CSS block on `page.tsx`, which is the only place inline styles cannot
 * reach (media queries). The hero/secondary metric band is the Wave 0
 * `MetricBand`/`MetricHero`/`MetricSecondary` from `@aquarela/ui`.
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
  /** Optional per-measure note (e.g. the contribution exclusion). */
  note?: ReactNode | undefined;
}

/**
 * The grouped period-measures band used by the Insights landing, which
 * imports it from here (`MetricBand` from `@aquarela/ui` is the Wave 0
 * hero-band primitive the Management home composes instead). The band-level
 * meta line (period · scope · freshness) is carried by the wrapping
 * `SectionCard`, so the cells stay quiet; a cell may still add its own note.
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
  /** Preformatted by the caller with the Wave 0 money formatter. */
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
 * The location comparison as a lightweight table inside its `Collapsible`
 * section: quiet column labels, soft horizontal separators, tonal row hover
 * via the `aquarela-table` class, and a drill-down link on the location name
 * where the group carries a `locationId` (`08_UI_UX.md` §8.4: summaries drill
 * to records). Money cells arrive preformatted (grouped, currency appended)
 * from the page's Wave 0 formatters. The ingredient-cost column is dropped on
 * phones (`.mh-col-cost` in the page CSS) so the table reads without
 * horizontal scrolling where practical.
 */
export function LocationComparisonTable({
  caption,
  rows,
}: {
  caption: string;
  readonly rows: readonly LocationComparisonRow[];
}) {
  return (
    <div style={{ overflowX: "auto", minWidth: 0 }}>
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
