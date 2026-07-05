# collapsible

2026-07-06 · transformation engine · **migrated**: Radix Collapsible → Base UI Collapsible (Content→Panel).

## Changed

- `src/components/ui/collapsible.tsx`: `@radix-ui/react-collapsible` → `@base-ui/react/collapsible`. `Root`/`Trigger` unchanged; `CollapsibleContent` now renders `Collapsible.Panel`.
  - leftover scan: clean.
- Consumer change — `src/app/(dashboard)/_components/nav-main.tsx`:
  - `<Collapsible asChild>…<SidebarMenuItem>` → `<Collapsible render={<SidebarMenuItem />}>` (child wrapper hoisted).
  - `<CollapsibleTrigger asChild><SidebarMenuButton>` → `<CollapsibleTrigger render={<SidebarMenuButton tooltip={item.title} />}>` with the icon/label/chevron lifted onto the trigger.
  - Chevron rotate class `group-data-[state=open]/collapsible:rotate-90` → `group-data-open/collapsible:rotate-90` (Base UI presence attribute on the Root).

## Left alone

- Radix deps removed in the final sweep.

## Behavior changes

- None expected. The panel open/close still animates via `--collapsible-panel-height` (Base UI equivalent of Radix's height var); no height class was set on this wrapper.

## Verify by hand

- Sidebar "Platform" nav groups: click a parent item — it expands/collapses, the chevron rotates 90° when open, and the sub-menu links appear. Composition note: `CollapsibleTrigger render={<SidebarMenuButton/>}` nests two render-based components — confirm the trigger still toggles and the collapsed-sidebar tooltip still shows.
