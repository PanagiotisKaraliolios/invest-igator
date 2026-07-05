# dropdown-menu

2026-07-06 · strategy: transformation engine (legacy `new-york` style has no `base-new-york` golden pair) · **verdict: migrated, green (typecheck 0 errors + biome "No fixes applied" + next build prints the full route table).**

## Changed

- `src/components/ui/dropdown-menu.tsx` — rewired `@radix-ui/react-dropdown-menu` → `@base-ui/react/menu`.
  - Import: `import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'` → `import { Menu as MenuPrimitive } from '@base-ui/react/menu'`.
  - Part renames: `Content` → `Portal > Positioner > Popup`; `Label` → `GroupLabel`; `ItemIndicator` → `CheckboxItemIndicator` / `RadioItemIndicator`; `Sub` → `SubmenuRoot`; `SubTrigger` → `SubmenuTrigger`; `SubContent` → its own `Portal > Positioner > Popup`. `Group`/`RadioGroup`/`Separator`/`Item`/`CheckboxItem`/`RadioItem`/`Trigger`/`Portal` keep their names (all exist in the `Menu` namespace; `Separator` is re-exported by the menu subpath).
  - `data-slot` dropped from `DropdownMenu` (→ `Menu.Root`) and `DropdownMenuSub` (→ `Menu.SubmenuRoot`): both render no DOM (`MenuRootProps` / `MenuSubmenuRootProps` are not `BaseUIComponentProps`, so they reject `data-slot`). This mirrors the tooltip migration dropping `data-slot` from Provider/Root. `data-slot` KEPT everywhere else, including `Portal` (`FloatingPortal.Props extends BaseUIComponentProps<'div'>`).
  - Content: `side`/`sideOffset`/`align`/`alignOffset` are `Pick`ed from `Positioner.Props`, destructured, and **forwarded** to `<Positioner>` (per the "Pick means forward" rule). `sideOffset` default `4` preserved. Positioner gets `className='isolate z-50'` (new part, mirrors tooltip); Popup keeps `data-slot='dropdown-menu-content'` and all original classes.
  - SubContent: rebuilt as its own `Portal > Positioner > Popup` (dropdown's SubContent duplicates the full content class list per wrapper-shapes.md, rather than composing Content). Positioner defaults `align='start' alignOffset={-3} side='right' sideOffset={0}` (destructured with defaults, so still overridable), `className='isolate z-50'`.
  - Animations: `data-[state=open]:*` → `data-starting-style:*`, `data-[state=closed]:*` → `data-ending-style:*`; entrance slide-ins gated on entrance: `data-[side=X]:slide-in-*` → `data-[side=X]:data-starting-style:slide-in-*` (same shape the tooltip migration used). Reuses the `data-starting-style`/`data-ending-style` custom variants already in `globals.css`.
  - CSS vars: `max-h-(--radix-dropdown-menu-content-available-height)` → `max-h-(--available-height)`; `origin-(--radix-dropdown-menu-content-transform-origin)` → `origin-(--transform-origin)` (var set on the Positioner, inherited by the Popup child).
  - SubTrigger open styling: `data-[state=open]:bg-accent data-[state=open]:text-accent-foreground` → `data-[popup-open]:bg-accent data-[popup-open]:text-accent-foreground` (Base UI SubmenuTrigger exposes `data-popup-open`). Bracket form used (matches the repo's `data-[...]` convention and needs no new `globals.css` variant).
  - All other Tailwind preserved exactly, including the item `focus:bg-accent focus:text-accent-foreground` highlight — verified safe: Base UI menus move real DOM focus onto the highlighted item (`focusItem` in `MenuRoot`), so `:focus` still matches.
  - Leftover scan: `grep -n "radix-ui\|@radix-ui" dropdown-menu.tsx` → clean.
- Consumers — `asChild` → `render={<Child/>}` (repo's established idiom), 9 conversions (7 triggers + 2 items) across 7 files. No `onSelect` / `textValue` exist in any consumer, so no `closeOnClick` / `label` changes were needed.
  - `src/app/(dashboard)/transactions/_components/data-table.tsx` — 1 `DropdownMenuTrigger`.
  - `src/app/(dashboard)/transactions/_components/row-actions.tsx` — 1 `DropdownMenuTrigger` (its `DropdownMenuItem`s already used `onClick`, unchanged).
  - `src/app/(dashboard)/account/_components/api-keys-card.tsx` — 1 `DropdownMenuTrigger`.
  - `src/app/(dashboard)/_components/nav-projects.tsx` — 1 `DropdownMenuTrigger`.
  - `src/app/(dashboard)/_components/nav-user.tsx` — 1 `DropdownMenuTrigger` + 2 `DropdownMenuItem`. Also (a) trigger child `SidebarMenuButton` `data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground` → `data-[popup-open]:…` (the trigger now emits `data-popup-open`, not `data-state=open`), and (b) `w-(--radix-dropdown-menu-trigger-width)` → `w-(--anchor-width)`.
  - `src/app/(dashboard)/admin/_components/audit-logs-table.tsx` — 1 `DropdownMenuTrigger`.
  - `src/app/(dashboard)/admin/_components/user-actions-dropdown.tsx` — 1 `DropdownMenuTrigger`.
  - Leftover scan on all 6 consumer files: clean.
- `package.json` / `bun.lock` — removed `@radix-ui/react-dropdown-menu` (no importers remain repo-wide). `bun remove` re-ran `prisma generate` successfully.

## Left alone

- `src/styles/globals.css` — the `data-starting-style` / `data-ending-style` custom variants already existed (added by the tooltip migration); reused, not re-added. No new variant registered (the SubTrigger open style uses the bracket form `data-[popup-open]:`).
- `src/app/(dashboard)/account/_components/api-keys-card.tsx` line 148 `<PopoverTrigger asChild>` — that is Popover, not dropdown; out of this slice.
- `src/app/(dashboard)/_components/nav-projects.tsx` line 39 `<SidebarMenuButton asChild>` — sidebar's own Radix `Slot` usage; `sidebar.tsx` is not in this slice and stays on Radix.
- `DropdownMenuCheckboxItem` / `DropdownMenuRadioGroup` / `DropdownMenuRadioItem` / `DropdownMenuPortal` wrappers — migrated for completeness though no consumer currently uses them.

## Behavior changes

- **CheckboxItem / RadioItem close-on-click default FLIPS.** Radix closed the menu on select (unless `event.preventDefault()`); Base UI `closeOnClick` defaults to `false` on `CheckboxItem` and `RadioItem`. Left at the Base default (idiomatic base-registry behavior), **not patched**. If Radix "close on select" is wanted, set `closeOnClick` on those items. Regular `Item` keeps `closeOnClick` default `true`, so plain menu items still close on click — no delta there. (No consumer uses Checkbox/Radio items today.)
- **`loopFocus` default flips to `true`** on `Menu.Root` (Base UI loops keyboard focus at the list ends by default; Radix `loop` defaulted `false`). Not exposed by the wrapper; idiomatic Base default kept.
- **Trigger open marker changed** from `data-state="open"` to `data-popup-open`. nav-user's sidebar-button open highlight was rewired to `data-[popup-open]:…` accordingly. Any other CSS keyed on the trigger's `data-state` would need the same rewrite — none found.
- **Enter/exit animations** are now gated by `data-starting-style` / `data-ending-style` (transition hooks) instead of Radix `data-[state=open/closed]`. Compiles and animates; exact feel/timing may differ subtly.
- **GroupLabel must be inside a Group** to wire `aria-labelledby` (Radix `Label` could float freely). nav-user's `DropdownMenuLabel` sits directly in the content (not inside a `DropdownMenuGroup`); it still renders, but the aria label association is cosmetic-only there.
- **`outline-none` not added.** The shadcn base-registry menu shape (wrapper-shapes.md) puts `outline-none` on the Positioner/Popup; this migration preserved the original exact classes (which had none), mirroring the tooltip migration. If a focus ring appears on the open menu popup, add `outline-none` to the Popup.

## Verify by hand

1. Transactions → "Columns" dropdown (data-table) and Admin → audit logs → "Columns" (audit-logs-table): open it, toggle a couple of column checkboxes, confirm it anchors below/right and items highlight on hover and arrow-key nav.
2. Transactions row actions (`…`): open, click Edit / Duplicate / Delete — the menu closes on click and the corresponding dialog opens.
3. Account → API keys `…` menu: open per row, click an item.
4. Sidebar user menu (nav-user): open it — the sidebar button shows the accent background while open (driven by `data-popup-open`); the menu width matches the trigger (`--anchor-width`); "Account" and "Sign out" navigate (rendered as `<Link>`).
5. Sidebar projects `…` action (nav-projects): open and confirm it appears to the side.
6. Admin user actions `…` (user-actions-dropdown): open, arrow-key through items, try typeahead (first-letter jump).
7. Any submenu (SubTrigger/SubContent): confirm it opens to the right with the `-3` align offset and the trigger gets the accent background while its submenu is open.
8. Eyeball the open/close fade + zoom + per-side slide animations.

---

*Derived status: 31 UI wrappers under `src/components/ui` still import Radix (dropdown-menu and tooltip are now off Radix).*
