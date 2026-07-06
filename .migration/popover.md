# popover

2026-07-06 · transformation engine · **migrated**: Radix Popover → Base UI Popover (Portal>Positioner>Popup).

## Changed

- `src/components/ui/popover.tsx`: `@radix-ui/react-popover` → `@base-ui/react/popover`. `PopoverContent` restructured to `Portal > Positioner > Popup`; positioning props (`side`/`sideOffset`/`align`/`alignOffset`) Pick'd from Positioner.Props and **forwarded** to the Positioner. Animation classes → `data-starting-style:`/`data-ending-style:` idiom; `origin-(--radix-popover-content-transform-origin)` → `origin-(--transform-origin)`.
  - `PopoverAnchor`: Base UI Popover has no Anchor part (Positioner takes an `anchor` prop instead). Kept as an inert `<span>` passthrough for API compatibility — **unused in the app** (flagged).
  - leftover scan: clean.
- Consumer changes — 6 `PopoverTrigger asChild` → `render` conversions:
  - `account/api-keys-card.tsx`, `portfolio/returns/page.tsx`, `watchlist/DateRangePicker.tsx` (`render={<Button/>}`).
  - `transactions/transaction-form.tsx`, `tools/goals/goals-view.tsx` (×2): `render={<FormControl><Button/></FormControl>}` (nested render chain — FormControl forwards trigger props to the Button).
  - `components/ui/date-range-picker.tsx` (internal Popover): `render={<Button/>}`.

## Left alone

- Radix deps removed in the final sweep.

## Behavior changes

- `PopoverAnchor` is now inert (no anchoring). Not used anywhere. If anchoring is ever needed, pass an `anchor` to the Positioner instead.

## Verify by hand

- Date pickers (transaction form, goals target date, watchlist range, returns period), API-key permissions popover: trigger opens the popover, it positions correctly (side/align), closes on outside-click/Esc, and focus returns to the trigger.
