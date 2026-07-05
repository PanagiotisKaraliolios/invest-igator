# context-menu

2026-07-06 · TRANSFORMATION-ENGINE (mirror the migrated dropdown-menu template) · **Verdict: migrated to Base UI `@base-ui/react/context-menu`, radix-free, structurally verified.**

## Changed

- `src/components/ui/context-menu.tsx` — rewired `@radix-ui/react-context-menu` → `@base-ui/react/context-menu`.
  - Import: `import * as ContextMenuPrimitive from '@radix-ui/react-context-menu'` → `import { ContextMenu as ContextMenuPrimitive } from '@base-ui/react/context-menu'`.
  - Part renames: `Content` → `Portal > Positioner > Popup`; `SubContent` → its own `Portal > Positioner > Popup`; `Sub` → `SubmenuRoot`; `SubTrigger` → `SubmenuTrigger`; `ItemIndicator` → `CheckboxItemIndicator` / `RadioItemIndicator`; `Label` → plain `<div>` (see below). `Trigger`/`Group`/`Portal`/`RadioGroup`/`Item`/`CheckboxItem`/`RadioItem`/`Separator` keep their names (all exist in the `context-menu` subpath; `Separator` is re-exported from `../separator`).
  - `data-slot` dropped from `ContextMenu` (→ `ContextMenu.Root`) and `ContextMenuSub` (→ `ContextMenu.SubmenuRoot`): `ContextMenuRootProps extends Omit<Menu.Root.Props, …>` (not `BaseUIComponentProps`), so it renders no DOM element and rejects `data-slot`. Mirrors dropdown-menu. `data-slot` kept on every DOM-rendering part (Trigger is `BaseUIComponentProps<'div'>`, etc.).
  - `ContextMenuContent`: exposes `side`/`sideOffset`/`align`/`alignOffset` `Pick`ed from `Positioner.Props`, destructured and **forwarded** to `<Positioner>` (per the "Pick means forward" rule — no defaults injected, so the original no-offset cursor anchoring is preserved). Positioner gets `className='isolate z-50'`; Popup keeps `data-slot='context-menu-content'` and all original classes.
  - `ContextMenuSubContent`: rebuilt as its own `Portal > Positioner > Popup`. Positioner defaults `align='start' alignOffset={-3} side='right' sideOffset={0}` (destructured with defaults, still overridable), `className='isolate z-50'` — matches dropdown-menu's SubContent shape.
  - `ContextMenuLabel`: was `ContextMenuPrimitive.Label` → now a plain `<div>` (Base UI `Menu.GroupLabel` **throws** "MenuGroupContext is missing" outside a `Group`; shadcn uses this as a standalone header). Its original class `text-foreground px-2 py-1.5 text-sm font-medium data-[inset]:pl-8` preserved verbatim (note: keeps `text-foreground`, unlike dropdown-menu's label). Type changed to `React.ComponentProps<'div'>`.
  - Animations: `data-[state=open]:*` → `data-starting-style:*`, `data-[state=closed]:*` → `data-ending-style:*`; entrance slide-ins gated: `data-[side=X]:slide-in-*` → `data-[side=X]:data-starting-style:slide-in-*`. Reuses the `data-starting-style`/`data-ending-style` custom variants already in `globals.css`.
  - CSS vars: `max-h-(--radix-context-menu-content-available-height)` → `max-h-(--available-height)`; `origin-(--radix-context-menu-content-transform-origin)` → `origin-(--transform-origin)` (set on Positioner, inherited by Popup).
  - SubTrigger open styling: `data-[state=open]:bg-accent data-[state=open]:text-accent-foreground` → `data-[popup-open]:…` (Base `SubmenuTrigger` exposes `data-popup-open`). Original `ml-auto` chevron class preserved (dropdown used `ml-auto size-4`; this file kept its own exact class).
  - All other Tailwind preserved exactly, including the item `focus:bg-accent` highlight (Base UI menus move real DOM focus onto the highlighted item, so `:focus` still matches).
  - Leftover scan: `grep -n "radix-ui\|@radix-ui" src/components/ui/context-menu.tsx` → empty.

## Left alone

- Radix deps stay installed until the final sweep; this file no longer imports them.
- **0 consumers** in the app (confirmed) — wrapper-only migration, no call-site changes.
- `src/styles/globals.css` — `data-starting-style` / `data-ending-style` variants already existed (tooltip migration); reused, not re-added.
- `ContextMenuCheckboxItem` / `ContextMenuRadioItem` / `ContextMenuRadioGroup` / `ContextMenuPortal` — migrated for completeness though no consumer uses them.

## Behavior changes (flagged, never patched)

- **`modal` dropped.** Radix `ContextMenu.Root` had `modal` (default `true`); Base UI has no `modal` prop (behavior fixed). Not exposed by the wrapper anyway; if `modal={false}` was ever needed there is no direct equivalent.
- **Trigger `disabled` dropped.** Base `ContextMenu.Trigger` has only `className`/`style`/`render`. Not exposed by the wrapper.
- **CheckboxItem / RadioItem close-on-click default FLIPS** to `false` in Base UI (Radix closed on select). Left at the Base default, not patched.
- **`loopFocus`** defaults to `true` on Base menus (Radix `loop` defaulted `false`). Idiomatic Base default kept.
- **Enter/exit animations** now gated by `data-starting-style`/`data-ending-style` transition hooks rather than `data-[state=open/closed]`; feel/timing may differ subtly.
- **GroupLabel/aria:** `ContextMenuLabel` is now a plain `<div>`, so it no longer wires `aria-labelledby` to a group (Radix `Label` didn't either — it floated freely — so this is parity, not a regression).

## Verify by hand

Component is **UNUSED** in the app — verified structurally only: radix scan clean; every `ContextMenuPrimitive.*` part used exists in `node_modules/@base-ui/react/context-menu/index.parts.d.ts`; parens/braces balanced; no leftover `data-[state=`/`--radix-`/`data-motion` in classNames. No browser check performed (no render surface).
