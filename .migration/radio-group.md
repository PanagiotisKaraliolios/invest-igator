# radio-group

2026-07-06 · transformation engine · **migrated**: Radix RadioGroup → Base UI RadioGroup + Radio.

## Changed

- `src/components/ui/radio-group.tsx`: `@radix-ui/react-radio-group` → `@base-ui/react/radio-group` (callable `RadioGroup`) + `@base-ui/react/radio` (`Radio.Root`, `Radio.Indicator`). `RadioGroupItem` renders `Radio.Root` > `Radio.Indicator`. Class rewrite: `disabled:*` → `data-disabled:*` (Radio.Root renders a `<span>`).
  - leftover scan: clean.
- No consumer changes (0 consumer files).

## Left alone

- Radix deps removed in the final sweep.

## Behavior changes

- Radix `RadioGroup.Root` props `orientation`/`loop`/`dir` are dropped in Base UI (arrow-key nav handles both axes, focus wrapping is built in). Not used here. `onValueChange` gains an `eventDetails` arg (existing handlers stay type-safe).

## Verify by hand

- No current usage. If reintroduced: arrow keys move selection, the filled dot appears on the checked radio, disabled radios dim.
