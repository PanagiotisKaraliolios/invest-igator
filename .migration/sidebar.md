# sidebar

2026-07-06 · transformation engine · **migrated**: Radix `Slot`/`asChild` (5 parts) → `useRender` + `mergeProps`.

## Changed

- `src/components/ui/sidebar.tsx`: replaced `@radix-ui/react-slot` with `@base-ui/react/use-render` + `@base-ui/react/merge-props`. Five parts used the `Comp = asChild ? Slot : tag` idiom — all converted to `useRender({ defaultTagName, render, props: mergeProps<tag>({...} as React.ComponentProps<tag>, props) })`:
  - `SidebarGroupLabel` (div), `SidebarGroupAction` (button), `SidebarMenuAction` (button), `SidebarMenuSubButton` (a), and `SidebarMenuButton` (button).
  - `SidebarMenuButton` builds its element via `useRender` into a `button` variable, then either returns it or wraps it in `<Tooltip><TooltipTrigger render={button} />…`. `useRender` returns a `ReactElement`, so it slots into `render` cleanly. `sidebarMenuButtonVariants` (cva) kept.
  - leftover scan: `grep -n "radix-ui" src/components/ui/sidebar.tsx` → clean.
- Consumer call sites converted (`asChild` → `render`, child lifted):
  - `src/app/(dashboard)/_components/nav-projects.tsx`: `<SidebarMenuButton render={<a href={item.url} />}>…`.
  - `src/app/(dashboard)/_components/nav-main.tsx`: `<SidebarMenuSubButton isActive={…} render={<a href={subItem.url} />}>…`.

## Left alone

- `SidebarProvider` uses migrated `TooltipProvider` (delay=0) and `Sidebar` (mobile) uses `Sheet` — Sheet is still on `@radix-ui/react-dialog` until its own migration; coexists fine.
- The `Collapsible` / `CollapsibleTrigger` `asChild` in `nav-main.tsx` are NOT sidebar — left for the collapsible migration.
- `@radix-ui/react-slot` stays in `package.json` until the final dep-removal sweep.

## Behavior changes

- None observed. Keyboard shortcut (Cmd/Ctrl-B), cookie persistence, collapsed tooltip behavior unchanged.

## Verify by hand

- Toggle the sidebar (rail click + Cmd/Ctrl-B). Collapse it and hover a menu item — the tooltip must appear (right side). Click a nav item rendered via `render={<a/>}` (Projects list, sub-menu items) — must navigate. On mobile width, the Sheet-based sidebar still opens.
