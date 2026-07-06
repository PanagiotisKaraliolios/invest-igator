# select

2026-07-06 · transformation engine · **migrated**: Radix Select → Base UI Select (heaviest consumer-facing migration, 10 consumers).

## Changed

- `src/components/ui/select.tsx`: `@radix-ui/react-select` → `@base-ui/react/select`.
  - `SelectContent` restructured to `Portal > Positioner > Popup`; `Viewport` → `List`. Positioning props (`side`/`sideOffset`/`align`/`alignOffset`) Pick'd from Positioner.Props and forwarded. `position="popper"|"item-aligned"` → `alignItemWithTrigger={position === 'item-aligned'}` on the Positioner (wrapper still defaults `position='popper'`).
  - `ScrollUpButton`/`ScrollDownButton` → `ScrollUpArrow`/`ScrollDownArrow`; `Label` → `GroupLabel`; `Icon` `asChild` → `render`. Animation classes → starting/ending-style idiom; CSS vars → `--available-height`/`--transform-origin`.
  - leftover scan: clean.
- **Consumer changes:**
  - **`onValueChange` value is now `unknown`** (Base UI Select is generic; `React.ComponentProps` collapses the generic — standard for shadcn wrappers). 4 handlers that fed the value straight into a string-typed setter got a `value as string` cast: `api-key-dialog.tsx` (×3: expiresIn, permissionTemplate, rateLimitTimeWindow) and `audit-logs-table.tsx` (actionFilter). Handlers already using `v as X` casts, `Number(v)`, or `field.onChange` were unaffected.
  - **`Select.Value` renders the raw value, not the item's text** (Radix rendered the selected `ItemText`). For every select whose item **label ≠ value**, added an `items={{ value: label }}` map on the Select Root so the trigger shows the label: `returns/page.tsx` (Period), `api-key-dialog.tsx` (expiration, time-window, permission-template), `data-table.tsx` (page-size, side), `audit-logs-table.tsx` (page-size, action-filter — dynamic via `Object.fromEntries(ACTIONS_CONFIG)`), `analytics-dashboard.tsx` (period), `transaction-form.tsx` (fee-currency — dynamic via `supportedCurrencies`). Selects where value === label (currency codes, BUY/SELL) need no `items`.

## Left alone

- Radix deps removed in the final sweep.

## Behavior changes

- `onValueChange` gains an `eventDetails` 2nd arg (single-arg handlers stay safe) and `value` widens to `unknown | null`. `position` prop preserved via `alignItemWithTrigger`.

## Verify by hand

- Every dropdown: open it, pick an option, and confirm **the trigger shows the human label** (e.g. "30 days", "Year-to-date", "10 / page") — NOT the raw value ("2592000", "ytd", "10"). This is the highest-risk delta; eyeball each of the ~10 selects. Also: keyboard typeahead, scroll arrows on long lists, and that changing the selection updates state.
