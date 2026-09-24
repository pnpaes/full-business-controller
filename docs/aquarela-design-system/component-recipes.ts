/** Merge these recipes into existing shared component sources/CVA variants.
 * Do NOT pass them as per-screen styling overrides. Retain refs, behavior,
 * selectors, composition, icon rules, validation and accessibility attributes.
 * No assumptions about Radix vs Base UI, path aliases or icon library.
 */
export const buttonTheme = {
  base: "rounded-md text-sm font-medium shadow-none transition-colors duration-[var(--aq-motion-fast)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-[0.45] motion-reduce:transition-none",
  variants: {
    default: "bg-primary text-primary-foreground hover:bg-primary/90",
    outline: "border border-input bg-card text-card-foreground hover:bg-muted",
    secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
    ghost: "hover:bg-accent hover:text-accent-foreground",
    destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
    link: "text-brand underline-offset-4 hover:underline",
    "brand-soft": "bg-brand-soft text-brand-soft-foreground hover:bg-brand/15",
  },
  sizes: {
    default: "h-10 gap-2 px-4 py-2 [@media(pointer:coarse)]:min-h-11",
    sm: "h-8 gap-1.5 px-3 text-xs [@media(pointer:coarse)]:min-h-11",
    lg: "h-12 gap-2 px-5",
    icon: "size-10 [@media(pointer:coarse)]:size-11",
  },
} as const;

export const badgeTheme = {
  base: "inline-flex items-center gap-1 rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap",
  variants: {
    success: "bg-success text-success-foreground",
    warning: "bg-warning text-warning-foreground",
    danger: "bg-danger text-danger-foreground",
    info: "bg-info text-info-foreground",
    neutral: "bg-secondary text-secondary-foreground",
    brand: "bg-brand-soft text-brand-soft-foreground",
  },
} as const;

export const componentTheme = {
  card: "rounded-lg border border-border bg-card text-card-foreground shadow-none",
  cardHeader: "px-6 pt-6",
  cardTitle: "text-base font-medium leading-6",
  cardDescription: "text-sm text-muted-foreground",
  cardContent: "px-6",
  cardFooter: "flex items-center gap-3 px-6 pb-6",
  input: "h-10 rounded-md border-input bg-card text-foreground text-base md:text-sm shadow-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-invalid:border-destructive [@media(pointer:coarse)]:min-h-11",
  selectTrigger: "h-10 rounded-md border-input bg-card text-foreground text-sm shadow-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-invalid:border-destructive [@media(pointer:coarse)]:min-h-11",
  tableHead: "h-10 bg-muted px-4 text-xs font-medium text-muted-foreground",
  tableRow: "h-14 border-b border-border hover:bg-muted data-[state=selected]:bg-accent",
  tableCell: "px-4 py-3 text-sm",
  numericCell: "text-right tabular-nums",
  popover: "rounded-md border-border bg-popover text-popover-foreground shadow-lg",
  dialog: "rounded-xl border-border bg-popover text-popover-foreground shadow-xl",
  separator: "bg-border",
} as const;

/** UI mapping only: domain status calculation belongs in the existing app. */
export const stockPresentation = {
  inStock: { label: "In stock", variant: "success" },
  lowStock: { label: "Low stock", variant: "warning" },
  outOfStock: { label: "Out of stock", variant: "danger" },
  ordered: { label: "Ordered", variant: "info" },
} as const;
