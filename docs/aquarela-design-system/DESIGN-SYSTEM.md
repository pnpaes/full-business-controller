# Aquarela / Interface specification

0.1.0 · Proposed light theme · 24 September 2026

## Intent and scope

An operational interface for a coffee shop: legible through a busy shift, useful on a manager's laptop and a counter tablet, consistent across the existing application. Domain examples illustrate the system; they do not establish new workflows, permissions, accounting definitions or navigation requirements.

The visual reference is [Gudrix Agency and collaborators' health-platform dashboard](https://www.behance.net/gallery/251598713/Dashboard-UXUI-for-AI-Health-Platform-Website-Branding). Borrow its cool, layered surfaces, dark primary controls, quiet violet analytics, compact panels and restrained typography. Use those principles for stock, sales and products. Medical imagery, clinical labels and large promotional effects do not enter operational screens. Exact token values below are Aquarela proposals, not a claim to the reference's original design files.

## Visual principles

1. Make a busy screen feel quiet. Most pixels are neutral; violet indicates selection or a useful focus. Status colors communicate domain state.
2. Show the decision next to its evidence. A low-stock label sits beside quantity, unit and reorder threshold. A total states its period and currency.
3. One strong action per task region. Save, receive, publish or close; avoid vague “Continue” when the result can be named.
4. Reuse the existing shadcn primitives and product structure. Theme centrally; compose familiar controls; preserve behavior.

## Color contract

| Role | Token | Value | Use |
|---|---|---|---|
| Canvas | background | #F1F3F8 | Page behind panels |
| Surface | card, popover | #FFFFFF | Cards, forms, menus |
| Ink | foreground, primary | #151A2D | Main text; high-emphasis actions |
| Quiet text | muted-foreground | #626B7E | Secondary text on light neutral surfaces |
| Subtle fill | muted | #F8F9FC | Headers, hover rows, nested regions |
| Fine border | border | #E5E8F0 | Decorative panel separation |
| Control border | input | #858DA0 | Interactive input boundaries |
| Iris | brand, ring | #5742BA | Focus, selected labels, chart series |
| Lavender | accent, brand-soft | #EEECFF | Selection backgrounds |
| Positive | success / success-foreground | #E7F4EC / #256442 | In stock, completed, reconciled |
| Attention | warning / warning-foreground | #FFF3D9 / #80550C | Low stock, needs review |
| Error | danger / danger-foreground | #FFEDED / #AC303A | Out of stock, failed |
| Information | info / info-foreground | #EAF1FF / #315FAA | Ordered, informational state |
| Destructive action | destructive / destructive-foreground | #AC303A / #FFFFFF | Explicit irreversible action |

`accent` is an interactive surface, not a strong brand-colored button. `brand` is the saturated violet. `danger` is a soft message surface; `destructive` is a filled destructive action. Pair each surface with its named foreground. Do not put muted text on dark primary buttons. Low-contrast panel borders are decorative; use the stronger input border where the boundary identifies a control.

## Typography

Inter with system-sans fallback. Use the existing font pipeline; self-host approved files. No medical-style italic UI, all-caps navigation, condensed numerals or decorative coffee script.

| Role | Size / line height | Weight | Tracking |
|---|---|---|---|
| Page heading | 32 / 38 px | 500 | -0.03em |
| Section heading | 24 / 32 px | 500 | -0.02em |
| Card title | 16 / 24 px | 500 | 0 |
| Main body / mobile field | 16 / 24 px | 400 | 0 |
| Table / desktop field / control | 14 / 20 px | 400; 500 labels | 0 |
| Supporting label | 12 / 16 px | 400 | 0 |
| KPI | 32 / 38 px | 500 | -0.03em; tabular figures |

The guide's large cover headline is presentation typography, not a dashboard heading. Set base text in rem, retain user zoom, do not reduce meaningful app text below 12 px. Tabular numerals for money, stock and aligned metrics. Names wrap; identifiers may truncate with an accessible full value. Do not truncate quantities, status or error messages.

## Geometry and responsive layout

Spacing scale: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64 px. Use 8 for icon/label and related fields, 16 for controls within a group, 24 for panel padding/gaps, 32 for desktop content gutters. A dense table is useful; a dense form is tiring.

Radii: 6 px small nested surface; 10 px button/input/popover; 16 px card; 24 px dialog; full pill for status. Explicit Tailwind radius mapping is provided because shadcn preset generations derive radii differently. Base `--radius` alone does not guarantee these exact sizes.

Resting panels have 1 px borders and no shadow. Menus use a soft shadow; modal dialogs have stronger elevation. Never glass/blur the data itself. No gradient on tables, forms, or charts. The guide's decorative cup is presentation-only.

Desktop shell proposal: existing Sidebar 224 px expanded / 64 px collapsed, top bar 64 px, main area fluid, sensible content max 1440 px. Keep existing navigation labels and route hierarchy. Only use this shell geometry if compatible with the existing app.

| Width | Behavior |
|---|---|
| ≥1280 px | Expanded navigation; 3–4 metrics; 2-column forms only for related short fields |
| 1024–1279 px | Collapse navigation if required; reduce gutters to 24 px |
| 768–1023 px | Sidebar as Sheet; stack complex panels; preserve readable table cells |
| <768 px | 16 px gutters; one-column forms; full-width Sheet/Dialog as suitable; 44 px touch targets |

Tables may scroll inside a labeled region. Do not horizontally scroll the entire page. Prioritize product, quantity and status; additional data can be disclosed without losing access. Keep key actions visible without covering content or keyboard focus. At 200% zoom, navigation and actions still reflow.

## Component contract

| Primitive | Aquarela treatment | Required states / behavior |
|---|---|---|
| Button | 40 px default, 32 px compact desktop, 48 px large; 10 px radius | Default, hover, pressed, focus, disabled, pending. Use Spinner + text + disabled for pending; preserve width. |
| Input / Textarea | White, 1 px input border, visible label, 40 px minimum | Hover, focus, filled, invalid, disabled, readonly. Preserve text after failed save. |
| Field / FieldGroup | Label above, description then actionable error | `data-invalid` on Field, `aria-invalid` and description IDs on control. Validate on blur/submit; recheck corrected fields. |
| Select / Combobox | Same geometry as input | Use current installed primitive API. Search long product/supplier lists. Group items properly. |
| Checkbox / Switch | Violet selection, visible text | Checkbox participates in submitted form; Switch commits an immediate setting only if app supports that. Pending/error must be communicated. |
| Badge | 12 px, pill, semantic foreground/background | Text required. Never infer paid/refunded/available from color alone. Badge is not a button. |
| Card | 16 px radius, fine border, no default shadow | Full CardHeader/Title/Description/Content/Footer composition; avoid unrelated nested cards. |
| Table / Data Table | 40 px header, 56 px rows, optional 40 px compact rows | Loading, loaded, empty, filtered-empty, failed, stale, selected. Explicit sorting state and result count. |
| Tabs | Underlined active item in iris; stable labels | Arrow/Home/End behavior from primitive; panel association; do not use tabs as cross-route navigation. |
| Sidebar / Breadcrumb | Neutral shell, lavender active surface | Current location conveyed programmatically; collapsed icons need labels/tooltips. |
| DropdownMenu / Popover | White surface, 10 px corners | Keyboard navigation, Escape, focus return; menu items within group; destructive action separated. |
| Dialog / Sheet | White surface, title, clear footer | Focus management and Escape from primitive. Dialog for short tasks; Sheet for contextual detail. Warn on unsaved changes when relevant. |
| AlertDialog | Named object and exact consequence | For final refund, deletion, or day-close actions according to existing business rules. Initial focus on safe action. |
| Alert | Soft semantic surface | Persistent contextual errors; include recovery step and preserve user input. |
| Toast | Brief confirmation | Base UI toast or Radix/Aria Sonner according to project. Never sole source of actionable errors. |
| Empty | Concise title, explanation, one action | Different copy for no data versus filters with no matches. Clear filters for the latter. |
| Skeleton / Spinner | Stable geometry, restrained motion | Announce loading once; no fake data as placeholder. Honor reduced motion. |
| Tooltip | Supplemental only | Keyboard accessible; no essential instructions hidden on hover. |
| Chart | Iris primary series; neutral context | Units, time window, text summary, accessible data table. Stable category colors and non-color cues. |

Hover: subtle surface change over 120 ms. Panel transitions: 180 ms. No bouncing, dramatic scaling or animated KPI count-up. Preserve upstream overlay stacking and accessibility behavior. Avoid adding manual z-index fixes to shadcn overlays.

## Coffee-shop patterns

### Overview and sales

Keep selected shop, period and currency visible near metrics. A proposed default set is net sales, completed orders and average order; use only metrics already defined by the product. Show comparisons only against an explicit comparable period. Never show an unexplained green arrow. Zero is a value; missing data displays an em dash with context. Stale POS data needs last-sync time and a stale label. The demo uses EUR arbitrarily; do not hardcode its currency or illustrative net-sales definition into the app.

### Inventory and receiving

Every quantity has a unit. Display on-hand stock, configured threshold and state together. The demo calls 0 “out”, positive quantity below minimum “low”, and others “in stock”; the real app's domain rules remain authoritative, including reservations and negative-stock policy. A stock adjustment shows old quantity, signed change, resulting quantity, unit and required reason. Receiving can show supplier, delivery identifier and line totals. Never silently convert kg to g or units to cases.

Search, status/category filters, result count and add action form one toolbar. If batch selection exists, show the count and explicitly distinguish this page from all matching results. Preserve filters, sorting and scroll position when returning from detail. For large lists use existing server pagination; sort numeric values numerically, not formatted strings.

### Products and recipes

Group identity, selling price/tax display, availability, ingredients and stock configuration. Reuse current fields. Long product names wrap. A recipe ingredient line carries quantity and unit. Treat allergen information as explicit labels sourced from existing data, never inferred from a category or generated by the UI. Draft and unavailable are separate concepts.

### Closing and sensitive operations

Show expected and counted amounts, difference, currency and period. State who/when in the existing audit history. A destructive or irreversible action names its object and consequence. Disable repeat submission while pending; server idempotency and permission enforcement stay in the application, not the theme. A hidden button alone is not access control.

### Dates, currency and content

Use the app's configured locale and shop timezone, not the operator's browser timezone for business-day boundaries. Format with `Intl.NumberFormat` and `Intl.DateTimeFormat`. Store money and calculate totals through existing domain logic. Never use compact “1.2k” notation for editable amounts. Use sentence case; verbs such as “Save product”, “Receive delivery”, “Adjust stock”. Error: what failed, what remains safe, how to recover.

## Accessibility acceptance

Target WCAG 2.2 AA; these specifications are not a certification. Text pairs target at least 4.5:1 for normal text. Meaningful control boundaries and focus cues target 3:1. Color never carries state alone. Check all foregrounds on their actual surfaces, including chart labels and hover states. The included contrast report covers the specified static pairs only.

Visible focus: 3 px solid iris, 2 px gap, without clipping. If an installed primitive uses an opacity-modified ring, replace it centrally with the solid ring recipe. Keyboard order follows reading order; do not remove native semantics. Minimum touch targets 44 px for the coffee-shop tablet context. Announce save results with a polite live region, errors persist beside fields. Each overlay has a title and restores focus. Test screen reader labels, keyboard-only completion, 200% zoom, long localized strings and reduced motion in the actual application.

[WCAG 2.2 reference](https://www.w3.org/WAI/WCAG22/quickref/).

## Versioning and decisions still open

Confirmed: coffee shop, existing application, shadcn foundation, reference-led aesthetic. Proposed: palette, placeholder flower mark, typography, density and domain examples. Unknown: actual repository, shadcn base/style/version, approved logo, locale/currency, exact modules and dark-mode need. This package intentionally leaves those product decisions open.

Before shipping, align this theme with any approved Aquarela identity, compile against installed dependencies, and review actual screens. Record later token changes with old/new values, reason and affected components. Own core variants centrally; prohibit screen-specific hex overrides.
