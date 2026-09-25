/** Tax rules are stored as a 6 dp fraction (`0.150000` = 15 %; `TAX_RATE_SCALE`). */
const TAX_RATE_SCALE = 6;

/**
 * Converts the stored 6 dp fraction to a percentage **for display only**, by
 * moving the decimal point two places on the digit string. The value is never
 * re-derived or re-scaled through a float. Leading zeros in the whole part are
 * stripped so `0.150000` renders `15`, not `015`.
 */
export function fractionToPercentDisplay(fraction: string): string {
  const negative = fraction.startsWith("-");
  const [whole = "0", frac = ""] = fraction.replace(/^[+-]/, "").split(".");
  const digits = `${whole}${frac.padEnd(TAX_RATE_SCALE, "0")}`;
  const padded = digits.padStart(TAX_RATE_SCALE + 1, "0");
  const percentWhole = padded.slice(0, padded.length - (TAX_RATE_SCALE - 2));
  const percentFrac = padded.slice(padded.length - (TAX_RATE_SCALE - 2));
  const trimmed = `${percentWhole}.${percentFrac}`.replace(/\.?0+$/, "");
  const normalized = trimmed.replace(/^0+(?=\d)/, "");
  return `${negative ? "-" : ""}${normalized.length === 0 ? "0" : normalized}`;
}

/**
 * The scope label the register shows: the org-wide badge or the scoped ref,
 * resolved from the rule's own scope columns. A location-scoped rule has a null
 * `channelId` (the create command forbids both ids), so the lookup must key on
 * `scopeType`, never on whichever id happens to be set.
 */
export function taxScopeLabel(
  rule: {
    readonly scopeType: string;
    readonly locationId: string | null;
    readonly channelId: string | null;
  },
  channelLabelById: ReadonlyMap<string, string>,
  locationLabelById: ReadonlyMap<string, string>,
): string {
  if (rule.scopeType === "channel") {
    const label = rule.channelId === null ? undefined : channelLabelById.get(rule.channelId);
    return label === undefined ? "channel · unknown" : `channel · ${label}`;
  }
  if (rule.scopeType === "location") {
    const label = rule.locationId === null ? undefined : locationLabelById.get(rule.locationId);
    return label === undefined ? "location · unknown" : `location · ${label}`;
  }
  if (rule.scopeType === "organization") {
    return "organization";
  }
  if (rule.scopeType === "company_wide") {
    return "company wide";
  }
  // An unknown scope reads as itself rather than masquerading as company-wide.
  return rule.scopeType;
}
