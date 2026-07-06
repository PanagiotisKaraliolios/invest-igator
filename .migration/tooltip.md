# tooltip

2026-07-05 · strategy: transformation engine (legacy `new-york` style has no `base-new-york` golden pair) · **verdict: migrated, green (typecheck + biome + next build all pass).**

## Changed

- `src/components/ui/tooltip.tsx` — rewired `@radix-ui/react-tooltip` → `@base-ui/react/tooltip`.
  - Import: `import * as TooltipPrimitive from '@radix-ui/react-tooltip'` → `import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'`.
  - Provider: `delayDuration` → `delay`. Removed meaningless `data-slot` from Provider/Root (Base UI renders no DOM there); kept `data-slot` on Trigger/Popup.
  - Structure: `Portal > Content` → `Portal > Positioner > Popup`. `side`/`sideOffset`/`align`/`alignOffset` are `Pick`ed from `Positioner.Props`, destructured, and **forwarded** to `<Positioner>` (per the "Pick means forward" rule); `sideOffset` default 0 → 4.
  - Classes: `origin-(--radix-tooltip-content-transform-origin)` → `origin-(--transform-origin)`; enter/exit animations moved off `data-[state=*]` onto `data-starting-style:*` / `data-ending-style:*`; arrow given Base UI per-side positioning (colors kept: `bg-foreground fill-foreground`).
  - Leftover scan: `grep -n "radix-ui\|@radix-ui" tooltip.tsx` → clean.
- `src/styles/globals.css` — registered two Base UI variants (reused by all migrated components):
  `@custom-variant data-starting-style (&[data-starting-style])` and `data-ending-style`.
- Consumers (`asChild` → `render`, 5 triggers across 4 files):
  - `src/app/(dashboard)/account/_components/enabled-two-factor-section.tsx` (1)
  - `src/app/(dashboard)/account/_components/pending-two-factor-section.tsx` (2)
  - `src/app/(dashboard)/admin/_components/user-management-columns.tsx` (1)
  - `src/components/ui/sidebar.tsx` (1 trigger `render={button}`; `TooltipProvider delayDuration={0}` → `delay={0}`)
- `package.json` / `bun.lock` — removed `@radix-ui/react-tooltip` (no remaining importers repo-wide).

## Left alone

- `src/components/ui/sidebar.tsx`'s own `Slot`/`asChild` composition (SidebarMenuButton et al., lines ~370–521) — that is sidebar's own Radix `Slot` usage, unrelated to tooltip; sidebar is not in this slice and stays on Radix for now.

## Behavior changes

- **Enter/exit animation**: keyframe utilities are now gated by Base UI's `data-starting-style`/`data-ending-style` (transition hooks) instead of Radix's `data-[state=open/closed]`. Compiles and animates, but the exact feel/timing may differ subtly from before.
- **Arrow placement**: rewritten to Base UI's per-side positioner model. Compile-safe; pixel placement must be eyeballed on all four sides.
- **`sideOffset` default** changed 0 → 4 (golden default), so tooltips sit slightly further from their trigger.

## Verify by hand

1. Account → 2FA: hover the "copy setup key" / "copy recovery codes" buttons — tooltip shows correct text, arrow points at the button.
2. Admin → users: hover the banned-user info icon — tooltip shows the ban reason.
3. Collapse the sidebar, hover menu items — tooltip appears on the `right` with no delay.
4. Check the arrow renders correctly on top/bottom/left/right, and the fade/zoom in-out feels right.
