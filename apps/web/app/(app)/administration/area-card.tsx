import { color, radius, spacing, typography } from "@aquarela/ui";
import type { CSSProperties, ReactNode } from "react";

/**
 * One card of the administration hub grid: the area's name, a one-line
 * purpose, and its headline count as the anchor figure. The whole card is a
 * link to the area's own register screen.
 */

export interface AreaCardProps {
  readonly href: string;
  readonly title: string;
  readonly description: string;
  /** The headline figure (e.g. "5", "—") with its unit label. */
  readonly count: ReactNode;
  readonly countLabel: string;
}

const cardStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: spacing[2],
  padding: spacing[5],
  backgroundColor: color.background.surface,
  border: `1px solid ${color.border.subtle}`,
  borderRadius: radius["2xl"],
  textDecoration: "none",
};

const titleStyle = {
  margin: 0,
  fontFamily: typography.fontFamily.sans,
  fontSize: typography.fontSize.lg,
  fontWeight: typography.fontWeight.medium,
  color: color.text.primary,
} as const;

const descriptionStyle = {
  margin: 0,
  fontFamily: typography.fontFamily.sans,
  fontSize: typography.fontSize.md,
  lineHeight: typography.lineHeight.normal,
  color: color.text.secondary,
} as const;

const countStyle = {
  marginTop: "auto",
  paddingTop: spacing[2],
  display: "flex",
  alignItems: "baseline",
  gap: spacing[2],
} as const;

export function AreaCard({ href, title, description, count, countLabel }: AreaCardProps) {
  return (
    <a href={href} style={cardStyle}>
      <h2 style={titleStyle}>{title}</h2>
      <p style={descriptionStyle}>{description}</p>
      <span style={countStyle}>
        <span
          style={{
            fontFamily: typography.fontFamily.display,
            fontSize: typography.fontSize["2xl"],
            fontVariantNumeric: typography.fontVariantNumeric.tabular,
            color: color.ink.primary,
          }}
        >
          {count}
        </span>
        <span
          style={{
            fontFamily: typography.fontFamily.sans,
            fontSize: typography.fontSize.sm,
            color: color.text.muted,
          }}
        >
          {countLabel}
        </span>
      </span>
    </a>
  );
}
