# Designer Agent Brief — Modern Editorial SaaS UI

## Objective

Update the existing product UI so it feels like a premium, contemporary B2B SaaS product with the visual confidence of a high-end design studio case study.

Do **not** copy any existing product, layout, brand, wording, logo, illustration, or screen composition. Instead, apply the following design language consistently across the current product while preserving its information architecture, features, workflows, and business logic unless a UX improvement is clearly justified.

The target result should feel:

- minimal but not sterile
- editorial and design-led
- highly polished
- data-rich without feeling dense
- calm, spacious, and sophisticated
- modern European / Scandinavian in restraint
- slightly experimental in composition, but still extremely usable
- clearly a professional SaaS application rather than a generic admin template

---

# 1. Core Visual Direction

Use a **soft, airy canvas** with large areas of off-white, warm white, mist grey, or very pale tinted backgrounds.

Avoid the typical SaaS look of:
- strong blue primary buttons everywhere
- heavy card shadows
- thick borders
- excessive rounded rectangles
- Bootstrap-like spacing
- dense admin-dashboard grids
- overly colorful charts

The interface should instead use:

- generous negative space
- thin, subtle separators
- soft tonal surfaces
- selective use of accent color
- large typography where hierarchy benefits from it
- compact typography for supporting metadata
- asymmetric but balanced compositions
- large feature panels mixed with smaller metric modules
- visual rhythm rather than repetitive card grids

Think of the screen as an editorial composition made from functional UI.

---

# 2. Design Personality

The design should communicate:

**Precision + Calm + Intelligence + Premium Utility**

It should feel appropriate for software used throughout the working day.

The interface should not feel playful, childish, overly futuristic, cyberpunk, glassmorphic, or corporate-enterprise-heavy.

Aim for understated sophistication.

---

# 3. Color System

## Base palette

Use mostly neutral surfaces.

Suggested starting tokens:

```css
--bg: #F5F6F4;
--surface: #FAFAF8;
--surface-strong: #FFFFFF;
--surface-muted: #ECEFEC;

--text-primary: #171918;
--text-secondary: #656A67;
--text-tertiary: #929793;

--border: rgba(20, 25, 22, 0.08);
--border-strong: rgba(20, 25, 22, 0.14);
```

These are directional, not mandatory exact values.

## Accent strategy

Use **one distinctive accent family**, supported by at most one secondary accent.

Good directions:

- acid/lime yellow
- soft chartreuse
- desaturated sky blue
- muted olive
- warm amber
- pale cyan

For example:

```css
--accent: #DFFF55;
--accent-soft: #F0F8C9;
--secondary-accent: #A8CBE4;
```

The accent should be used sparingly for:

- primary action
- selected navigation state
- key chart series
- important KPI emphasis
- status highlight
- active filters
- current timeline position
- tiny badges or data markers

Do not flood the entire interface with the accent.

## Semantic colors

Success, warning, error, and informational states should be muted rather than saturated.

Use colored tints or small indicators instead of large blocks of red/green.

---

# 4. Typography

Use a modern geometric/humanist sans-serif with a slightly distinctive personality.

Preferred characteristics:

- rounded geometry without looking childish
- clean numeric forms
- excellent small-size legibility
- expressive large headings
- several usable weights

Suitable directions include fonts similar in character to:

- Urbanist
- Outfit
- Manrope
- Geist
- Plus Jakarta Sans
- DM Sans

Do not mix several display fonts.

## Recommended hierarchy

```text
Display / page statement:
40–56px
400–500 weight
tight line-height

Page title:
28–36px
450–550 weight

Section title:
20–24px
500 weight

Card / module title:
14–17px
500–600 weight

Body:
14–16px
400 weight

Metadata / labels:
11–13px
400–500 weight

Large KPI:
32–52px
300–500 weight
```

Large numerical values can use lighter weights than labels.

Avoid excessive bold text.

Hierarchy should come mainly from:
- size
- position
- spacing
- contrast

rather than bold weight.

---

# 5. Layout System

Use a desktop-first responsive application frame with a strong underlying grid.

Recommended:

```text
Desktop max working width: 1440–1600px
Main page padding: 24–40px
Grid: 12 columns
Base spacing unit: 4px
Common spacing steps: 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64
```

Screens should not look like a uniform set of equally sized cards.

Mix:

- one large dominant module
- several compact metrics
- one or two wider analytical panels
- tables/lists integrated into the composition
- contextual side panels where appropriate

Prefer **intentional visual hierarchy** over symmetrical dashboard tiling.

---

# 6. Navigation

## Desktop

Prefer a slim sidebar, compact rail, or understated top navigation.

The navigation should:

- consume minimal visual attention
- use icon + label only where useful
- clearly indicate current location
- keep secondary actions quiet
- avoid large dark sidebar blocks unless the product specifically benefits from them

Selected navigation can use:

- tinted background
- thin indicator
- accent dot
- slightly stronger text

Do not use a huge filled primary-color navigation state.

## Mobile

Use a compact bottom navigation for the most important 3–5 sections.

The bottom navigation may sit inside a softly rounded floating container, but keep it restrained.

---

# 7. Cards and Surfaces

Not every piece of information requires a card.

Use cards when grouping genuinely related information.

Recommended card styling:

```css
border-radius: 16px to 24px;
border: 1px solid subtle neutral;
box-shadow: none or extremely soft;
background: slightly differentiated from page canvas;
```

Some feature panels can use larger radii.

Avoid:
- exaggerated shadows
- glowing effects
- glass blur everywhere
- nested cards inside cards inside cards
- thick outlined boxes

Use whitespace and tonal contrast before adding borders.

---

# 8. Dashboard Composition

A strong dashboard should have a clear focal point.

Possible structure:

```text
Header / context / filters

┌──────────────────── large focal module ────────────────────┐
│ operational context, active workflow, main visualization   │
└──────────────────────────────────────────────────────────────┘

┌──────── KPI ───────┐ ┌──────── KPI ───────┐ ┌──── KPI ────┐
│                    │ │                    │ │              │
└────────────────────┘ └────────────────────┘ └──────────────┘

┌──────────── analytical panel ─────────────┐ ┌── compact ──┐
│                                           │ │   insight    │
└───────────────────────────────────────────┘ └──────────────┘

┌──────────────── table / activity / workflow ────────────────┐
└──────────────────────────────────────────────────────────────┘
```

Do not automatically convert every number into a separate card.

Related KPIs can live together in a single analytical module.

---

# 9. KPI Design

Metrics should feel elegant and information-rich.

Each KPI may include:

- small descriptive label
- large value
- compact percentage/status chip
- micro-chart or sparkline
- subtle comparison period
- optional tiny trend arrow

Example:

```text
Total revenue                      +8.4%
128,430

────╮
    ╰────────
vs previous month
```

Charts and annotations should remain visually secondary to the number.

---

# 10. Charts and Data Visualization

Charts should look custom-designed, not like a default charting-library theme.

Use:

- thin strokes
- generous whitespace
- subtle grid lines
- sparse axis labeling
- direct labeling where possible
- pale neutral comparison series
- one strong accent series
- rounded bar ends where appropriate
- small highlights for anomalies / active values

Avoid:
- rainbow palettes
- 3D charts
- heavy legends
- thick axes
- too many grid lines
- saturated categorical colors

Use donut/circular visualizations only when they communicate a meaningful proportion.

Large circular diagrams can be effective as a focal visualization when paired with a prominent metric.

---

# 11. Tables and Lists

Tables should feel lightweight.

Use:

- generous row height
- minimal vertical borders
- soft horizontal separators
- quiet column labels
- compact status pills
- hover states with tonal background
- sticky headers for long data sets

Prefer progressive disclosure for secondary data.

On smaller screens, convert dense tables into structured rows or cards instead of horizontally scrolling giant desktop tables whenever practical.

---

# 12. Controls

## Buttons

Primary buttons:

- compact
- clearly differentiated
- not oversized
- solid dark neutral or accent
- medium radius or pill where appropriate

Secondary actions:

- text
- subtle outlined
- tonal surface

Avoid dozens of visually identical buttons.

## Inputs

Inputs should be clean and quiet:

- soft surface
- thin border or borderless tonal field
- strong focus state
- clear label
- useful helper/error text

Do not rely on placeholder text as the only label.

## Filters

Prefer compact:

- chips
- segmented controls
- small dropdowns
- search
- date-range selectors

Active filters can use the accent color.

---

# 13. Status and Badges

Use small pills/chips for:

- status
- category
- trend
- priority
- availability
- state

Keep them visually light.

Example:

```text
● Active
↗ 8.4%
Pending
High priority
```

Pills should not become decorative clutter.

---

# 14. Imagery

When the product includes people, properties, products, customers, or other physical entities, use imagery selectively as a functional part of the interface.

Good applications:

- featured record
- customer profile
- property preview
- active call / communication panel
- onboarding or empty state

Use:

- strong crop
- large radius
- subtle overlays
- compact metadata over or adjacent to imagery

Do not turn the app into a marketing landing page.

---

# 15. Large Feature Modules

Important live workflows should sometimes become a visually dominant panel instead of another small card.

Examples:

- current project
- active conversation
- active call
- currently selected property
- current sales opportunity
- operational alert
- active task
- current production run

These panels can combine:

- image/avatar
- title and metadata
- timeline
- controls
- progress
- status
- relevant KPIs

This creates a useful visual anchor on the page.

---

# 16. Information Density

Aim for **high information value with low perceived density**.

Achieve this by:

- grouping related values
- using whitespace strategically
- removing unnecessary labels
- using subtle dividers
- using typography hierarchy
- hiding secondary controls until relevant
- using expandable detail
- keeping important values visually dominant

Do not solve complexity by simply increasing card count.

---

# 17. Mobile UI

The mobile version should feel intentionally designed rather than a compressed desktop layout.

Prioritize:

- one primary information story per viewport
- vertically stacked analytical modules
- edge-to-edge content where beneficial
- generous breathing room
- thumb-friendly controls
- persistent bottom navigation for core actions
- compact contextual actions at the top

Large values and visualizations can occupy significant vertical space.

Use horizontal carousels sparingly.

---

# 18. Responsive Behaviour

Design at minimum for:

```text
Mobile: 375–430px
Tablet: 768–1024px
Desktop: 1280–1600px
Large desktop: 1600px+
```

Responsive design should change composition, not merely shrink dimensions.

Examples:

- 4 KPI modules → 2×2 → stacked
- sidebar → icon rail → bottom navigation
- multi-column analysis → single column
- table → responsive structured rows
- large live panel → vertically reorganized workflow

---

# 19. Micro-interactions

Interaction should feel polished but restrained.

Use:

- 120–220 ms transitions
- soft opacity fades
- small positional movement
- gentle chart transitions
- subtle button press feedback
- animated selected-state changes
- skeleton loading for data modules

Avoid:
- bouncing
- flashy spring animation everywhere
- dramatic zooming
- excessive parallax
- animated decoration unrelated to task completion

---

# 20. Iconography

Use one consistent thin/medium-weight icon family.

Icons should be:

- simple
- geometric
- recognizable
- mostly 16–20px in UI
- visually secondary to text

Avoid mixing filled, outline, 3D, emoji, and illustrated icon styles.

---

# 21. Content Style

UI copy should be concise and functional.

Prefer:

```text
Revenue
Occupancy
Open tasks
Average response time
View details
Review activity
Add property
Create report
```

Avoid verbose headings and marketing copy inside operational views.

Numbers should use formatting appropriate to the locale and domain.

---

# 22. Visual Details to Emulate

The overall design should use these recurring visual ideas:

1. **Very light neutral application backgrounds**
2. **Minimal borders and almost no shadows**
3. **Large rounded modules**
4. **Large, elegant numeric typography**
5. **Tiny supporting labels**
6. **One vivid yellow/lime accent used selectively**
7. **Occasional pale blue/green secondary surfaces**
8. **Editorial spacing**
9. **Asymmetrical dashboard composition**
10. **Circular / radial analytical graphics where meaningful**
11. **Small sparklines and microcharts**
12. **Large functional focal panels**
13. **Thin modern navigation**
14. **Calm typography with regular/medium weights**
15. **Softly rounded floating mobile navigation**
16. **Data visualizations integrated into layout rather than boxed off**
17. **Minimalist status chips**
18. **Strong balance between white space and information**
19. **Subtle colored background zones instead of decorative gradients**
20. **UI that feels art-directed rather than generated from a component library**

---

# 23. What NOT to Do

Do not make the redesign look like:

- generic Tailwind dashboard template
- generic Material UI admin panel
- Bootstrap admin theme
- dark developer dashboard
- crypto dashboard
- neon AI application
- overly glassmorphic UI
- Apple clone
- excessively rounded “bubble UI”
- marketing page disguised as an application

Specifically avoid:

- gradients everywhere
- purple-to-blue AI gradients
- huge drop shadows
- 12 different accent colors
- excessive icon use
- excessive cards
- unnecessarily thick typography
- huge CTAs inside operational software
- decorative UI that reduces data clarity

---

# 24. Design-System Requirements

Before updating individual pages, define reusable tokens.

Create:

```text
Color tokens
Typography scale
Spacing scale
Radius scale
Border tokens
Elevation tokens
Icon sizes
Container widths
Grid definitions
Breakpoints
Animation timing
```

Then create / normalize reusable components:

```text
AppShell
Sidebar / NavigationRail
TopBar
PageHeader
SectionHeader

Button
IconButton
Input
Search
Select
DatePicker
SegmentedControl
FilterChip

Card
MetricCard
FeaturePanel
DataPanel
InsightPanel

Table
List
StatusChip
Avatar
Badge
Tooltip

Sparkline
LineChart
BarChart
DonutChart
RadialMetric

Modal
Drawer
Popover
Toast
EmptyState
Skeleton
```

Do not create one-off styles if an existing system component can be generalized.

---

# 25. Implementation Process

Follow this sequence.

## Step 1 — Audit

Inspect the existing application and identify:

- existing screens
- component library
- duplicated components
- current spacing
- current typography
- existing colors
- inconsistent patterns
- information hierarchy problems
- responsive problems

Do not modify business logic during the visual audit.

## Step 2 — Establish design tokens

Create the new visual foundation first.

## Step 3 — Update application shell

Redesign:

- page background
- navigation
- page container
- headers
- global spacing

## Step 4 — Redesign core components

Update shared components before individual screens.

## Step 5 — Redesign one representative screen

Choose the most information-rich dashboard screen and use it as the design-system validation screen.

It should demonstrate:

- layout
- navigation
- KPI styling
- charts
- table/list
- filters
- primary actions
- responsive behavior

## Step 6 — Apply systematically

Once the representative screen is coherent, propagate the system across all product views.

## Step 7 — Polish

Review:

- alignment
- whitespace
- text wrapping
- number formatting
- icon consistency
- focus states
- empty/loading/error states
- mobile layout
- tablet layout
- accessibility

---

# 26. UX Guardrails

Aesthetic changes must not reduce usability.

Maintain or improve:

- WCAG contrast
- keyboard navigation
- visible focus states
- accessible field labels
- touch target size
- screen-reader semantics
- meaningful table structure
- chart alternatives where necessary

Never hide essential functionality solely to make the layout cleaner.

---

# 27. Agent Decision Rules

When redesigning a screen, use this priority order:

```text
1. User task
2. Information hierarchy
3. Clarity
4. Interaction efficiency
5. Responsive behavior
6. Visual consistency
7. Visual novelty
```

If a visually impressive solution makes a common task harder, reject it.

If a component can be simplified without losing important information, simplify it.

If multiple related cards can be combined into a more meaningful analytical module, combine them.

If a screen feels visually monotonous, improve hierarchy through scale, grouping, spacing, and composition before introducing more colors.

---

# 28. Desired Final Impression

When complete, the application should look like a custom-designed digital product created by a strong product-design studio.

It should feel:

**quiet at first glance, rich on inspection, fast to understand, pleasant to use, and highly deliberate.**

The redesign should preserve the product's unique identity rather than becoming a literal reproduction of another interface.
