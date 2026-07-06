# Project migration: Radix UI → Base UI

2026-07-06 · whole-project migration (progressive, strangler-fig) · **complete**.

Style: legacy `new-york` (no `base-new-york` golden pair), so every component was
transformed in place via the transformation engine, preserving its exact Tailwind
classes. Target: `@base-ui/react@1.6.0`.

## Result

- **All 30 Radix wrappers migrated** off `@radix-ui/react-*`. `grep -rn "@radix-ui" src` → empty.
- **All 24 `@radix-ui/react-*` packages removed** from `package.json`; `bun install` synced the lock (23 removed). Only transitive `@radix-ui/{number,primitive}` remain (pulled by cmdk/vaul — not imported by app code).
- Verified at every batch: `tsc --noEmit` (0 errors), `biome check` (clean), `next build` (exit 0). Final full build green with all Radix deps gone.

## Migrated (30)

- **Trial (pre-existing):** tooltip, dropdown-menu, dialog.
- **Foundational:** button (→ `@base-ui/react/button`, 25 `asChild`→`render` call sites), label (→ native `<label>`).
- **Slot → useRender:** badge, breadcrumb, button-group, item, sidebar (5 parts + 2 call sites), form (FormControl).
- **Form controls / display:** separator, switch, avatar, aspect-ratio (→ CSS), progress, toggle, tabs, collapsible, checkbox, radio-group, toggle-group, slider, scroll-area.
- **Overlays / menus:** popover, hover-card (→ PreviewCard), accordion, alert-dialog, sheet (→ `@base-ui/react/dialog`, freed `@radix-ui/react-dialog`), context-menu, menubar, navigation-menu, select.

## App-code sweep (consumer changes)

- `asChild` → `render`: 25 `<Button>`, 6 `PopoverTrigger` (+ date-range-picker), sidebar (nav-projects, nav-main), collapsible (nav-main).
- Prop model changes: checkbox `indeterminate` split (columns), toggle-group `type`→`multiple`+array values (returns), accordion `type/collapsible` dropped (faq), select `onValueChange` value→`unknown` (4 casts) + `items={{value:label}}` maps on ~9 label≠value selects.
- Runtime fix: theme Switch kept controlled (Base UI rejects `undefined`→value) — caught via manual QA.

## Left untouched (intentional, third-party — not Radix)

command (cmdk), drawer (vaul), sonner, input-otp, calendar & date-range-picker
(react-day-picker), carousel (embla), chart (recharts), resizable
(react-resizable-panels). Pure-styled components (card, input, table, …) never used a primitive.

## Behavior deltas flagged (per-component reports)

- **tabs**: Base UI defaults to MANUAL activation (Radix was automatic) — not auto-patched.
- **select**: `Select.Value` shows the raw value unless `items` is provided — items maps added; **highest-risk visual delta, eyeball every dropdown**.
- **accordion**: panel animates via `--accordion-panel-height` height transition (not the radix keyframe).
- **navigation-menu** (unused): `Indicator`→`Arrow` is a role approximation; needs a browser pass if ever adopted.
- Animation feel (starting/ending-style transitions), menu close-on-click defaults, tooltip/popover positioning — need a browser eyeball; the build/e2e gate does not catch them.

## Manual QA still owed

The build gate cannot catch Base UI runtime-context errors or visual/animation
deltas. Click-through owed for: dialogs (focus return), menus (dropdown/nav-user/admin),
tooltips, popovers/date-pickers, selects (label rendering!), sidebar (collapse + mobile
sheet), accordion (FAQ), tabs, theme switch. See each `.migration/<component>.md` "Verify by hand".
