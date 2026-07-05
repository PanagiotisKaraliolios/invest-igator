# accordion

2026-07-06 · transformation engine · **migrated**: Radix Accordion → Base UI Accordion (Content→Panel).

## Changed

- `src/components/ui/accordion.tsx`: `@radix-ui/react-accordion` → `@base-ui/react/accordion`. `Root`/`Item`/`Header`/`Trigger` same; `AccordionContent` renders `Accordion.Panel`.
  - Trigger open marker: `[&[data-state=open]>svg]:rotate-180` → `[&[data-panel-open]>svg]:rotate-180` (Base UI trigger presence attr). `disabled:*` → `data-disabled:*`.
  - Panel animation rewritten from the Radix `animate-accordion-up/down` keyframes (which referenced `--radix-accordion-content-height`) to a height transition: `h-(--accordion-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-starting-style:h-0 data-ending-style:h-0`.
  - leftover scan: clean.
- Consumer change — `src/app/_components/landing/faq.tsx`: `<Accordion collapsible type='single'>` → `<Accordion>` (Base UI accordion defaults to single-open and is always collapsible; `type`/`collapsible` dropped, `value`/`defaultValue` would be arrays if controlled — faq is uncontrolled).

## Left alone

- Radix deps removed in the final sweep.

## Behavior changes

- Multi-open would now be `openMultiple` (was `type="multiple"`). FAQ uses single-open, unchanged in feel. Panel expand/collapse now animates via a height transition on `--accordion-panel-height` instead of the radix keyframe.

## Verify by hand

- Landing FAQ: click a question — its panel expands with the chevron rotating 180°; opening another closes the first (single-open); clicking the open one collapses it. The expand/collapse animates smoothly.
