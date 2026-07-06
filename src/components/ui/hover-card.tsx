'use client';

import { PreviewCard as HoverCardPrimitive } from '@base-ui/react/preview-card';
import type * as React from 'react';

import { cn } from '@/lib/utils';

function HoverCard({ ...props }: React.ComponentProps<typeof HoverCardPrimitive.Root>) {
	return <HoverCardPrimitive.Root data-slot='hover-card' {...props} />;
}

function HoverCardTrigger({ ...props }: React.ComponentProps<typeof HoverCardPrimitive.Trigger>) {
	return <HoverCardPrimitive.Trigger data-slot='hover-card-trigger' {...props} />;
}

function HoverCardContent({
	className,
	align = 'center',
	sideOffset = 4,
	side,
	alignOffset,
	...props
}: React.ComponentProps<typeof HoverCardPrimitive.Popup> &
	Pick<React.ComponentProps<typeof HoverCardPrimitive.Positioner>, 'side' | 'sideOffset' | 'align' | 'alignOffset'>) {
	return (
		<HoverCardPrimitive.Portal>
			<HoverCardPrimitive.Positioner
				align={align}
				alignOffset={alignOffset}
				className='isolate z-50'
				side={side}
				sideOffset={sideOffset}
			>
				<HoverCardPrimitive.Popup
					className={cn(
						'bg-popover text-popover-foreground data-starting-style:animate-in data-ending-style:animate-out data-ending-style:fade-out-0 data-starting-style:fade-in-0 data-ending-style:zoom-out-95 data-starting-style:zoom-in-95 data-[side=bottom]:data-starting-style:slide-in-from-top-2 data-[side=left]:data-starting-style:slide-in-from-right-2 data-[side=right]:data-starting-style:slide-in-from-left-2 data-[side=top]:data-starting-style:slide-in-from-bottom-2 z-50 w-64 origin-(--transform-origin) rounded-md border p-4 shadow-md outline-hidden',
						className
					)}
					data-slot='hover-card-content'
					{...props}
				/>
			</HoverCardPrimitive.Positioner>
		</HoverCardPrimitive.Portal>
	);
}

export { HoverCard, HoverCardContent, HoverCardTrigger };
