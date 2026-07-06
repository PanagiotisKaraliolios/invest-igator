# sheet

2026-07-06 · transformation engine · **migrated**: Radix Dialog-based Sheet → Base UI Dialog (edge-anchored).

## Changed

- `src/components/ui/sheet.tsx`: `@radix-ui/react-dialog` → `@base-ui/react/dialog` (sheet is a dialog with side positioning). `Overlay` → `Backdrop`, `Content` → `Popup` (no Positioner; edge-anchored via `fixed` + `inset` classes per `side`).
  - Per-side slide animations rewritten from Radix `data-[state=open]:slide-in-from-* / data-[state=closed]:slide-out-to-*` to the starting/ending-style idiom: `data-starting-style:slide-in-from-<side> data-ending-style:slide-out-to-<side>` with `data-starting-style:animate-in data-ending-style:animate-out`. Close-button `data-[state=open]:bg-secondary` → `data-[open]:bg-secondary`.
  - leftover scan: clean.
- No consumer changes: the only consumer is `sidebar.tsx` (mobile), which renders `<Sheet open={openMobile} onOpenChange={setOpenMobile}><SheetContent side={...}>` — no `SheetTrigger` (controlled).
- **This was the last importer of `@radix-ui/react-dialog`**, so that package can be removed in the final dependency sweep.

## Left alone

- Radix deps removed in the final sweep.

## Behavior changes

- None expected. Slide direction/animation preserved via the rewritten starting/ending-style classes.

## Verify by hand

- Resize to mobile width, open the sidebar (menu button): the sheet slides in from the left, the backdrop fades in, Esc/outside-click/close-button dismisses it with a slide-out, and focus returns to the trigger.
