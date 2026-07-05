# navigation-menu

2026-07-06 · TRANSFORMATION-ENGINE (heavy restructure) · **Verdict: migrated to Base UI `@base-ui/react/navigation-menu`, radix-free, structurally verified — with two flagged part-role mismatches (Indicator, Content animation model).**

## Changed

- `src/components/ui/navigation-menu.tsx` — rewired `@radix-ui/react-navigation-menu` → `@base-ui/react/navigation-menu`.
  - Import: `import * as NavigationMenuPrimitive from '@radix-ui/react-navigation-menu'` → `import { NavigationMenu as NavigationMenuPrimitive } from '@base-ui/react/navigation-menu'`.
  - `NavigationMenu` (Root): **dropped the `viewport` boolean prop** and the `data-viewport` attribute. Root no longer conditionally renders the Viewport inline; it now **always** renders `<NavigationMenuViewport />` (Base UI's shared anchored popup). Root/List/Item classes preserved.
  - `NavigationMenuViewport`: Radix's single `<div><Viewport/></div>` → Base UI's `Portal > Positioner > Popup > Viewport`. The **Popup** is the visible box and carries the original Viewport styling (`bg-popover`, border, shadow, size, animation) + `data-slot='navigation-menu-viewport'` + the `className` override; the Base `Viewport` is rendered inside it as the inner clip that holds the active `Content` (receives `{...props}`). Positioner gets `className='isolate z-50'`.
  - CSS vars: `h-[var(--radix-navigation-menu-viewport-height)]` → `h-[var(--popup-height)]`, `md:w-[var(--radix-navigation-menu-viewport-width)]` → `md:w-[var(--popup-width)]`. Verified these are the vars Base UI sets **on the Popup** (`NavigationMenuPopupCssVars`: `--popup-width`/`--popup-height`); they inherit to the Viewport child.
  - `navigationMenuTriggerStyle` (cva) + `NavigationMenuTrigger` chevron: `data-[state=open]:` → `data-[popup-open]:` (4× in cva), `group-data-[state=open]:rotate-180` → `group-data-[popup-open]:rotate-180`. Trigger keeps its plain `<ChevronDownIcon>` (Base's `Icon` part not used — the manual chevron rotates via `group-data-[popup-open]`).
  - `NavigationMenuContent`: animation model rewritten. Radix `data-[motion^=from-]/[motion^=to-]` (enter/exit) → `data-starting-style:`/`data-ending-style:`; directional `data-[motion=from-end]:slide-in-from-right-52` etc. → `data-[activation-direction=right]:data-starting-style:slide-in-from-right-52` (and left / ending-style variants). Confirmed `NavigationMenuContentDataAttributes` exposes `data-open`/`data-closed`/`data-starting-style`/`data-ending-style`/`data-activation-direction`. **Removed the entire `group-data-[viewport=false]/navigation-menu:*` class block** — it drove Radix's inline (non-viewport) render mode, which no longer exists now that `viewport` is dropped and everything uses the Positioner/Popup/Viewport model.
  - `NavigationMenuLink`: `data-[active=true]:` → `data-[active]:` (Base UI `Link` sets a valueless `data-active` presence attribute; the presence-selector matches). `active`/`render` supported; `onSelect` has no equivalent (`closeOnClick` on Base, default `false`).
  - `NavigationMenuIndicator`: `Indicator` has **no Base UI equivalent** (see Behavior changes) — remapped to the closest analogue `NavigationMenuPrimitive.Arrow` (a popup-anchored pointer), inner rotated-square `<div>` preserved. `data-[state=visible]:`/`data-[state=hidden]:` → `data-starting-style:`/`data-ending-style:`.
  - The `{children}{' '}` spacing in the Trigger is kept exactly as the original.
  - Leftover scan: `grep -n "radix-ui\|@radix-ui" src/components/ui/navigation-menu.tsx` → empty. (One `data-[state=` string remains **inside a code comment** on the Indicator, documenting the delta — not a live class.)

## Left alone

- Radix deps stay installed until the final sweep; this file no longer imports them.
- **0 consumers** in the app (confirmed) — wrapper-only migration, no call-site changes.
- `src/styles/globals.css` — `data-starting-style`/`data-ending-style` variants already present; reused.
- Did not add Base-only parts (`Backdrop`, `Icon`, real `Arrow` inside a consumer `Popup`) — no consumers to wire them to.

## Behavior changes (flagged, never patched)

- **`NavigationMenuIndicator` role mismatch.** Radix `Indicator` tracked the active trigger under the `List`; Base UI has **no list-tracking part**. Remapped to `Arrow`, which is the closest *visual* analogue but is a **popup-anchored** pointer that must be rendered **inside a `Popup`** — it will not behave as the old list-following indicator. Left as a best-effort remap + flag rather than guessing a non-existent part. If this component is ever used, revisit.
- **`viewport` prop removed / no inline mode.** Content now always renders through the shared anchored Popup/Viewport. The removed `group-data-[viewport=false]` styling (bordered inline dropdown under each trigger) is gone; Base UI's single shared popup replaces it. This is the intended Base UI model, not a bug.
- **Content animation semantics differ.** Radix `data-motion` = from/to (enter/exit) direction; Base `data-activation-direction` = spatial direction (left/right) the *newly-activated* trigger sits relative to the previous one. The rewrite pairs `activation-direction` with `starting/ending-style`; the resulting slide feel is an approximation, not a 1:1 reproduction.
- **Hover open/close delay changes.** Base `Root` `delay` defaults `50` (Radix `delayDuration` `200`); `skipDelayDuration` (Radix `300`) is **dropped** (Base has `closeDelay` `50` instead). Not exposed by the wrapper; idiomatic Base defaults kept. Menus will open/close noticeably faster.
- **`data-[active]` matching.** Radix set `data-active` with an explicit `true` value; Base sets it valueless. Rewrote `data-[active=true]:` → `data-[active]:` so styling still applies.
- **Trigger chevron** rotates on `data-popup-open` instead of `data-state=open`.

## Verify by hand

Component is **UNUSED** in the app — verified structurally only: radix scan clean; every `NavigationMenuPrimitive.*` part used (`Root, List, Item, Trigger, Content, Portal, Positioner, Popup, Viewport, Link, Arrow`) exists in `node_modules/@base-ui/react/navigation-menu/index.parts.d.ts`; parens/braces balanced; no leftover `data-[state=`/`--radix-`/`data-motion`/`data-viewport` in classNames (only in a documenting comment). No browser check performed (no render surface). **If ever adopted, the Indicator→Arrow remap and the Content activation-direction animations need a real browser pass.**
