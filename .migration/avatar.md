# avatar

2026-07-06 · transformation engine · **migrated**: Radix Avatar → Base UI Avatar (1:1 parts).

## Changed

- `src/components/ui/avatar.tsx`: `@radix-ui/react-avatar` → `@base-ui/react/avatar`. `Root`/`Image`/`Fallback` unchanged, classes unchanged (no data-state hooks used). `Image` `delayMs`→`delay` and `Fallback` `delayMs`→`delay` exist but are not used here.
  - leftover scan: clean.
- No consumer changes.

## Left alone

- Radix deps removed in the final sweep.

## Behavior changes

- None.

## Verify by hand

- User avatar (nav-user, account): image loads; on load failure the initials fallback shows.
