# separator

2026-07-06 · transformation engine · **migrated**: Radix `Separator.Root` → Base UI callable `Separator`.

## Changed

- `src/components/ui/separator.tsx`: `@radix-ui/react-separator` → `@base-ui/react/separator` (callable single part, no `.Root`). Dropped the `decorative` prop (Base UI has no equivalent; its separator is always `role="separator"`). `orientation` kept; `data-[orientation=...]` classes unchanged (Base UI emits `data-orientation` identically).
  - leftover scan: clean.
- No consumer changes (no call site passed `decorative` or `asChild`).

## Left alone

- Radix deps removed in the final sweep.

## Behavior changes

- `decorative` is gone — the separator is now always semantic (`role="separator"`). All current uses are visual dividers; harmless.

## Verify by hand

- Visual dividers still render (sidebar, button-group, item lists) at correct orientation/size.
