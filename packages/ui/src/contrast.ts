const HEX_PATTERN = /^#?(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function normalizeHex(hex: string): string {
  if (!HEX_PATTERN.test(hex)) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  const value = hex.replace(/^#/, "");
  if (value.length === 3) {
    return value
      .split("")
      .map((char) => char + char)
      .join("");
  }
  return value.toLowerCase();
}

function channelLuminance(channel: number): number {
  const scaled = channel / 255;
  return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x relative luminance of an sRGB hex color (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number {
  const value = normalizeHex(hex);
  const r = channelLuminance(parseInt(value.slice(0, 2), 16));
  const g = channelLuminance(parseInt(value.slice(2, 4), 16));
  const b = channelLuminance(parseInt(value.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two hex colors (1 to 21). */
export function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}
