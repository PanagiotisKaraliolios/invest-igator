'use client';

import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import type * as React from 'react';

import { cn } from '@/lib/utils';

function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
	return <PopoverPrimitive.Root data-slot='popover' {...props} />;
}

function PopoverTrigger({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
	return <PopoverPrimitive.Trigger data-slot='popover-trigger' {...props} />;
}

function PopoverContent({
	className,
	align = 'center',
	sideOffset = 4,
	side,
	alignOffset,
	...props
}: React.ComponentProps<typeof PopoverPrimitive.Popup> &
	Pick<React.ComponentProps<typeof PopoverPrimitive.Positioner>, 'side' | 'sideOffset' | 'align' | 'alignOffset'>) {
	return (
		<PopoverPrimitive.Portal>
			<PopoverPrimitive.Positioner
				align={align}
				alignOffset={alignOffset}
				className='isolate z-50'
				side={side}
				sideOffset={sideOffset}
			>
				<PopoverPrimitive.Popup
					className={cn(
						'bg-popover text-popover-foreground data-starting-style:animate-in data-ending-style:animate-out data-ending-style:fade-out-0 data-starting-style:fade-in-0 data-ending-style:zoom-out-95 data-starting-style:zoom-in-95 data-[side=bottom]:data-starting-style:slide-in-from-top-2 data-[side=left]:data-starting-style:slide-in-from-right-2 data-[side=right]:data-starting-style:slide-in-from-left-2 data-[side=top]:data-starting-style:slide-in-from-bottom-2 z-50 w-72 origin-(--transform-origin) rounded-md border p-4 shadow-md outline-hidden',
						className
					)}
					data-slot='popover-content'
					{...props}
				/>
			</PopoverPrimitive.Positioner>
		</PopoverPrimitive.Portal>
	);
}

// Base UI Popover has no Anchor part (its Positioner takes an `anchor` prop
// instead). Kept as an inert passthrough for API compatibility; unused in the app.
function PopoverAnchor({ ...props }: React.ComponentProps<'span'>) {
	return <span data-slot='popover-anchor' {...props} />;
}

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger };
