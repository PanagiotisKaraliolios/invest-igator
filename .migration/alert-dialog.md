# alert-dialog

2026-07-06 · transformation engine · **migrated**: Radix AlertDialog → Base UI AlertDialog.

## Changed

- `src/components/ui/alert-dialog.tsx`: `@radix-ui/react-alert-dialog` → `@base-ui/react/alert-dialog`. `Overlay` → `Backdrop`, `Content` → `Popup` (centered modal, no Positioner). Animation classes → starting/ending-style idiom.
  - `AlertDialogAction`: Base UI has no `Action` part → renders a primary-styled `AlertDialog.Close` (Radix's Action closed the dialog on click; `Close` reproduces that).
  - `AlertDialogCancel`: Radix `Cancel` → outline-styled `AlertDialog.Close`.
  - leftover scan: clean.
- No consumer changes: the two consumers (`connected-accounts-card.tsx`, `api-keys-card.tsx`) use `AlertDialogAction`/`AlertDialogCancel` with `onClick`/`disabled` — neither calls `preventDefault`, so mapping Action/Cancel → Close preserves the "run handler + close" behavior exactly. AlertDialog is controlled via `open`/state (no `AlertDialogTrigger` in use).

## Left alone

- `buttonVariants` (from migrated `button`) still styles Action/Cancel.
- Radix deps removed in the final sweep.

## Behavior changes

- None. Action/Cancel both close the dialog on click (as in Radix); their `onClick` mutations still fire.

## Verify by hand

- API keys: "Delete" confirmation dialog — Cancel dismisses; Delete runs the mutation and closes. Connected accounts: "Disconnect" confirmation — same. Focus returns to the invoking control; Esc/outside-click dismisses.
