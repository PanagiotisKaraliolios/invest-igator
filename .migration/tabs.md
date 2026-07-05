# tabs

2026-07-06 · transformation engine · **migrated**: Radix Tabs → Base UI Tabs (Trigger→Tab, Content→Panel).

## Changed

- `src/components/ui/tabs.tsx`: `@radix-ui/react-tabs` → `@base-ui/react/tabs`. `Root`/`List` unchanged; `Trigger` → `Tab`, `Content` → `Panel`.
  - The custom `TabsTrigger` animates an active-pill via framer-motion `layoutId`, driven by a `MutationObserver`. Radix marked the active tab with `data-state="active"`; Base UI uses a **presence** attribute `data-active`. Updated the observer to `element.hasAttribute('data-active')` and `attributeFilter: ['data-active']`, and the class `data-[state=active]:text-foreground` → `data-active:text-foreground`.
  - leftover scan: clean.
- No consumer wrapper-name changes: `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` keep their names and `value` props (6 consumer files).

## Left alone

- Radix deps removed in the final sweep.

## Behavior changes

- **Activation mode**: Radix Tabs defaulted to *automatic* activation (arrow-key focus switches the panel). Base UI defaults to **manual** activation (arrow keys move focus; Enter/Space activates). Not auto-patched — the near-equivalent is `<TabsList activateOnFocus>` if the old feel is required. FLAGGED per the migration guide.

## Verify by hand

- Open a tabbed view (e.g. portfolio/settings). Click tabs — the animated pill must glide to the active tab. Keyboard: arrow keys move focus between tabs, Enter/Space activates (note the manual-activation change). Panel content switches correctly.
