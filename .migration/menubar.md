# menubar

2026-07-06 · TRANSFORMATION-ENGINE (root from `@base-ui/react/menubar`, everything else delegates to `@base-ui/react/menu`) · **Verdict: migrated to Base UI, radix-free, structurally verified.**

## Changed

- `src/components/ui/menubar.tsx` — rewired `@radix-ui/react-menubar` → Base UI.
  - Imports: `import * as MenubarPrimitive from '@radix-ui/react-menubar'` → **two** imports: `import { Menubar as MenubarPrimitive } from '@base-ui/react/menubar'` (root container only, callable single-part) **and** `import { Menu as MenuPrimitive } from '@base-ui/react/menu'` (every menu-level part). Base UI's menubar module exports only `<Menubar>`; all menus inside it are built from the `Menu.*` family.
  - `Menubar` (root): `<MenubarPrimitive.Root>` → `<MenubarPrimitive …>` (callable, no `.Root`). `Menubar` is `BaseUIComponentProps<'div'>`, so `data-slot='menubar'` and the container classes are kept verbatim. Type → `React.ComponentProps<typeof MenubarPrimitive>`.
  - `MenubarMenu`: radix `Menubar.Menu` → `Menu.Root`. `data-slot` dropped (`MenuRootProps` is not `BaseUIComponentProps` — renders no DOM element). Hover-switching between menubar menus is built into Base UI's `Menubar` + `Menu.Root` composition.
  - `MenubarSub` → `Menu.SubmenuRoot` (`data-slot` dropped, mirrors dropdown-menu).
  - `MenubarContent`: `MenubarPortal > Content` → `Menu.Portal > Menu.Positioner > Menu.Popup`. `align`/`alignOffset`/`side`/`sideOffset` `Pick`ed from `Positioner.Props`, destructured and **forwarded**; original defaults preserved (`align='start' alignOffset={-4} sideOffset={8}`), `side` added to the Pick set for completeness. Positioner `className='isolate z-50'`; Popup keeps `data-slot='menubar-content'`.
  - `MenubarSubContent`: rebuilt as `Menu.Portal > Menu.Positioner > Menu.Popup`, Positioner defaults `align='start' alignOffset={-3} side='right' sideOffset={0}` (matches dropdown-menu SubContent).
  - `MenubarLabel`: `MenubarPrimitive.Label` → plain `<div>` (Base `Menu.GroupLabel` throws outside a `Group`; used as a standalone header). Original class `px-2 py-1.5 text-sm font-medium data-[inset]:pl-8` preserved. Type → `React.ComponentProps<'div'>`.
  - Other renames: `ItemIndicator` → `CheckboxItemIndicator`/`RadioItemIndicator`; `SubTrigger` → `SubmenuTrigger`. `Trigger`/`Group`/`Portal`/`RadioGroup`/`Item`/`CheckboxItem`/`RadioItem`/`Separator` → same names on `Menu.*` (`Menu.Separator` is re-exported from `../separator`).
  - Animations: `data-[state=open]:*`→`data-starting-style:*`, `data-[state=closed]:*`→`data-ending-style:*`, slide-ins gated on `data-starting-style`. **Preserved the pre-existing shadcn quirk** in `MenubarContent`: the original was missing `data-[state=closed]:animate-out`, so the rewritten Popup is likewise missing `data-ending-style:animate-out` (not silently "fixed"). `MenubarSubContent` has the full set.
  - CSS vars: `origin-(--radix-menubar-content-transform-origin)` → `origin-(--transform-origin)` (Content + SubContent).
  - Trigger + SubTrigger open styling: `data-[state=open]:` → `data-[popup-open]:`. SubTrigger keeps its original `outline-none` (not `outline-hidden`) and `h-4 w-4` chevron exactly.
  - Leftover scan: `grep -n "radix-ui\|@radix-ui" src/components/ui/menubar.tsx` → empty.

## Left alone

- Radix deps stay installed until the final sweep; this file no longer imports them.
- **0 consumers** in the app (confirmed) — wrapper-only migration, no call-site changes.
- `src/styles/globals.css` — `data-starting-style`/`data-ending-style` variants already present; reused.
- Whole checkbox/radio/group/portal/sub family migrated for completeness though unused.

## Behavior changes (flagged, never patched)

- **Menubar value system dropped.** Radix `Menubar` `value`/`defaultValue`/`onValueChange` have no Base UI equivalent (Base has no controlled active-menu value); control each `Menu.Root`'s `open`/`defaultOpen`/`onOpenChange` instead. Not exposed by the wrappers.
- **`loop` → `loopFocus`, default flips `false` → `true`** on the Menubar root and menus. Idiomatic Base default kept.
- **CheckboxItem / RadioItem close-on-click default FLIPS** to `false` (Radix closed on select). Not patched.
- **Trigger open marker** `data-state="open"` → `data-popup-open`; no `data-highlighted` on Base triggers.
- **Enter/exit animations** now transition-based (`data-starting-style`/`data-ending-style`); feel/timing may differ subtly. `MenubarContent`'s missing exit `animate-out` (inherited quirk) means its close animation is fade/zoom only.

## Verify by hand

Component is **UNUSED** in the app — verified structurally only: radix scan clean; every `MenubarPrimitive`/`MenuPrimitive.*` part used exists (`node_modules/@base-ui/react/menubar/index.d.ts` exports `Menubar`; menu parts in `@base-ui/react/menu/index.parts.d.ts`); parens/braces balanced; no leftover `data-[state=`/`--radix-` in classNames. No browser check performed (no render surface).
