# Applying Aquarela to the existing shadcn app

The package supplies theme definitions and merge recipes, not replacement component implementations. Read README.md before applying. The current workspace is not the Aquarela app.

## Inspect first

From the actual application directory, use the package manager declared by its package.json. For npm, run `npx shadcn@latest info --json`; equivalent pnpm/bun runners are supported. Inspect installed component sources, aliases, primitive base, Tailwind version and current theme before editing. Use the CLI `docs` command for the installed component APIs and `add --diff` only if an upstream change is necessary. Do not overwrite local business behavior.

## Theme merge

Copy the declarations in shadcn-theme.css into the existing root theme block. Map using tailwind-v4.css OR the exported v3 extension. The files deliberately use complete hex CSS colors to match the reviewed swatches exactly; full OKLCH values are also possible after equivalent conversion. Do not add a color-function wrapper around an already complete color.

Retain existing `@import`, `@custom-variant`, base layers, font loading and unrelated theme declarations. Check declarations that follow the merge: later root variables or higher-specificity theme selectors can override it. Use the computed styles on a Button, Card and Input to verify. If the app has a `.dark` root, preview under the light setting; this package does not supply dark mappings.

Tailwind 3: replace matching color mappings, not the entire configuration. `tailwind-v3.cjs` uses color-mix with an alpha placeholder so utilities such as `bg-primary/90` still work with complete CSS colors. This requires modern browser support for color-mix. For an older-browser requirement, convert values to channel tokens and adapt the mapping instead. Keep the recipes in the app's configured content paths so Tailwind can discover literal classes. Use opacity-[0.45] in place of opacity-45 if the installed v3 utility scale does not generate it.

## Shared variants

In the existing Button CVA, merge `buttonTheme.variants` and sizes; change visual base classes to the supplied base while retaining structural, SVG, state and primitive-specific selectors. The new `brand-soft` variant is for review/insight actions. Prefer default, outline, secondary, ghost and destructive for normal actions.

In the existing Badge CVA, add the semantic variants from `badgeTheme.variants`. Preserve existing variants used elsewhere; do not rename domain statuses just to match UI keys. `stockPresentation` is a label/variant mapping only, not a stock calculation API.

For Card and form primitives, replace conflicting styling in their source with corresponding `componentTheme` values. Card sections should collectively have 24 px outside padding without doubling the parent padding. Retain default flex/grid layout and spacing needed by the installed style. Do not add visual recipe classes to each screen's `className`; screen-level className is for layout.

## Composition examples

These are usage fragments after variant merging, not standalone files. Import from the actual aliases reported by `shadcn info`. Verify components are installed. Add a client boundary where the app framework needs one for event handlers. Preserve the installed icon family.

```tsx
<Button type="submit" disabled={isSaving}>
  {isSaving && <Spinner data-icon="inline-start" />}
  {isSaving ? "Saving…" : "Save product"}
</Button>
<Button type="button" variant="outline">Export report</Button>
<Button type="button" variant="brand-soft">Review stock</Button>
<Badge variant="warning">Low stock</Badge>
```

```tsx
<FieldGroup>
  <Field data-invalid={Boolean(quantityError)}>
    <FieldLabel htmlFor="stock-quantity">Stock on hand (kg)</FieldLabel>
    <Input
      id="stock-quantity"
      type="number"
      inputMode="decimal"
      min="0"
      step="0.01"
      value={quantity}
      onChange={handleQuantityChange}
      aria-invalid={Boolean(quantityError)}
      aria-describedby={quantityError ? "stock-error" : "stock-help"}
    />
    {quantityError ? (
      <FieldError id="stock-error">{quantityError}</FieldError>
    ) : (
      <FieldDescription id="stock-help">Count available stock in kilograms.</FieldDescription>
    )}
  </Field>
</FieldGroup>
```

```tsx
<Card>
  <CardHeader>
    <CardTitle>Inventory</CardTitle>
    <CardDescription>On-hand quantities for the selected shop.</CardDescription>
  </CardHeader>
  <CardContent>{/* Existing Table / Data Table */}</CardContent>
  <CardFooter>{/* Existing pagination / result count */}</CardFooter>
</Card>
```

For Select use SelectGroup around SelectItem; for Tabs use TabsList around TabsTrigger; all Dialog/Sheet/Drawer content needs its title. Use Alert, Empty and Skeleton primitives for states. Keep overlay focus management and stacking intact. Base UI triggers use their render API; Radix triggers use asChild where appropriate—do not migrate between them for a visual change. Toasts likewise follow the existing primitive base.

## Suggested rollout

1. Theme tokens and font/radius mapping. Check text, controls, and charts.
2. Shared Button, Badge, Input, Card, Table variants. Check current consumers.
3. Existing sales overview, inventory list and product form. Compare them to the guide.
4. Remaining screens, navigation and overlays. Remove conflicting one-off colors only where they duplicate the new contract.
5. Run the app's existing checks, then manually exercise primary workflows, errors and keyboard navigation. Save screenshots at laptop, tablet and mobile widths.

No app changes are claimed by this package. The receiving developer or agent must run the integration checks in the actual Aquarela codebase.
